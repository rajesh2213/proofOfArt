import dotenv from 'dotenv';

dotenv.config();

import { inferenceWorker } from '../workers/inferenceWorker';
import { inferenceQueueService } from '../services/inferenceQueueService';
import logger from '../utils/logger';

const HEALTH_CHECK_INTERVAL = parseInt(process.env.WORKER_HEALTH_CHECK_INTERVAL || '60000');

async function startWorker() {
    try {
        logger.info('Starting inference worker...');
        await inferenceWorker.start();
        logger.info('Inference worker started successfully');
        
        startHealthChecks();
    } catch (error: any) {
        logger.error('Failed to start inference worker', {
            error: error.message,
            stack: error.stack
        });
        process.exit(1);
    }
}

function startHealthChecks() {
    setInterval(async () => {
        try {
            const healthStatus = await inferenceWorker.getHealthStatus();
            const queueHealth = await inferenceQueueService.getQueueHealth();
            
            logger.info('Worker health check', {
                worker: {
                    isRunning: healthStatus.isRunning,
                    isHealthy: healthStatus.isHealthy,
                    uptime: Math.floor(healthStatus.uptime / 1000) + 's',
                    metrics: healthStatus.metrics
                },
                queue: {
                    isHealthy: queueHealth.isHealthy,
                    metrics: queueHealth.metrics
                }
            });

            if (!healthStatus.isHealthy) {
                logger.warn('Worker health check failed', {
                    redisConnected: healthStatus.redisConnected,
                    inferenceServiceAvailable: healthStatus.inferenceServiceAvailable,
                    isRunning: healthStatus.isRunning
                });
            }
        } catch (error: any) {
            logger.error('Error during health check', {
                error: error.message
            });
        }
    }, HEALTH_CHECK_INTERVAL);

    logger.info('Health check monitoring started', {
        interval: HEALTH_CHECK_INTERVAL + 'ms'
    });
}

startWorker();

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

