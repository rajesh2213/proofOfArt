import { prisma } from '../config/prismaClient';
import { DatabaseError, ValidationError } from '../utils/errors';
import logger from '../utils/logger';
import { proofService, EmbeddedProof } from './proofService';

export interface ArtworkWithRelations {
    id: string;
    imageId: string;
    originalUploaderId: string;
    currentOwnerId: string;
    embeddedProof: EmbeddedProof | null;
    proofMetadata?: any;
    createdAt: Date;
    updatedAt: Date;
    image: {
        id: string;
        hash: string;
        url: string;
        filename: string | null;
        status: string;
        detectionReport: {
            aiProbability: number;
            detectedLabel: string;
        } | null;
        editDetections: Array<{
            editType: string;
            maskUrl: string;
            confidence: number;
        }>;
    };
    originalUploader: {
        id: string;
        username: string;
        email: string;
    };
    currentOwner: {
        id: string;
        username: string;
        email: string;
    };
    claims: Array<{
        id: string;
        requesterId: string;
        reason: string | null;
        status: string;
        createdAt: Date;
    }>;
}

export class ArtService {
    /**
     * Create artwork from uploaded image
     */
    async createArtwork(
        imageId: string,
        uploaderId: string,
        proof: EmbeddedProof
    ): Promise<ArtworkWithRelations> {
        try {
            const artwork = await prisma.artwork.create({
                data: {
                    imageId,
                    originalUploaderId: uploaderId,
                    currentOwnerId: uploaderId,
                    embeddedProof: proof as any,
                },
                include: {
                    image: {
                        include: {
                            detectionReport: true,
                            editDetections: true,
                        }
                    },
                    originalUploader: {
                        select: {
                            id: true,
                            username: true,
                            email: true,
                        }
                    },
                    currentOwner: {
                        select: {
                            id: true,
                            username: true,
                            email: true,
                        }
                    },
                    claims: {
                        select: {
                            id: true,
                            requesterId: true,
                            reason: true,
                            status: true,
                            createdAt: true,
                        },
                        orderBy: {
                            createdAt: 'desc'
                        }
                    }
                }
            });

            await prisma.ownershipHistory.create({
                data: {
                    artworkId: artwork.id,
                    newOwnerId: uploaderId,
                    transferType: 'UPLOAD',
                }
            });

            logger.info('Artwork created successfully', {
                artworkId: artwork.id,
                imageId,
                uploaderId
            });

            return artwork as unknown as ArtworkWithRelations;
        } catch (error: any) {
            if (error.code === 'P2002') {
                logger.warn('Artwork already exists for image', { imageId });
                throw new ValidationError('Artwork already exists for this image', 'createArtwork');
            }
            logger.error('Error creating artwork', {
                error: error.message,
                imageId,
                uploaderId
            });
            throw new DatabaseError('Error creating artwork', 'createArtwork');
        }
    }

    /**
     * Get artwork by image ID
     */
    async getArtworkByImageId(imageId: string): Promise<ArtworkWithRelations | null> {
        try {
            const artwork = await prisma.artwork.findUnique({
                where: { imageId },
                include: {
                    image: {
                        include: {
                            detectionReport: true,
                            editDetections: true,
                        }
                    },
                    originalUploader: {
                        select: {
                            id: true,
                            username: true,
                            email: true,
                        }
                    },
                    currentOwner: {
                        select: {
                            id: true,
                            username: true,
                            email: true,
                        }
                    },
                    claims: {
                        select: {
                            id: true,
                            requesterId: true,
                            reason: true,
                            status: true,
                            createdAt: true,
                        },
                        orderBy: {
                            createdAt: 'desc'
                        }
                    }
                }
            });

            return artwork as unknown as ArtworkWithRelations | null;
        } catch (error: any) {
            logger.error('Error fetching artwork by image ID', {
                error: error.message,
                imageId
            });
            throw new DatabaseError('Error fetching artwork', 'getArtworkByImageId');
        }
    }

