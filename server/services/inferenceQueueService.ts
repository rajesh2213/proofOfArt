import { Queue, QueueOptions } from 'bullmq';
import { getRedisClient } from '../config/redis';
import logger from '../utils/logger';
import { InferenceJobData } from '../src/types/inference';

export class InferenceQueueService {
    private queue: Queue<InferenceJobData> | null = null;
    private queueName = 'inference-queue';

    /**
     * Initializes the inference queue
     * @returns The queue instance
     */
    async initialize(): Promise<Queue<InferenceJobData>> {
        if (this.queue) {
            return this.queue;
        }

        try {
            await getRedisClient(); 
            
            const queueOptions: QueueOptions = {
                connection: {
                    host: process.env.REDIS_HOST || 'localhost',
                    port: parseInt(process.env.REDIS_PORT || '6379'),
                    password: process.env.REDIS_PASSWORD || undefined,
                    db: parseInt(process.env.REDIS_DB || '0'),
                },
                defaultJobOptions: {
                    attempts: parseInt(process.env.INFERENCE_MAX_RETRIES || '3'),
                    backoff: {
                        type: 'exponential',
                        delay: parseInt(process.env.INFERENCE_RETRY_DELAY || '5000'),
                    },
                    removeOnComplete: {
                        age: 24 * 3600, 
                        count: 1000, 
                    },
                    removeOnFail: {
                        age: 7 * 24 * 3600, 
                    },
                },
            };

            this.queue = new Queue<InferenceJobData>(this.queueName, queueOptions);

            this.queue.on('error', (error: Error) => {
                logger.error('Inference queue error', { error: error.message });
            });

            logger.info('Inference queue initialized', { queueName: this.queueName });
            return this.queue;
        } catch (error: any) {
            logger.error('Failed to initialize inference queue', { 
                error: error.message 
            });
            throw error;
        }
    }

    /**
     * Gets the queue instance (initializes if needed)
     * @returns The queue instance
     */
    async getQueue(): Promise<Queue<InferenceJobData>> {
        if (!this.queue) {
            await this.initialize();
        }
        if (!this.queue) {
            throw new Error('Failed to initialize inference queue');
        }
        return this.queue;
    }

    /**
     * Adds an inference job to the queue
     * @param imageId - The ID of the image to process
     * @param imageUrl - The URL of the image
     * @param priority - Optional job priority (higher = more priority, default: 0)
     * @returns The created job
     */
    async queueInference(
        imageId: string, 
        imageUrl: string,
        priority: number = 0
    ): Promise<{ jobId: string }> {
        try {
            const queue = await this.getQueue();
            
            const jobData: InferenceJobData = {
                imageId,
                imageUrl,
            };

            const job = await queue.add(
                'process-inference',
                jobData,
                {
                    priority,
                    jobId: `inference-${imageId}`, 
                }
            );

            logger.info('Inference job queued', {
                jobId: job.id,
                imageId,
                imageUrl: imageUrl.substring(0, 50) + '...',
                priority
            });

            return { jobId: job.id! };
        } catch (error: any) {
            logger.error('Error queueing inference job', {
                error: error.message,
                imageId,
                imageUrl: imageUrl.substring(0, 50) + '...'
            });
            throw error;
        }
    }

    /**
     * Gets job status by image ID
     * @param imageId - The image ID
     * @returns Job status information
     */
    async getJobStatus(imageId: string): Promise<{
        exists: boolean;
        state?: string;
        progress?: number;
        attemptsMade?: number;
    }> {
        try {
            const queue = await this.getQueue();
            const jobId = `inference-${imageId}`;
            const job = await queue.getJob(jobId);

            if (!job) {
                return { exists: false };
            }

            const state = await job.getState();
            const progress = job.progress;
            const attemptsMade = job.attemptsMade;

            return {
                exists: true,
                state,
                progress: typeof progress === 'number' ? progress : undefined,
                attemptsMade
            };
        } catch (error: any) {
            logger.error('Error getting job status', {
                error: error.message,
                imageId
            });
            throw error;
        }
    }

    /**
     * Gets queue metrics and statistics
     */
    async getQueueMetrics(): Promise<{
        waiting: number;
        active: number;
        completed: number;
        failed: number;
        delayed: number;
    }> {
        try {
            const queue = await this.getQueue();
            
            const [waiting, active, completed, failed, delayed] = await Promise.all([
                queue.getWaitingCount(),
                queue.getActiveCount(),
                queue.getCompletedCount(),
                queue.getFailedCount(),
                queue.getDelayedCount()
            ]);

            return {
                waiting,
                active,
                completed,
                failed,
                delayed,
            };
        } catch (error: any) {
            logger.error('Error getting queue metrics', {
                error: error.message
            });
            throw error;
        }
    }

    async getQueueHealth(): Promise<{
        isHealthy: boolean;
        metrics: {
            waiting: number;
            active: number;
            completed: number;
            failed: number;
            delayed: number;
        };
        redisConnected: boolean;
    }> {
        let redisConnected = false;
        try {
            const redis = await getRedisClient();
            await redis.ping();
            redisConnected = true;
        } catch (error) {
            redisConnected = false;
        }

        let metrics;
        try {
            metrics = await this.getQueueMetrics();
        } catch (error) {
            metrics = {
                waiting: 0,
                active: 0,
                completed: 0,
                failed: 0,
                delayed: 0,
            };
        }

        const isHealthy = redisConnected && metrics !== null;

        return {
            isHealthy,
            metrics,
            redisConnected
        };
    }

    async close(): Promise<void> {
        if (this.queue) {
            await this.queue.close();
            this.queue = null;
            logger.info('Inference queue closed');
        }
    }
}

export const inferenceQueueService = new InferenceQueueService();

