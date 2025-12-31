import { Request, Response, NextFunction } from 'express';
import { catchAsync } from '../middleware/errorHandler';
import { artService } from '../services/artService';
import { ValidationError } from '../utils/errors';
import logger from '../utils/logger';
import { imageService } from '../services/imageService';
import { proofService } from '../services/proofService';
import { imageMetadataEmbedder } from '../services/imageMetadataEmbedder';
import { keyStoreService } from '../services/keyStoreService';
import { cryptographicSigner } from '../services/cryptographicSigner';
import axios from 'axios';
import crypto from 'crypto';

export class ArtController {
    /**
     * GET /api/art?filter=all|uploaded|claimed
     * Get artworks with filter support
     */
    getArtworks = catchAsync(async (req: Request, res: Response, next: NextFunction): Promise<void> => {
        const userId = (req as any).user?.id;
        if (!userId) {
            throw new ValidationError('User not authenticated', 'getArtworks');
        }

        const filter = (req.query.filter as string) || 'all';
        const limit = parseInt(req.query.limit as string) || 50;
        const offset = parseInt(req.query.offset as string) || 0;

        let artworks: any[] = [];
        
        switch (filter) {
            case 'uploaded':
                artworks = await artService.getUserUploadedArtworks(userId, limit, offset);
                break;
            case 'claimed':
                const ownedArtworks = await artService.getUserOwnedArtworks(userId, 1000, 0);
                artworks = ownedArtworks.filter(
                    artwork => artwork.originalUploaderId !== userId
                ).slice(offset, offset + limit);
                break;
            case 'all':
            default:
                artworks = await artService.getUserOwnedArtworks(userId, limit, offset);
                break;
        }

        res.status(200).json({
            success: true,
            message: 'Artworks retrieved successfully',
            data: {
                artworks,
                count: artworks.length,
                limit,
                offset,
                filter
            }
        });
    });

    /**
     * GET /api/art/my-gallery
     * Get user's owned artworks (My Art Gallery)
     */
    getMyGallery = catchAsync(async (req: Request, res: Response, next: NextFunction): Promise<void> => {
        const userId = (req as any).user?.id;
        if (!userId) {
            throw new ValidationError('User not authenticated', 'getMyGallery');
        }

        const limit = parseInt(req.query.limit as string) || 50;
        const offset = parseInt(req.query.offset as string) || 0;

        const artworks = await artService.getUserOwnedArtworks(userId, limit, offset);

        res.status(200).json({
            success: true,
            message: 'Artworks retrieved successfully',
            data: {
                artworks,
                count: artworks.length,
                limit,
                offset
            }
        });
    });

    /**
     * GET /api/art/uploaded
     * Get user's uploaded artworks
     */
    getMyUploadedArtworks = catchAsync(async (req: Request, res: Response, next: NextFunction): Promise<void> => {
        const userId = (req as any).user?.id;
        if (!userId) {
            throw new ValidationError('User not authenticated', 'getMyUploadedArtworks');
        }

        const limit = parseInt(req.query.limit as string) || 50;
        const offset = parseInt(req.query.offset as string) || 0;

        const artworks = await artService.getUserUploadedArtworks(userId, limit, offset);

        res.status(200).json({
            success: true,
            message: 'Uploaded artworks retrieved successfully',
            data: {
                artworks,
                count: artworks.length,
                limit,
                offset
            }
        });
    });

    /**
     * GET /api/art/claimed
     * Get artworks claimed by user (through approved claims)
     */
    getMyClaimedArtworks = catchAsync(async (req: Request, res: Response, next: NextFunction): Promise<void> => {
        const userId = (req as any).user?.id;
        if (!userId) {
            throw new ValidationError('User not authenticated', 'getMyClaimedArtworks');
        }

        const ownedArtworks = await artService.getUserOwnedArtworks(userId, 1000, 0);
        const claimedArtworks = ownedArtworks.filter(
            artwork => artwork.originalUploaderId !== userId
        );

        const limit = parseInt(req.query.limit as string) || 50;
        const offset = parseInt(req.query.offset as string) || 0;

        const paginatedArtworks = claimedArtworks.slice(offset, offset + limit);

        res.status(200).json({
            success: true,
            message: 'Claimed artworks retrieved successfully',
            data: {
                artworks: paginatedArtworks,
                count: paginatedArtworks.length,
                total: claimedArtworks.length,
                limit,
                offset
            }
        });
    });