    /**
     * Get artwork by ID
     */
    async getArtworkById(artworkId: string): Promise<ArtworkWithRelations | null> {
        try {
            const artwork = await prisma.artwork.findUnique({
                where: { id: artworkId },
                include: {
                    image: {
                        include: {
                            detectionReport: true,
                            editDetections: true,
                        }
                    },
                    originalUploader: {
                        select: {
                            id: true,
                            username: true,
                            email: true,
                        }
                    },
                    currentOwner: {
                        select: {
                            id: true,
                            username: true,
                            email: true,
                        }
                    },
                    claims: {
                        select: {
                            id: true,
                            requesterId: true,
                            reason: true,
                            status: true,
                            createdAt: true,
                        },
                        orderBy: {
                            createdAt: 'desc'
                        }
                    }
                }
            });

            return artwork as unknown as ArtworkWithRelations | null;
        } catch (error: any) {
            logger.error('Error fetching artwork by ID', {
                error: error.message,
                artworkId
            });
            throw new DatabaseError('Error fetching artwork', 'getArtworkById');
        }
    }

    /**
     * Get user's owned artworks (My Art Gallery)
     */
    async getUserOwnedArtworks(
        userId: string,
        limit: number = 50,
        offset: number = 0
    ): Promise<ArtworkWithRelations[]> {
        try {
            const artworks = await prisma.artwork.findMany({
                where: {
                    currentOwnerId: userId
                },
                include: {
                    image: {
                        include: {
                            detectionReport: true,
                            editDetections: true,
                        }
                    },
                    originalUploader: {
                        select: {
                            id: true,
                            username: true,
                            email: true,
                        }
                    },
                    currentOwner: {
                        select: {
                            id: true,
                            username: true,
                            email: true,
                        }
                    },
                    claims: {
                        select: {
                            id: true,
                            requesterId: true,
                            reason: true,
                            status: true,
                            createdAt: true,
                        },
                        orderBy: {
                            createdAt: 'desc'
                        }
                    }
                },
                orderBy: {
                    createdAt: 'desc'
                },
                take: limit,
                skip: offset
            });

            return artworks as unknown as ArtworkWithRelations[];
        } catch (error: any) {
            logger.error('Error fetching user owned artworks', {
                error: error.message,
                userId
            });
            throw new DatabaseError('Error fetching artworks', 'getUserOwnedArtworks');
        }
    }

    /**
     * Get user's uploaded artworks (all artworks where originalUploaderId === userId)
     * This includes all artworks uploaded by the user, regardless of madeByMe flag,
     * ownership transfers, or claim status.
     */
    async getUserUploadedArtworks(
        userId: string,
        limit: number = 50,
        offset: number = 0
    ): Promise<ArtworkWithRelations[]> {
        try {
            const user = await prisma.user.findUnique({
                where: { id: userId },
                select: {
                    id: true,
                    username: true,
                    email: true,
                }
            });

            if (!user) {
                throw new ValidationError('User not found', 'getUserUploadedArtworks');
            }

            // Get all artworks where originalUploaderId === userId
            const artworks = await prisma.artwork.findMany({
                where: {
                    originalUploaderId: userId
                },
                include: {
                    image: {
                        include: {
                            detectionReport: true,
                            editDetections: true,
                        }
                    },
                    originalUploader: {
                        select: {
                            id: true,
                            username: true,
                            email: true,
                        }
                    },
                    currentOwner: {
                        select: {
                            id: true,
                            username: true,
                            email: true,
                        }
                    },
                    claims: {
                        select: {
                            id: true,
                            requesterId: true,
                            reason: true,
                            status: true,
                            createdAt: true,
                        },
                        orderBy: {
                            createdAt: 'desc'
                        }
                    }
                },
                orderBy: {
                    createdAt: 'desc'
                },
                take: limit,
                skip: offset
            });

            const transformedArtworks: ArtworkWithRelations[] = artworks.map((artwork) => {
                return {
                    ...artwork,
                    image: {
                        id: artwork.image.id,
                        hash: artwork.image.hash,
                        url: artwork.image.url,
                        filename: artwork.image.filename,
                        status: artwork.image.status,
                        detectionReport: artwork.image.detectionReport ? {
                            aiProbability: artwork.image.detectionReport.aiProbability,
                            detectedLabel: artwork.image.detectionReport.detectedLabel,
                        } : null,
                        editDetections: artwork.image.editDetections.map(ed => ({
                            editType: ed.editType,
                            maskUrl: ed.maskUrl,
                            confidence: ed.confidence,
                        })),
                    },
                    originalUploader: artwork.originalUploader,
                    currentOwner: artwork.currentOwner,
                    claims: artwork.claims,
                } as ArtworkWithRelations;
            });

            return transformedArtworks;
        } catch (error: any) {
            if (error instanceof ValidationError) {
                throw error;
            }
            logger.error('Error fetching user uploaded artworks', {
                error: error.message,
                userId
            });
            throw new DatabaseError('Error fetching artworks', 'getUserUploadedArtworks');
        }
    }

