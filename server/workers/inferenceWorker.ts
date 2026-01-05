import { Worker, WorkerOptions, Job } from 'bullmq';
import { getRedisClient } from '../config/redis';
import logger from '../utils/logger';
import { InferenceJobData, InferenceResponse } from '../src/types/inference';
import { imageService } from '../services/imageService';
import { prisma } from '../config/prismaClient';
import { ExternalServiceError } from '../utils/errors';
import dotenv from 'dotenv';

dotenv.config();

export class InferenceWorker {
    private worker: Worker<InferenceJobData> | null = null;
    private queueName = 'inference-queue';
    private isRunning = false;
    private startTime: Date | null = null;
    private metrics = {
        jobsProcessed: 0,
        jobsCompleted: 0,
        jobsFailed: 0,
        lastJobProcessedAt: null as Date | null,
        lastError: null as string | null,
    };

    async start(): Promise<void> {
        if (this.worker) {
            return;
        }

        try {
            await getRedisClient();
            
            const workerOptions: WorkerOptions = {
                connection: {
                    host: process.env.REDIS_HOST || 'localhost',
                    port: parseInt(process.env.REDIS_PORT || '6379'),
                    password: process.env.REDIS_PASSWORD || undefined,
                    db: parseInt(process.env.REDIS_DB || '0'),
                },
                concurrency: parseInt(process.env.INFERENCE_WORKER_CONCURRENCY || '1'),
                limiter: {
                    max: parseInt(process.env.INFERENCE_MAX_JOBS_PER_SECOND || '5'),
                    duration: 1000,
                },
            };

            this.worker = new Worker<InferenceJobData>(
                this.queueName,
                this.processJob.bind(this),
                workerOptions
            );

            this.worker.on('failed', (job, err) => {
                this.metrics.jobsProcessed++;
                this.metrics.jobsFailed++;
                this.metrics.lastError = err.message;
                this.metrics.lastJobProcessedAt = new Date();
                logger.error('Worker: Job failed', {
                    jobId: job?.id,
                    imageId: job?.data.imageId,
                    error: err.message,
                    attemptsMade: job?.attemptsMade,
                    totalFailed: this.metrics.jobsFailed
                });
            });

            this.worker.on('error', (error) => {
                logger.error('Worker: Error', { error: error.message });
            });

            this.isRunning = true;
            this.startTime = new Date();
        } catch (error: any) {
            logger.error('Failed to start inference worker', {
                error: error.message
            });
            throw error;
        }
    }

    private async processJob(job: Job<InferenceJobData>): Promise<void> {
        const { imageId, imageUrl } = job.data;

        try {
            await imageService.updateStatus(imageId, 'PROCESSING');
            await job.updateProgress(10);

            if (!imageUrl || (!imageUrl.startsWith('http://') && !imageUrl.startsWith('https://'))) {
                throw new Error('Invalid image URL format for inference');
            }

            const inferBaseUrl = process.env.INFER_BASE_URL;
            if (!inferBaseUrl) {
                throw new Error('INFER_BASE_URL not configured');
            }

            const inferenceUrl = `${inferBaseUrl}/api/v1/analyze`;
            await job.updateProgress(20);

            try {
                const healthCheckUrl = `${inferBaseUrl}/`;
                const healthResponse = await fetch(healthCheckUrl, {
                    method: 'GET',
                    headers: { 'Accept': 'application/json' },
                    signal: AbortSignal.timeout(5000)
                });
            } catch (healthError: any) {
            }

            await job.updateProgress(30);

            const requestBody = { image_url: imageUrl };
            const inferenceTimeout = parseInt(process.env.INFERENCE_TIMEOUT || '120000', 10);

            const inferResponse = await fetch(inferenceUrl, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Accept': 'application/json'
                },
                body: JSON.stringify(requestBody),
                signal: AbortSignal.timeout(inferenceTimeout)
            });

            await job.updateProgress(60);

            if (!inferResponse.ok) {
                const errorText = await inferResponse.text();
                logger.error('Inference service error', {
                    status: inferResponse.status,
                    statusText: inferResponse.statusText,
                    response: errorText,
                    imageId
                });
                throw new ExternalServiceError(
                    'inference',
                    `Inference service returned ${inferResponse.status}: ${errorText}`
                );
            }

            const inferenceResult: InferenceResponse = await inferResponse.json() as InferenceResponse;
            await job.updateProgress(80);

