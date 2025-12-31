import { Request, Response } from 'express';
import logger from '../utils/logger';
import { ValidationError } from '../utils/errors';
import { inferenceQueueService } from '../services/inferenceQueueService';
import { imageService } from '../services/imageService';
import { catchAsync } from '../middleware/errorHandler';


export const getImageStatus = catchAsync(async (req: Request, res: Response): Promise<void> => {
    const { imageId } = req.params;

    if (!imageId) {
        throw new ValidationError('Image ID is required', 'imageId');
    }

    const image = await imageService.getImageById(imageId, true);

    if (!image) {
        res.status(404).json({
            success: false,
            message: 'Image not found',
            errorCode: 'IMAGE_NOT_FOUND'
        });
        return;
    }

    let jobStatus = null;
    try {
        jobStatus = await inferenceQueueService.getJobStatus(imageId);
    } catch (error: any) {
        logger.warn('Error getting job status', {
            error: error.message,
            imageId
        });
    }

    let statusValue: 'pending' | 'processing' | 'complete' | 'failed' = 'pending';
    if (image.status === 'COMPLETED') {
        statusValue = 'complete';
    } else if (image.status === 'FAILED') {
        statusValue = 'failed';
    } else if (image.status === 'PROCESSING' || jobStatus?.state === 'active') {
        statusValue = 'processing';
    } else if (image.status === 'QUEUED' || jobStatus?.state === 'waiting' || jobStatus?.state === 'delayed') {
        statusValue = 'pending';
    }

    const status = {
        imageId: image.id,
        status: statusValue,
        progress: jobStatus?.progress || (image.status === 'COMPLETED' ? 100 : image.status === 'PROCESSING' ? 50 : 0),
        hasDetectionReport: !!image.detectionReport,
        result: image.detectionReport ? {
            aiProbability: image.detectionReport.aiProbability,
            detectedLabel: image.detectionReport.detectedLabel,
            modelName: image.detectionReport.modelName,
            hasHeatmap: !!image.detectionReport.heatmapUrl
        } : null,
        jobStatus: jobStatus?.exists ? {
            state: jobStatus.state,
            progress: jobStatus.progress,
            attemptsMade: jobStatus.attemptsMade
        } : null,
        url: image.url,
        createdAt: (image as any).createdAt || null
    };

    res.status(200).json({
        success: true,
        data: status
    });
});


export const streamImageStatus = catchAsync(async (req: Request, res: Response): Promise<void> => {
    const { imageId } = req.params;

    if (!imageId) {
        throw new ValidationError('Image ID is required', 'imageId');
    }

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no'); 

    res.write(`data: ${JSON.stringify({ type: 'connected', imageId })}\n\n`);

    const pollInterval = parseInt(process.env.SSE_POLL_INTERVAL || '2000');
    let isClientConnected = true;

    req.on('close', () => {
        isClientConnected = false;
        logger.info('SSE client disconnected', { imageId });
    });

    const pollStatus = async () => {
        if (!isClientConnected) {
            return;
        }

        try {
            const image = await imageService.getImageById(imageId, true);

            if (!image) {
                res.write(`data: ${JSON.stringify({
                    type: 'error',
                    message: 'Image not found'
                })}\n\n`);
                res.end();
                return;
            }

            let jobStatus = null;
            try {
                jobStatus = await inferenceQueueService.getJobStatus(imageId);
            } catch (error) {
            }

            const status = {
                type: 'status',
                imageId: image.id,
                status: (image as any).status || 'UNKNOWN',
                hasDetectionReport: !!image.detectionReport,
                detectionReport: image.detectionReport ? {
                    aiProbability: image.detectionReport.aiProbability,
                    detectedLabel: image.detectionReport.detectedLabel,
                    modelName: image.detectionReport.modelName,
                    hasHeatmap: !!image.detectionReport.heatmapUrl
                } : null,
                jobStatus: jobStatus?.exists ? {
                    state: jobStatus.state,
                    progress: jobStatus.progress,
                    attemptsMade: jobStatus.attemptsMade
                } : null,
                timestamp: new Date().toISOString()
            };

            res.write(`data: ${JSON.stringify(status)}\n\n`);

            const imageStatus = (image as any).status;
            if (imageStatus === 'COMPLETED' || imageStatus === 'FAILED') {
                res.write(`data: ${JSON.stringify({
                    type: 'complete',
                    status: imageStatus
                })}\n\n`);
                res.end();
                return;
            }

            if (isClientConnected) {
                setTimeout(pollStatus, pollInterval);
            }
        } catch (error: any) {
            logger.error('Error in SSE status polling', {
                error: error.message,
                imageId
            });

            if (isClientConnected) {
                res.write(`data: ${JSON.stringify({
                    type: 'error',
                    message: error.message
                })}\n\n`);
                setTimeout(pollStatus, pollInterval);
            }
        }
    };

    pollStatus();

    const heartbeatInterval = setInterval(() => {
        if (isClientConnected) {
            res.write(`: heartbeat\n\n`);
        } else {
            clearInterval(heartbeatInterval);
        }
    }, 30000);

    req.on('close', () => {
        clearInterval(heartbeatInterval);
    });
});