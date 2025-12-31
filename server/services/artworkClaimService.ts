import { prisma } from '../config/prismaClient';
import { DatabaseError, ValidationError } from '../utils/errors';
import logger from '../utils/logger';
import { artService } from './artService';
import { notificationService } from './notificationService';

export interface ArtworkClaimWithRelations {
    id: string;
    artworkId: string;
    requesterId: string;
    reason: string | null;
    status: string;
    reviewedById: string | null;
    reviewedAt: Date | null;
    createdAt: Date;
    updatedAt: Date;
    artwork: {
        id: string;
        imageId: string;
        currentOwnerId: string;
        originalUploaderId: string;
    };
    requester: {
        id: string;
        username: string;
        email: string;
    };
}

export class ArtworkClaimService {
    /**
     * Create a new artwork claim
     */
    async createClaim(
        artworkId: string,
        requesterId: string,
        reason?: string
    ): Promise<ArtworkClaimWithRelations> {
        try {
            const artwork = await prisma.artwork.findUnique({
                where: { id: artworkId },
                select: {
                    id: true,
                    currentOwnerId: true,
                    originalUploaderId: true
                }
            });

            if (!artwork) {
                throw new ValidationError('Artwork not found', 'createClaim');
            }

            if (artwork.currentOwnerId === requesterId) {
                throw new ValidationError('You already own this artwork', 'createClaim');
            }

            const existingClaim = await prisma.artworkClaim.findFirst({
                where: {
                    artworkId,
                    requesterId,
                    status: 'PENDING'
                }
            });

            if (existingClaim) {
                throw new ValidationError('You already have a pending claim for this artwork', 'createClaim');
            }

            const claim = await prisma.artworkClaim.create({
                data: {
                    artworkId,
                    requesterId,
                    reason: reason || null,
                    status: 'PENDING'
                },
                include: {
                    artwork: {
                        select: {
                            id: true,
                            imageId: true,
                            currentOwnerId: true,
                            originalUploaderId: true
                        }
                    },
                    requester: {
                        select: {
                            id: true,
                            username: true,
                            email: true
                        }
                    }
                }
            });

            logger.info('Artwork claim created', {
                claimId: claim.id,
                artworkId,
                requesterId
            });

            await notificationService.createNotification(
                artwork.currentOwnerId,
                'CLAIM_SUBMITTED',
                'New Ownership Claim',
                `A user has submitted a claim for artwork you own.`,
                artworkId,
                claim.id
            );

            await notificationService.createNotification(
                requesterId,
                'CLAIM_SUBMITTED',
                'Claim Submitted',
                `Your ownership claim has been submitted and is pending review.`,
                artworkId,
                claim.id
            );

            const admins = await prisma.user.findMany({
                where: { role: 'ADMIN' },
                select: { id: true }
            });

            for (const admin of admins) {
                await notificationService.createNotification(
                    admin.id,
                    'CLAIM_SUBMITTED',
                    'New Ownership Claim (Admin Review)',
                    `A new ownership claim has been submitted for artwork ${artworkId}.`,
                    artworkId,
                    claim.id
                );
            }

            return claim as unknown as ArtworkClaimWithRelations;
        } catch (error: any) {
            if (error instanceof ValidationError) {
                throw error;
            }
            logger.error('Error creating artwork claim', {
                error: error.message,
                artworkId,
                requesterId
            });
            throw new DatabaseError('Error creating artwork claim', 'createClaim');
        }
    }

    /**
     * Get user's claims
     */
    async getUserClaims(userId: string): Promise<ArtworkClaimWithRelations[]> {
        try {
            const claims = await prisma.artworkClaim.findMany({
                where: { requesterId: userId },
                include: {
                    artwork: {
                        select: {
                            id: true,
                            imageId: true,
                            currentOwnerId: true,
                            originalUploaderId: true
                        }
                    },
                    requester: {
                        select: {
                            id: true,
                            username: true,
                            email: true
                        }
                    }
                },
                orderBy: {
                    createdAt: 'desc'
                }
            });

            return claims as unknown as ArtworkClaimWithRelations[];
        } catch (error: any) {
            logger.error('Error fetching user claims', {
                error: error.message,
                userId
            });
            throw new DatabaseError('Error fetching claims', 'getUserClaims');
        }
    }

    /**
     * Get claims for an artwork
     */
    async getArtworkClaims(artworkId: string): Promise<ArtworkClaimWithRelations[]> {
        try {
            const claims = await prisma.artworkClaim.findMany({
                where: { artworkId },
                include: {
                    artwork: {
                        select: {
                            id: true,
                            imageId: true,
                            currentOwnerId: true,
                            originalUploaderId: true
                        }
                    },
                    requester: {
                        select: {
                            id: true,
                            username: true,
                            email: true
                        }
                    }
                },
                orderBy: {
                    createdAt: 'desc'
                }
            });

            return claims as unknown as ArtworkClaimWithRelations[];
        } catch (error: any) {
            logger.error('Error fetching artwork claims', {
                error: error.message,
                artworkId
            });
            throw new DatabaseError('Error fetching claims', 'getArtworkClaims');
        }
    }