    /**
     * Transfer artwork ownership (used when claim is approved)
     */
    async transferOwnership(
        artworkId: string,
        newOwnerId: string,
        claimId: string | null,
        transferType: 'CLAIM_APPROVED' | 'ADMIN_TRANSFER' = 'CLAIM_APPROVED'
    ): Promise<ArtworkWithRelations> {
        try {
            const artwork = await prisma.artwork.findUnique({
                where: { id: artworkId },
                select: { currentOwnerId: true }
            });

            if (!artwork) {
                throw new ValidationError('Artwork not found', 'transferOwnership');
            }

            const previousOwnerId = artwork.currentOwnerId;

            const updatedArtwork = await prisma.artwork.update({
                where: { id: artworkId },
                data: {
                    currentOwnerId: newOwnerId
                },
                include: {
                    image: {
                        include: {
                            detectionReport: true,
                            editDetections: true,
                        }
                    },
                    originalUploader: {
                        select: {
                            id: true,
                            username: true,
                            email: true,
                        }
                    },
                    currentOwner: {
                        select: {
                            id: true,
                            username: true,
                            email: true,
                        }
                    },
                    claims: {
                        select: {
                            id: true,
                            requesterId: true,
                            reason: true,
                            status: true,
                            createdAt: true,
                        },
                        orderBy: {
                            createdAt: 'desc'
                        }
                    }
                }
            });

            await prisma.ownershipHistory.create({
                data: {
                    artworkId,
                    previousOwnerId,
                    newOwnerId,
                    transferType,
                    claimId: claimId || null
                }
            });

            logger.info('Artwork ownership transferred', {
                artworkId,
                previousOwnerId,
                newOwnerId,
                transferType
            });

            return updatedArtwork as unknown as ArtworkWithRelations;
        } catch (error: any) {
            if (error instanceof ValidationError) {
                throw error;
            }
            logger.error('Error transferring ownership', {
                error: error.message,
                artworkId,
                newOwnerId
            });
            throw new DatabaseError('Error transferring ownership', 'transferOwnership');
        }
    }

    /**
     * Verify proof for an artwork
     */
    async verifyArtworkProof(artworkId: string, currentImageHash: string): Promise<{
        isValid: boolean;
        wasEdited: boolean;
        originalMetadata: EmbeddedProof | null;
        currentHash: string;
        error?: string;
    }> {
        try {
            const artwork = await prisma.artwork.findUnique({
                where: { id: artworkId },
                select: {
                    embeddedProof: true,
                    image: {
                        select: {
                            hash: true
                        }
                    }
                }
            });

            if (!artwork) {
                return {
                    isValid: false,
                    wasEdited: false,
                    originalMetadata: null,
                    currentHash: currentImageHash,
                    error: 'Artwork not found'
                };
            }

            const storedProof = artwork.embeddedProof as EmbeddedProof | null;
            const storedHash = artwork.image.hash;

            const verification = proofService.verifyProofFromDatabase(
                storedProof,
                currentImageHash || storedHash
            );

            return verification;
        } catch (error: any) {
            logger.error('Error verifying artwork proof', {
                error: error.message,
                artworkId
            });
            return {
                isValid: false,
                wasEdited: false,
                originalMetadata: null,
                currentHash: currentImageHash,
                error: error.message
            };
        }
    }

    /**
     * Update artwork proof metadata
     */
    async updateArtworkProofMetadata(artworkId: string, proofMetadata: any): Promise<void> {
        try {
            await prisma.artwork.update({
                where: { id: artworkId },
                data: {
                    proofMetadata: proofMetadata as any,
                },
            });
        } catch (error: any) {
            logger.error('Error updating artwork proof metadata', {
                error: error.message,
                artworkId
            });
            throw new DatabaseError('Failed to update proof metadata', 'updateArtworkProofMetadata');
        }
    }
}

export const artService = new ArtService();

