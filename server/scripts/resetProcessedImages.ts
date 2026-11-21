import dotenv from 'dotenv';
dotenv.config();

import { prisma } from '../config/prismaClient';
import { getRedisClient } from '../config/redis';
import { inferenceQueueService } from '../services/inferenceQueueService';
import logger from '../utils/logger';

async function resetProcessedImages(userEmail?: string) {
    try {
        logger.info('Starting reset of processed images...', { userEmail: userEmail || 'all users' });

        let imageIds: string[] = [];
        let userIds: string[] = [];

        if (userEmail) {
            const user = await prisma.user.findUnique({
                where: { email: userEmail },
                select: { id: true }
            });

            if (!user) {
                logger.warn(`User with email ${userEmail} not found`);
                return;
            }

            userIds = [user.id];
            logger.info(`Found user ${userEmail} with ID ${user.id}`);

            const userArtworks = await prisma.artwork.findMany({
                where: {
                    OR: [
                        { currentOwnerId: user.id },
                        { originalUploaderId: user.id }
                    ]
                },
                select: {
                    imageId: true
                }
            });

            imageIds = userArtworks.map(aw => aw.imageId);
            logger.info(`Found ${imageIds.length} images linked to user's artworks`);

            const userImageClaims = await prisma.imageClaim.findMany({
                where: {
                    userId: user.id
                },
                select: {
                    imageId: true
                }
            });

            const claimImageIds = userImageClaims.map(ic => ic.imageId);
            imageIds = [...new Set([...imageIds, ...claimImageIds])];
            logger.info(`Total unique images to reset: ${imageIds.length}`);
        } else {
            const processedImages = await prisma.image.findMany({
                where: {
                    OR: [
                        { detectionReport: { isNot: null } },
                        { status: 'COMPLETED' },
                        { status: 'PROCESSING' }
                    ]
                },
                select: {
                    id: true,
                    hash: true,
                    status: true
                }
            });

            logger.info(`Found ${processedImages.length} processed images to reset`);
            imageIds = processedImages.map(img => img.id);
        }

        if (imageIds.length === 0) {
            logger.info('No images found to reset.');
            return;
        }

        let deletedArtworks;
        if (userIds.length > 0) {
            deletedArtworks = await prisma.artwork.deleteMany({
                where: {
                    OR: [
                        { currentOwnerId: { in: userIds } },
                        { originalUploaderId: { in: userIds } }
                    ]
                }
            });
            logger.info(`Deleted ${deletedArtworks.count} artwork records for user`);
        } else if (imageIds.length > 0) {
            deletedArtworks = await prisma.artwork.deleteMany({
                where: {
                    imageId: { in: imageIds }
                }
            });
            logger.info(`Deleted ${deletedArtworks.count} artwork records`);
        } else {
            deletedArtworks = { count: 0 };
        }

        let deletedImageClaims;
        if (userIds.length > 0) {
            deletedImageClaims = await prisma.imageClaim.deleteMany({
                where: {
                    userId: { in: userIds }
                }
            });
            logger.info(`Deleted ${deletedImageClaims.count} image claim records for user`);
        } else if (imageIds.length > 0) {
            deletedImageClaims = await prisma.imageClaim.deleteMany({
                where: {
                    imageId: { in: imageIds }
                }
            });
            logger.info(`Deleted ${deletedImageClaims.count} image claim records`);
        } else {
            deletedImageClaims = { count: 0 };
        }

        const deletedReports = await prisma.detectionReport.deleteMany({
            where: {
                imageId: { in: imageIds }
            }
        });
        logger.info(`Deleted ${deletedReports.count} detection reports`);

        const deletedEdits = await prisma.editDetection.deleteMany({
            where: {
                imageId: { in: imageIds }
            }
        });
        logger.info(`Deleted ${deletedEdits.count} edit detection records`);

        const resetImages = await prisma.image.updateMany({
            where: {
                id: { in: imageIds }
            },
            data: {
                status: 'QUEUED'
            }
        });
        logger.info(`Reset ${resetImages.count} images to QUEUED status`);

        try {
            const redis = await getRedisClient();
            const queue = await inferenceQueueService.getQueue();

            let clearedJobs = 0;
            
            for (const imageId of imageIds) {
                const jobId = `inference-${imageId}`;
                try {
                    const job = await queue.getJob(jobId);
                    if (job) {
                        await job.remove();
                        clearedJobs++;
                        logger.debug(`Removed job ${jobId} for processed image`);
                    }
                } catch (error: any) {
                }

                try {
                    const keys = await redis.keys(`*${imageId}*`);
                    if (keys.length > 0) {
                        await redis.del(...keys);
                        logger.info(`Cleared ${keys.length} Redis keys for image ${imageId}`);
                    }
                } catch (error: any) {
                    logger.warn(`Error clearing Redis keys for image ${imageId}:`, error.message);
                }
            }
            
            try {
                const completedJobs = await queue.getJobs(['completed'], 0, 1000);
                const failedJobs = await queue.getJobs(['failed'], 0, 1000);
                
                let orphanedJobsCleared = 0;
                for (const job of [...completedJobs, ...failedJobs]) {
                    try {
                        await job.remove();
                        orphanedJobsCleared++;
                    } catch (error: any) {
                    }
                }
                
                if (orphanedJobsCleared > 0) {
                    logger.info(`Cleared ${orphanedJobsCleared} orphaned completed/failed jobs from queue`);
                }
            } catch (error: any) {
                logger.warn('Error clearing orphaned jobs (continuing anyway):', {
                    error: error.message
                });
            }

            logger.info(`Cleared ${clearedJobs} inference queue jobs from Redis`);
        } catch (redisError: any) {
            logger.warn('Error clearing Redis cache (continuing anyway):', {
                error: redisError.message
            });
        }

        logger.info('Successfully reset processed images. Images are now ready for reprocessing.');
        logger.info(`Summary:
            - Images reset: ${resetImages.count}
            - Artworks deleted: ${deletedArtworks.count}
            - Image claims deleted: ${deletedImageClaims.count}
            - Detection reports deleted: ${deletedReports.count}
            - Edit detections deleted: ${deletedEdits.count}
        `);

    } catch (error: any) {
        logger.error('Error resetting processed images', {
            error: error.message,
            code: error.code,
            stack: error.stack
        });
        throw error;
    } finally {
        await prisma.$disconnect();
        try {
            await inferenceQueueService.close();
        } catch (error) {
        }
    }
}

if (require.main === module) {
    const args = process.argv.slice(2);
    const userEmailArg = args.find(arg => arg.startsWith('--user='));
    const userEmail = userEmailArg ? userEmailArg.split('=')[1] : undefined;

    resetProcessedImages(userEmail)
        .then(() => {
            logger.info('Reset completed successfully');
            process.exit(0);
        })
        .catch((error) => {
            logger.error('Reset failed', { error: error.message });
            process.exit(1);
        });
}

export { resetProcessedImages };

