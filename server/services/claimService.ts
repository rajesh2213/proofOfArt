import { prisma } from '../config/prismaClient';
import { DatabaseError, ValidationError } from '../utils/errors';
import logger from '../utils/logger';
import { ImageClaim } from '../src/types/image';

export class ClaimService {

    /**
     * Require hash continuity when claim evidence includes a hash field.
     * No silent accept when evidence hash disagrees with stored image hash.
     */
    private async assertEvidenceHashContinuity(
        imageId: string,
        claimEvidenceMetadata?: any
    ): Promise<void> {
        if (!claimEvidenceMetadata || typeof claimEvidenceMetadata !== 'object') {
            return;
        }

        const evidenceHash =
            claimEvidenceMetadata.hash ||
            claimEvidenceMetadata.imageHash ||
            claimEvidenceMetadata.image_sha256 ||
            claimEvidenceMetadata.contentHash;

        if (!evidenceHash || typeof evidenceHash !== 'string') {
            return;
        }

        const image = await prisma.image.findUnique({
            where: { id: imageId },
            select: { hash: true }
        });

        if (!image) {
            throw new ValidationError('Image not found for claim', 'assertEvidenceHashContinuity');
        }

        if (evidenceHash !== image.hash) {
            logger.warn('Image claim refused: evidence hash mismatch', {
                imageId,
                evidenceHash: evidenceHash.substring(0, 16) + '...',
                storedHash: image.hash.substring(0, 16) + '...'
            });
            throw new ValidationError(
                'Claim evidence hash does not match stored image hash',
                'assertEvidenceHashContinuity'
            );
        }
    }

    async createImageClaim(
        userId: string, 
        imageId: string, 
        claimEvidenceMetadata?: any,
        sessionId?: string
    ): Promise<ImageClaim> {
        try {
            const existingClaim = await this.findClaimByUserAndImage(userId, imageId);
            if (existingClaim) {
                logger.warn('Attempt to create duplicate claim', { userId, imageId });
                throw new ValidationError('Claim already exists for this user and image', 'createImageClaim');
            }

            await this.assertEvidenceHashContinuity(imageId, claimEvidenceMetadata);

            const claim = await prisma.imageClaim.create({
                data: {
                    userId,
                    imageId,
                    claimEvidenceMetadata: claimEvidenceMetadata || null,
                    sessionId: sessionId || null,
                }
            });
            
            logger.info('Image claim created successfully', { 
                claimId: claim.id, 
                userId, 
                imageId 
            });
            
            return claim as unknown as ImageClaim;
        } catch (error: any) {
            if (error instanceof ValidationError) {
                throw error;
            }
            logger.error('Error creating image claim', { 
                error: error.message,
                code: error.code,
                meta: error.meta,
                userId,
                imageId
            });
            throw new DatabaseError('Error creating image claim', 'createImageClaim');
        }
    }
    
    async updateImageClaim(
        userId: string, 
        imageId: string, 
        claimEvidenceMetadata?: any, 
        sessionId?: string
    ): Promise<ImageClaim> {
        try {
            if (claimEvidenceMetadata !== undefined) {
                await this.assertEvidenceHashContinuity(imageId, claimEvidenceMetadata);
            }

            const updateData: any = {};
            if (claimEvidenceMetadata !== undefined) {
                updateData.claimEvidenceMetadata = claimEvidenceMetadata || null;
            }
            if (sessionId !== undefined) {
                updateData.sessionId = sessionId || null;
            }

            const claim = await prisma.imageClaim.update({
                where: { userId_imageId: { userId, imageId } },
                data: updateData,
            });
            
            logger.info('Image claim updated successfully', { 
                claimId: claim.id, 
                userId, 
                imageId 
            });
            
            return claim as unknown as ImageClaim;
        } catch (error: any) {
            if (error instanceof ValidationError) {
                throw error;
            }
            if (error.code === 'P2025') {
                logger.warn('Attempt to update non-existent claim', { userId, imageId });
                throw new ValidationError('Claim not found', 'updateImageClaim');
            }
            logger.error('Error updating image claim', { 
                error: error.message,
                code: error.code,
                meta: error.meta,
                userId,
                imageId
            });
            throw new DatabaseError('Error updating image claim', 'updateImageClaim');
        }
    }

    async findClaimByUserAndImage(userId: string, imageId: string): Promise<ImageClaim | null> {
        try {
            const claim = await prisma.imageClaim.findUnique({
                where: {
                    userId_imageId: {
                        userId,
                        imageId
                    }
                }
            });
            return claim as unknown as ImageClaim | null;
        } catch (error: any) {
            logger.error('Error finding claim by user and image', { 
                error: error.message,
                userId,
                imageId
            });
            throw new DatabaseError('Error finding claim', 'findClaimByUserAndImage');
        }
    }

    async findClaimBySessionId(imageId: string, sessionId: string): Promise<ImageClaim | null> {
        try {
            const claim = await prisma.imageClaim.findFirst({
                where: {
                    imageId,
                    sessionId
                }
            });
            return claim as unknown as ImageClaim | null;
        } catch (error: any) {
            logger.error('Error finding claim by session ID', { 
                error: error.message,
                imageId,
                sessionId
            });
            throw new DatabaseError('Error finding claim by session ID', 'findClaimBySessionId');
        }
    }

    async getClaimsByUserId(userId: string): Promise<ImageClaim[]> {
        try {
            const claims = await prisma.imageClaim.findMany({
                where: { userId },
                orderBy: { uploadDate: 'desc' }
            });
            return claims as unknown as ImageClaim[];
        } catch (error: any) {
            logger.error('Error fetching claims by user ID', { 
                error: error.message,
                userId
            });
            throw new DatabaseError('Error fetching claims by user ID', 'getClaimsByUserId');
        }
    }

    async getClaimsByImageId(imageId: string): Promise<ImageClaim[]> {
        try {
            const claims = await prisma.imageClaim.findMany({
                where: { imageId },
                orderBy: { uploadDate: 'desc' }
            });
            return claims as unknown as ImageClaim[];
        } catch (error: any) {
            logger.error('Error fetching claims by image ID', { 
                error: error.message,
                imageId
            });
            throw new DatabaseError('Error fetching claims by image ID', 'getClaimsByImageId');
        }
    }

    async deleteClaim(userId: string, imageId: string): Promise<boolean> {
        try {
            await prisma.imageClaim.delete({
                where: {
                    userId_imageId: {
                        userId,
                        imageId
                    }
                }
            });
            
            logger.info('Image claim deleted successfully', { userId, imageId });
            return true;
        } catch (error: any) {
            if (error.code === 'P2025') {
                logger.warn('Attempt to delete non-existent claim', { userId, imageId });
                throw new ValidationError('Claim not found', 'deleteClaim');
            }
            logger.error('Error deleting image claim', { 
                error: error.message,
                code: error.code,
                userId,
                imageId
            });
            throw new DatabaseError('Error deleting image claim', 'deleteClaim');
        }
    }
}

export const claimService = new ClaimService()