    /**
     * GET /api/art/:id
     * Get artwork by ID (or image ID for virtual artworks)
     */
    getArtworkById = catchAsync(async (req: Request, res: Response, next: NextFunction): Promise<void> => {
        const artworkId = req.params.id;

        if (artworkId.startsWith('virtual-')) {
            const imageId = artworkId.replace('virtual-', '');
            const artwork = await artService.getArtworkByImageId(imageId);
            
            if (!artwork) {
                res.status(404).json({
                    success: false,
                    message: 'Artwork not found',
                    data: null
                });
                return;
            }

            res.status(200).json({
                success: true,
                message: 'Artwork retrieved successfully',
                data: {
                    artwork
                }
            });
            return;
        }

        const artwork = await artService.getArtworkById(artworkId);

        if (!artwork) {
            res.status(404).json({
                success: false,
                message: 'Artwork not found',
                data: null
            });
            return;
        }

        res.status(200).json({
            success: true,
            message: 'Artwork retrieved successfully',
            data: {
                artwork
            }
        });
    });

    /**
     * GET /api/art/image/:imageId
     * Get artwork by image ID (for virtual artworks)
     */
    getArtworkByImageId = catchAsync(async (req: Request, res: Response, next: NextFunction): Promise<void> => {
        const imageId = req.params.imageId;

        const artwork = await artService.getArtworkByImageId(imageId);

        if (!artwork) {
            res.status(404).json({
                success: false,
                message: 'Artwork not found for this image',
                data: null
            });
            return;
        }

        res.status(200).json({
            success: true,
            message: 'Artwork retrieved successfully',
            data: {
                artwork
            }
        });
    });

    /**
     * GET /api/art/:id/verify-proof
     * Verify proof for an artwork
     */
    verifyProof = catchAsync(async (req: Request, res: Response, next: NextFunction): Promise<void> => {
        const artworkId = req.params.id;
        const currentHash = req.query.hash as string | undefined;

        const artwork = await artService.getArtworkById(artworkId);

        if (!artwork) {
            res.status(404).json({
                success: false,
                message: 'Artwork not found',
                data: null
            });
            return;
        }

        let imageHash = currentHash;
        if (!imageHash) {
            const image = await imageService.getImageById(artwork.imageId);
            if (image) {
                imageHash = image.hash;
            }
        }

        if (!imageHash) {
            res.status(400).json({
                success: false,
                message: 'Could not determine image hash',
                data: null
            });
            return;
        }

        const verification = await artService.verifyArtworkProof(artworkId, imageHash);

        res.status(200).json({
            success: true,
            message: 'Proof verification completed',
            data: {
                verification,
                artworkId
            }
        });
    });

    /**
     * GET /api/art/:imageId/download?signer=system|artist
     * Download artwork with embedded signed metadata
     */
    downloadArtwork = catchAsync(async (req: Request, res: Response, next: NextFunction): Promise<void> => {
        const imageId = req.params.imageId;
        const signer = (req.query.signer as string) || 'system';
        const userId = (req as any).user?.id;

        if (!userId) {
            throw new ValidationError('User not authenticated', 'downloadArtwork');
        }

        const artwork = await artService.getArtworkByImageId(imageId);
        if (!artwork) {
            res.status(404).json({
                success: false,
                message: 'Artwork not found',
                data: null
            });
            return;
        }

        if (artwork.currentOwnerId !== userId && artwork.originalUploaderId !== userId) {
            res.status(403).json({
                success: false,
                message: 'You do not have permission to download this artwork',
                data: null
            });
            return;
        }

        const image = await imageService.getImageById(imageId);
        if (!image) {
            res.status(404).json({
                success: false,
                message: 'Image not found',
                data: null
            });
            return;
        }

        let imageBuffer: Buffer;
        try {
            const response = await axios.get(image.url, {
                responseType: 'arraybuffer',
                timeout: 30000,
            });
            imageBuffer = Buffer.from(response.data);
        } catch (error: any) {
            logger.error('Error downloading image from Cloudinary', {
                error: error.message,
                imageUrl: image.url
            });
            res.status(500).json({
                success: false,
                message: 'Failed to download image',
                data: null
            });
            return;
        }

        let proofMetadata = artwork.proofMetadata as any;
        
        if (!proofMetadata || signer === 'system') {
            const aiScore = artwork.image.detectionReport?.aiProbability || 0;
            const isAiGenerated = artwork.image.detectionReport?.detectedLabel === 'AI_GENERATED';
            const tamperDetected = (artwork.image.editDetections?.length || 0) > 0;
            const imageHash = imageMetadataEmbedder.calculateImageHash(imageBuffer);

            proofMetadata = await proofService.createSignedProofMetadata(
                aiScore,
                isAiGenerated,
                tamperDetected,
                imageHash
            );

            await artService.updateArtworkProofMetadata(artwork.id, proofMetadata);
        }

        const mimeType = imageMetadataEmbedder.detectMimeType(imageBuffer);
        const imageWithMetadata = await imageMetadataEmbedder.embedMetadata(
            imageBuffer,
            proofMetadata,
            mimeType
        );

        const filename = (image.filename || 'artwork').replace(/[^a-zA-Z0-9.-]/g, '_');
        const extension = mimeType.includes('jpeg') || mimeType.includes('jpg') ? 'jpg' : 'png';
        const downloadFilename = `${filename}-proof.${extension}`;

        res.setHeader('Content-Type', mimeType);
        res.setHeader('Content-Disposition', `attachment; filename="${downloadFilename}"`);
        res.setHeader('Content-Length', imageWithMetadata.length.toString());

        logger.info('Artwork downloaded with embedded metadata', {
            artworkId: artwork.id,
            imageId,
            userId,
            signer,
            filename: downloadFilename
        });

        res.send(imageWithMetadata);
    });

