import { ImageMetaData, ImageModel } from '../src/types/image';
import { prisma } from '../config/prismaClient';
import { DatabaseError, ValidationError } from '../utils/errors';
import logger from '../utils/logger';

type ImageStatus = 'QUEUED' | 'PROCESSING' | 'COMPLETED' | 'FAILED';

export class ImageService {

    async createImage(
        hash: string,
        url: string,
        filename?: string,
        metadata?: ImageMetaData
    ): Promise<ImageModel> {
        try {
            if (!url || (!url.startsWith('http://') && !url.startsWith('https://'))) {
                throw new ValidationError('Invalid image URL format', 'createImage');
            }

            const image = await prisma.image.create({
                data: {
                    hash,
                    url,
                    filename: filename || null,
                    status: 'QUEUED',
                    metadata: metadata ? metadata as any : null,
                },
                include: {
                    imageClaims: true,
                    detectionReport: true
                }
            });
            
            logger.info('Image created successfully', {
                imageId: image.id,
                hash: hash.substring(0, 16) + '...'
            });
            
            return image as unknown as ImageModel;
        } catch (error: any) {
            if (error instanceof ValidationError) {
                throw error;
            }
            if (error.code === 'P2002') {
                logger.warn('Attempt to create duplicate image', { hash: hash.substring(0, 16) + '...' });
                throw new ValidationError('Image with this hash already exists', 'createImage');
            }
            logger.error('Error creating image:', {
                error: error.message,
                code: error.code,
                meta: error.meta,
                hash: hash.substring(0, 16) + '...'
            });
            throw new DatabaseError(
                error.message || 'Error creating image',
                'ImageService.createImage'
            );
        }
    }

    async getImageByHash(hash: string, includeClaims: boolean = true): Promise<ImageModel | null> {
        try {
            const image = await prisma.image.findUnique({
                where: { hash },
                include: {
                    imageClaims: includeClaims,
                    detectionReport: true
                }
            });
            return image as unknown as ImageModel || null;
        } catch (error: any) {
            logger.error('Error fetching image by hash:', {
                error: error.message,
                code: error.code,
                meta: error.meta,
                hash: hash.substring(0, 16) + '...'
            });
            throw new DatabaseError(
                error.message || 'Error fetching image by hash',
                'ImageService.getImageByHash'
            );
        }
    }

    async getImageById(id: string, includeClaims: boolean = true): Promise<ImageModel | null> {
        try {
            const image = await prisma.image.findUnique({
                where: { id },
                include: {
                    imageClaims: includeClaims,
                    detectionReport: true
                }
            });
            return image as unknown as ImageModel | null;
        } catch (error: any) {
            logger.error('Error fetching image by ID:', {
                error: error.message,
                code: error.code,
                meta: error.meta,
                imageId: id
            });
            throw new DatabaseError(
                error.message || 'Error fetching image by ID',
                'ImageService.getImageById'
            );
        }
    }

    async updateStatus(imageId: string, status: ImageStatus): Promise<ImageModel> {
        try {
            const image = await prisma.image.update({
                where: { id: imageId },
                data: { status },
                include: {
                    imageClaims: true,
                    detectionReport: true
                }
            });
            
            logger.info('Image status updated', {
                imageId,
                status
            });
            
            return image as unknown as ImageModel;
        } catch (error: any) {
            if (error.code === 'P2025') {
                logger.warn('Attempt to update non-existent image', { imageId });
                throw new ValidationError('Image not found', 'updateStatus');
            }
            logger.error('Error updating image status:', {
                error: error.message,
                code: error.code,
                meta: error.meta,
                imageId,
                status
            });
            throw new DatabaseError(
                error.message || 'Error updating image status',
                'ImageService.updateStatus'
            );
        }
    }

    async updateMetadata(imageId: string, metadata: Partial<ImageMetaData>): Promise<ImageModel> {
        try {
            const existingImage = await prisma.image.findUnique({
                where: { id: imageId },
                select: { metadata: true }
            });

            if (!existingImage) {
                throw new ValidationError('Image not found', 'updateMetadata');
            }

            const mergedMetadata = {
                ...(existingImage.metadata as any || {}),
                ...metadata
            };

            const image = await prisma.image.update({
                where: { id: imageId },
                data: { metadata: mergedMetadata },
                include: {
                    imageClaims: true,
                    detectionReport: true
                }
            });
            
            logger.info('Image metadata updated', { imageId });
            return image as unknown as ImageModel;
        } catch (error: any) {
            if (error instanceof ValidationError) {
                throw error;
            }
            if (error.code === 'P2025') {
                logger.warn('Attempt to update metadata for non-existent image', { imageId });
                throw new ValidationError('Image not found', 'updateMetadata');
            }
            logger.error('Error updating image metadata:', {
                error: error.message,
                code: error.code,
                imageId
            });
            throw new DatabaseError(
                error.message || 'Error updating image metadata',
                'ImageService.updateMetadata'
            );
        }
    }

    async getImagesByUserId(
        userId: string, 
        limit: number = 50, 
        offset: number = 0
    ): Promise<ImageModel[]> {
        try {
            const images = await prisma.image.findMany({
                where: {
                    imageClaims: {
                        some: {
                            userId
                        }
                    }
                },
                include: {
                    imageClaims: true,
                    detectionReport: true
                },
                orderBy: {
                    createdAt: 'desc'
                },
                take: limit,
                skip: offset
            });
            return images as unknown as ImageModel[];
        } catch (error: any) {
            logger.error('Error fetching images by user ID:', {
                error: error.message,
                userId
            });
            throw new DatabaseError(
                error.message || 'Error fetching images by user ID',
                'ImageService.getImagesByUserId'
            );
        }
    }

    async getImagesByStatus(
        status: ImageStatus,
        limit: number = 50,
        offset: number = 0
    ): Promise<ImageModel[]> {
        try {
            const images = await prisma.image.findMany({
                where: { status },
                include: {
                    imageClaims: true,
                    detectionReport: true
                },
                orderBy: {
                    createdAt: 'desc'
                },
                take: limit,
                skip: offset
            });
            return images as unknown as ImageModel[];
        } catch (error: any) {
            logger.error('Error fetching images by status:', {
                error: error.message,
                status
            });
            throw new DatabaseError(
                error.message || 'Error fetching images by status',
                'ImageService.getImagesByStatus'
            );
        }
    }

    async deleteImage(imageId: string): Promise<boolean> {
        try {
            await prisma.image.delete({
                where: { id: imageId }
            });
            
            logger.info('Image deleted successfully', { imageId });
            return true;
        } catch (error: any) {
            if (error.code === 'P2025') {
                logger.warn('Attempt to delete non-existent image', { imageId });
                throw new ValidationError('Image not found', 'deleteImage');
            }
            logger.error('Error deleting image:', {
                error: error.message,
                code: error.code,
                imageId
            });
            throw new DatabaseError(
                error.message || 'Error deleting image',
                'ImageService.deleteImage'
            );
        }
    }
}

export const imageService = new ImageService();