    /**
     * Approve a claim (transfer ownership)
     */
    async approveClaim(
        claimId: string,
        reviewerId: string
    ): Promise<ArtworkClaimWithRelations> {
        try {
            const claim = await prisma.artworkClaim.findUnique({
                where: { id: claimId },
                include: {
                    artwork: {
                        select: {
                            id: true,
                            currentOwnerId: true
                        }
                    }
                }
            });

            if (!claim) {
                throw new ValidationError('Claim not found', 'approveClaim');
            }

            if (claim.status !== 'PENDING') {
                throw new ValidationError(`Claim is already ${claim.status}`, 'approveClaim');
            }

            await artService.transferOwnership(
                claim.artworkId,
                claim.requesterId,
                claimId,
                'CLAIM_APPROVED'
            );

            const updatedClaim = await prisma.artworkClaim.update({
                where: { id: claimId },
                data: {
                    status: 'APPROVED',
                    reviewedById: reviewerId,
                    reviewedAt: new Date()
                },
                include: {
                    artwork: {
                        select: {
                            id: true,
                            imageId: true,
                            currentOwnerId: true,
                            originalUploaderId: true
                        }
                    },
                    requester: {
                        select: {
                            id: true,
                            username: true,
                            email: true
                        }
                    }
                }
            });

            logger.info('Artwork claim approved', {
                claimId,
                artworkId: claim.artworkId,
                newOwnerId: claim.requesterId
            });

            await notificationService.createNotification(
                claim.requesterId,
                'CLAIM_APPROVED',
                'Claim Approved',
                'Your ownership claim has been approved. You are now the owner of this artwork.',
                claim.artworkId,
                claimId
            );

            await notificationService.createNotification(
                claim.artwork.currentOwnerId,
                'OWNERSHIP_TRANSFERRED',
                'Ownership Transferred',
                'Your artwork ownership has been transferred due to an approved claim.',
                claim.artworkId,
                claimId
            );

            return updatedClaim as unknown as ArtworkClaimWithRelations;
        } catch (error: any) {
            if (error instanceof ValidationError) {
                throw error;
            }
            logger.error('Error approving claim', {
                error: error.message,
                claimId
            });
            throw new DatabaseError('Error approving claim', 'approveClaim');
        }
    }

    /**
     * Reject a claim
     */
    async rejectClaim(
        claimId: string,
        reviewerId: string
    ): Promise<ArtworkClaimWithRelations> {
        try {
            const claim = await prisma.artworkClaim.findUnique({
                where: { id: claimId }
            });

            if (!claim) {
                throw new ValidationError('Claim not found', 'rejectClaim');
            }

            if (claim.status !== 'PENDING') {
                throw new ValidationError(`Claim is already ${claim.status}`, 'rejectClaim');
            }

            const updatedClaim = await prisma.artworkClaim.update({
                where: { id: claimId },
                data: {
                    status: 'REJECTED',
                    reviewedById: reviewerId,
                    reviewedAt: new Date()
                },
                include: {
                    artwork: {
                        select: {
                            id: true,
                            imageId: true,
                            currentOwnerId: true,
                            originalUploaderId: true
                        }
                    },
                    requester: {
                        select: {
                            id: true,
                            username: true,
                            email: true
                        }
                    }
                }
            });

            logger.info('Artwork claim rejected', {
                claimId,
                artworkId: claim.artworkId
            });

            await notificationService.createNotification(
                claim.requesterId,
                'CLAIM_REJECTED',
                'Claim Rejected',
                'Your ownership claim has been rejected.',
                claim.artworkId,
                claimId
            );

            return updatedClaim as unknown as ArtworkClaimWithRelations;
        } catch (error: any) {
            if (error instanceof ValidationError) {
                throw error;
            }
            logger.error('Error rejecting claim', {
                error: error.message,
                claimId
            });
            throw new DatabaseError('Error rejecting claim', 'rejectClaim');
        }
    }

    /**
     * Get claim by ID
     */
    async getClaimById(claimId: string): Promise<ArtworkClaimWithRelations | null> {
        try {
            const claim = await prisma.artworkClaim.findUnique({
                where: { id: claimId },
                include: {
                    artwork: {
                        select: {
                            id: true,
                            imageId: true,
                            currentOwnerId: true,
                            originalUploaderId: true
                        }
                    },
                    requester: {
                        select: {
                            id: true,
                            username: true,
                            email: true
                        }
                    }
                }
            });

            return claim as unknown as ArtworkClaimWithRelations | null;
        } catch (error: any) {
            logger.error('Error fetching claim by ID', {
                error: error.message,
                claimId
            });
            throw new DatabaseError('Error fetching claim', 'getClaimById');
        }
    }
}

export const artworkClaimService = new ArtworkClaimService();