    /**
     * POST /api/art/verify-embedded
     * Verify embedded metadata in uploaded image file
     */
    verifyEmbeddedMetadata = catchAsync(async (req: Request, res: Response, next: NextFunction): Promise<void> => {
        const file = (req as any).file;
        if (!file) {
            res.status(400).json({
                success: false,
                message: 'No image file provided',
                data: null
            });
            return;
        }

        const imageBuffer = file.buffer;
        const mimeType = file.mimetype || imageMetadataEmbedder.detectMimeType(imageBuffer);

        const extractedMetadata = await imageMetadataEmbedder.extractMetadata(imageBuffer, mimeType);
        
        if (!extractedMetadata) {
            res.status(400).json({
                success: false,
                message: 'No embedded metadata found in image',
                data: {
                    valid: false,
                    reason: 'No metadata found'
                }
            });
            return;
        }

        const keyRecord = await keyStoreService.getActiveKeyByKid(extractedMetadata.signer_kid);
        if (!keyRecord) {
            res.status(400).json({
                success: false,
                message: 'Signer key not found or revoked',
                data: {
                    valid: false,
                    reason: 'Signer key not found',
                    metadata: extractedMetadata
                }
            });
            return;
        }

        const isValid = await cryptographicSigner.verifySignature(
            extractedMetadata,
            keyRecord.publicKeyPem
        );

        const currentHash = imageMetadataEmbedder.calculateImageHash(imageBuffer);
        const hashMatches = currentHash === extractedMetadata.image_sha256;

        res.status(200).json({
            success: true,
            message: 'Verification completed',
            data: {
                valid: isValid && hashMatches,
                reason: !isValid ? 'Invalid signature' : !hashMatches ? 'Image hash mismatch (image may have been modified)' : undefined,
                metadata: extractedMetadata,
                currentHash,
                hashMatches,
                signatureValid: isValid
            }
        });
    });

    /**
     * POST /api/artist/public-key
     * Upload artist public key for signing artworks
     */
    uploadArtistPublicKey = catchAsync(async (req: Request, res: Response, next: NextFunction): Promise<void> => {
        const userId = (req as any).user?.id;
        if (!userId) {
            throw new ValidationError('User not authenticated', 'uploadArtistPublicKey');
        }

        const { publicKeyPem, keyId } = req.body;

        if (!publicKeyPem || !keyId) {
            res.status(400).json({
                success: false,
                message: 'publicKeyPem and keyId are required',
                data: null
            });
            return;
        }

        try {
            crypto.createPublicKey(publicKeyPem);
        } catch (error: any) {
            res.status(400).json({
                success: false,
                message: 'Invalid public key format',
                data: null
            });
            return;
        }

        const keyRecord = await keyStoreService.upsertKey(
            keyId,
            publicKeyPem,
            'artist',
            userId
        );

        logger.info('Artist public key uploaded', {
            userId,
            keyId,
            keyRecordId: keyRecord.id
        });

        res.status(200).json({
            success: true,
            message: 'Public key uploaded successfully',
            data: {
                keyId: keyRecord.kid,
                ownerType: keyRecord.ownerType,
                createdAt: keyRecord.createdAt
            }
        });
    });
}

export const artController = new ArtController();