            try {
                let detectedLabel: 'AI_GENERATED' | 'ORIGINAL' = 'ORIGINAL';
                if (inferenceResult.predictions.is_ai_generated) {
                    detectedLabel = 'AI_GENERATED';
                }
                
                await prisma.detectionReport.upsert({
                    where: { imageId },
                    update: {
                        aiProbability: inferenceResult.predictions.confidence,
                        detectedLabel: detectedLabel,
                        modelName: 'standalone_models',
                        heatmapUrl: inferenceResult.tampering.mask_base64 || null,
                    },
                    create: {
                        imageId,
                        aiProbability: inferenceResult.predictions.confidence,
                        detectedLabel: detectedLabel,
                        modelName: 'standalone_models',
                        heatmapUrl: inferenceResult.tampering.mask_base64 || null,
                    }
                });

                if (inferenceResult.tampering.detected && inferenceResult.tampering.mask_base64) {
                    await prisma.editDetection.deleteMany({
                        where: { imageId }
                    });

                    await prisma.editDetection.create({
                        data: {
                            imageId,
                            editType: 'INPAINTING', 
                            maskUrl: inferenceResult.tampering.mask_base64,
                            confidence: inferenceResult.tampering.edited_area_ratio, 
                            suggestions: `Edited area: ${(inferenceResult.tampering.edited_area_ratio * 100).toFixed(2)}% (${inferenceResult.tampering.edited_pixels} pixels)`
                        }
                    });
                } else {
                    await prisma.editDetection.deleteMany({
                        where: { imageId }
                    });
                }

                await job.updateProgress(90);
            } catch (dbError: any) {
                logger.error('Error saving detection report', {
                    error: dbError.message,
                    imageId
                });
                throw dbError;
            }

            await imageService.updateStatus(imageId, 'COMPLETED');
            await job.updateProgress(100);

            logger.info('Worker: Inference job completed successfully', {
                jobId: job.id,
                imageId,
                timestamp: new Date().toISOString()
            });
        } catch (error: any) {
            logger.error('Error processing inference job', {
                jobId: job.id,
                imageId,
                error: error.message,
                errorName: error.name,
                errorStack: error.stack,
                attemptsMade: job.attemptsMade,
                maxAttempts: job.opts.attempts,
                inferBaseUrl: process.env.INFER_BASE_URL
            });

            if (job.attemptsMade >= (job.opts.attempts || 3)) {
                try {
                    await imageService.updateStatus(imageId, 'FAILED');
                    logger.warn('Image status set to FAILED after max retries', {
                        imageId,
                        attemptsMade: job.attemptsMade
                    });
                } catch (statusError: any) {
                    logger.error('Error setting image status to FAILED', {
                        error: statusError.message,
                        imageId
                    });
                }
            }

            throw error;
        }
    }

    async stop(): Promise<void> {
        if (this.worker) {
            await this.worker.close();
            this.worker = null;
            this.isRunning = false;
            logger.info('Inference worker stopped', {
                uptime: this.startTime ? Date.now() - this.startTime.getTime() : 0,
                metrics: this.getMetrics()
            });
        }
    }

    async getHealthStatus(): Promise<{
        isRunning: boolean;
        isHealthy: boolean;
        uptime: number;
        metrics: {
            jobsProcessed: number;
            jobsCompleted: number;
            jobsFailed: number;
            lastJobProcessedAt: Date | null;
            lastError: string | null;
            successRate: string;
        };
        redisConnected: boolean;
        inferenceServiceAvailable: boolean;
    }> {
        const uptime = this.startTime ? Date.now() - this.startTime.getTime() : 0;
        
        let redisConnected = false;
        try {
            const redis = await getRedisClient();
            await redis.ping();
            redisConnected = true;
        } catch (error) {
            redisConnected = false;
        }

        let inferenceServiceAvailable = false;
        const inferBaseUrl = process.env.INFER_BASE_URL;
        if (inferBaseUrl) {
            try {
                const healthCheckUrl = `${inferBaseUrl}/`;
                const healthResponse = await fetch(healthCheckUrl, {
                    method: 'GET',
                    headers: { 'Accept': 'application/json' },
                    signal: AbortSignal.timeout(5000) 
                });
                inferenceServiceAvailable = healthResponse.ok;
            } catch (error: any) {
                inferenceServiceAvailable = false;
            }
        }

        const isHealthy = this.isRunning && redisConnected && inferenceServiceAvailable;

        return {
            isRunning: this.isRunning,
            isHealthy,
            uptime,
            metrics: this.getMetrics(),
            redisConnected,
            inferenceServiceAvailable
        };
    }

    getMetrics(): {
        jobsProcessed: number;
        jobsCompleted: number;
        jobsFailed: number;
        lastJobProcessedAt: Date | null;
        lastError: string | null;
        successRate: string;
    } {
        return {
            ...this.metrics,
            successRate: this.metrics.jobsProcessed > 0 
                ? (this.metrics.jobsCompleted / this.metrics.jobsProcessed * 100).toFixed(2) + '%'
                : '0%'
        };
    }

    resetMetrics(): void {
        const metrics = {
            jobsProcessed: 0,
            jobsCompleted: 0,
            jobsFailed: 0,
            lastJobProcessedAt: null as Date | null,
            lastError: null as string | null,
        };
        this.metrics = metrics;
    }
}

export const inferenceWorker = new InferenceWorker();

if (require.main === module) {
    inferenceWorker.start().catch((error) => {
        logger.error('Failed to start worker', { error: error.message });
        process.exit(1);
    });

    process.on('SIGTERM', async () => {
        logger.info('SIGTERM received, shutting down worker...');
        await inferenceWorker.stop();
        process.exit(0);
    });

    process.on('SIGINT', async () => {
        logger.info('SIGINT received, shutting down worker...');
        await inferenceWorker.stop();
        process.exit(0);
    });
}


