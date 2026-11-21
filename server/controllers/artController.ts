import { Request, Response, NextFunction } from 'express';
import { catchAsync } from '../middleware/errorHandler';
import { artService } from '../services/artService';
import { ValidationError } from '../utils/errors';
import logger from '../utils/logger';
import { imageService } from '../services/imageService';
import { proofService } from '../services/proofService';
import { imageMetadataEmbedder } from '../services/imageMetadataEmbedder';
import { keyStoreService } from '../services/keyStoreService';
import { SignedProofMetadata } from '../services/cryptographicSigner';
import axios from 'axios';
import crypto from 'crypto';

async function fetchImageBuffer(url: string): Promise<Buffer> {
    const response = await axios.get(url, {
        responseType: 'arraybuffer',
        timeout: 30000,
    });
    return Buffer.from(response.data);
}

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
        const view = (req.query.view as string) || 'list';

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

        // List view: drop heavy proof payloads (signatures / full embeddedProof) for gallery perf
        if (view === 'list') {
            artworks = artworks.map((artwork) => {
                const proofMetadata = artwork.proofMetadata
                    ? {
                          image_sha256: artwork.proofMetadata.image_sha256,
                          ai_score: artwork.proofMetadata.ai_score,
                          is_ai_generated: artwork.proofMetadata.is_ai_generated,
                          tamper_detected: artwork.proofMetadata.tamper_detected,
                          signer_kid: artwork.proofMetadata.signer_kid,
                          signedAt: artwork.proofMetadata.signedAt || artwork.proofMetadata.timestamp,
                          timestamp: artwork.proofMetadata.timestamp || artwork.proofMetadata.signedAt,
                          signedBy: artwork.proofMetadata.signedBy,
                      }
                    : null;

                return {
                    ...artwork,
                    embeddedProof: artwork.embeddedProof ? { present: true } : null,
                    proofMetadata,
                    originalUploader: artwork.originalUploader
                        ? {
                              id: artwork.originalUploader.id,
                              username: artwork.originalUploader.username,
                              email: artwork.originalUploader.email,
                          }
                        : artwork.originalUploader,
                    currentOwner: artwork.currentOwner
                        ? {
                              id: artwork.currentOwner.id,
                              username: artwork.currentOwner.username,
                              email: artwork.currentOwner.email,
                          }
                        : artwork.currentOwner,
                    image: artwork.image
                        ? {
                              id: artwork.image.id,
                              hash: artwork.image.hash,
                              url: artwork.image.url,
                              filename: artwork.image.filename,
                              status: artwork.image.status,
                              detectionReport: artwork.image.detectionReport
                                  ? {
                                        aiProbability: artwork.image.detectionReport.aiProbability,
                                        detectedLabel: artwork.image.detectionReport.detectedLabel,
                                    }
                                  : null,
                              editDetections: (artwork.image.editDetections || []).map((e: any) => ({
                                  editType: e.editType,
                                  confidence: e.confidence,
                                  maskUrl: e.maskUrl,
                              })),
                          }
                        : artwork.image,
                };
            });
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
     * GET|POST /api/art/:id/verify-proof
     * Unified verify: signature, hash, kid, forensics.
     * Query: ?hash=... optional content hash
     * Query: ?refetch=true to re-fetch Cloudinary bytes for hash check
     * Body/multipart: optional file for content hash
     *
     * Without hash/file/refetch: verifies signature + kid only — does NOT claim "not edited"
     * by comparing the DB hash to itself.
     */
    verifyProof = catchAsync(async (req: Request, res: Response, next: NextFunction): Promise<void> => {
        const artworkId = req.params.id;
        const queryHash = (req.query.hash as string | undefined) || undefined;
        const refetch = req.query.refetch === 'true' || req.query.refetch === '1';
        const file = (req as any).file as Express.Multer.File | undefined;

        const artwork = await artService.getArtworkById(artworkId);

        if (!artwork) {
            res.status(404).json({
                success: false,
                message: 'Artwork not found',
                data: null
            });
            return;
        }

        let currentHash: string | null = queryHash || null;
        let hashSource: 'query' | 'file' | 'cloudinary' | 'none' = queryHash ? 'query' : 'none';

        if (file?.buffer) {
            currentHash = imageMetadataEmbedder.calculateContentHash(file.buffer);
            hashSource = 'file';
        } else if (!currentHash && refetch) {
            const image = await imageService.getImageById(artwork.imageId);
            if (image?.url) {
                try {
                    const buffer = await fetchImageBuffer(image.url);
                    currentHash = imageMetadataEmbedder.calculateContentHash(buffer);
                    hashSource = 'cloudinary';
                } catch (error: any) {
                    logger.error('Failed to re-fetch image for verify', {
                        error: error.message,
                        artworkId
                    });
                    res.status(502).json({
                        success: false,
                        message: 'Failed to re-fetch image bytes for hash check',
                        data: null
                    });
                    return;
                }
            }
        }

        const verification = await artService.verifyArtworkUnified(artworkId, currentHash);

        res.status(200).json({
            success: true,
            message: 'Proof verification completed',
            data: {
                artworkId,
                hashSource,
                verification: {
                    valid: verification.valid,
                    signatureValid: verification.signatureValid,
                    hashMatches: verification.hashMatches,
                    hashChecked: verification.hashChecked,
                    kid: verification.kid,
                    kidStatus: verification.kidStatus,
                    alg: verification.alg,
                    currentHash: verification.currentHash,
                    expectedHash: verification.expectedHash,
                    forensics: verification.forensics,
                    scheme: verification.scheme,
                    reason: verification.reason,
                }
            }
        });
    });

    /**
     * GET /api/art/image/:imageId/download?signer=system|artist
     * Download artwork with embedded signed metadata.
     *
     * Hash-then-embed fix: sign SHA-256 of Cloudinary content bytes, then append
     * trailer (no re-encode). Verify strips trailer and hashes content.
     *
     * Artist private-key sign is OUT OF SCOPE — signer=artist still uses system key.
     */
    downloadArtwork = catchAsync(async (req: Request, res: Response, next: NextFunction): Promise<void> => {
        const imageId = req.params.imageId;
        const signer = (req.query.signer as string) || 'system';
        const userId = (req as any).user?.id;

        if (!userId) {
            throw new ValidationError('User not authenticated', 'downloadArtwork');
        }

        // Artist-sign path not shipped: always system-sign. Public-key upload is preparatory only.
        if (signer === 'artist') {
            logger.info('Artist signer requested but out of scope; using system key', {
                imageId,
                userId
            });
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
            imageBuffer = await fetchImageBuffer(image.url);
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

        // Content hash of unmodified Cloudinary bytes (pre-trailer)
        const contentHash = imageMetadataEmbedder.calculateContentHash(imageBuffer);

        let proofMetadata = artwork.proofMetadata as SignedProofMetadata | null;
        const canReuse =
            proofMetadata &&
            proofMetadata.image_sha256 === contentHash &&
            proofMetadata.signature;

        if (!canReuse) {
            const aiScore = artwork.image.detectionReport?.aiProbability || 0;
            const isAiGenerated = artwork.image.detectionReport?.detectedLabel === 'AI_GENERATED';
            const tamperDetected = (artwork.image.editDetections?.length || 0) > 0;

            proofMetadata = await proofService.createSignedProofMetadata(
                aiScore,
                isAiGenerated,
                tamperDetected,
                contentHash
            );

            await artService.updateArtworkProofMetadata(artwork.id, proofMetadata);
        }

        const mimeType = imageMetadataEmbedder.detectMimeType(imageBuffer);
        // Append trailer after signing content hash — download bytes = content + trailer
        const imageWithMetadata = await imageMetadataEmbedder.embedMetadata(
            imageBuffer,
            proofMetadata!,
            mimeType
        );

        const filename = (image.filename || 'artwork').replace(/[^a-zA-Z0-9.-]/g, '_');
        const extension = mimeType.includes('jpeg') || mimeType.includes('jpg') ? 'jpg' : 'png';
        const downloadFilename = `${filename}-proof.${extension}`;

        res.setHeader('Content-Type', mimeType);
        res.setHeader('Content-Disposition', `attachment; filename="${downloadFilename}"`);
        res.setHeader('Content-Length', imageWithMetadata.length.toString());
        res.setHeader('X-Proof-Content-Hash', contentHash);
        res.setHeader('X-Proof-Kid', proofMetadata!.signer_kid);

        logger.info('Artwork downloaded with embedded metadata', {
            artworkId: artwork.id,
            imageId,
            userId,
            signer: 'system',
            contentHash: contentHash.substring(0, 16) + '...',
            filename: downloadFilename
        });

        res.send(imageWithMetadata);
    });

    /**
     * POST /api/art/verify-embedded
     * Verify embedded metadata in uploaded image file (same unified semantics).
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

        const currentHash = imageMetadataEmbedder.calculateContentHash(imageBuffer);

        const verification = await proofService.verifyArtworkUnified({
            proofMetadata: extractedMetadata,
            currentHash,
        });

        res.status(200).json({
            success: true,
            message: 'Verification completed',
            data: {
                valid: verification.valid,
                signatureValid: verification.signatureValid,
                hashMatches: verification.hashMatches,
                hashChecked: verification.hashChecked,
                kid: verification.kid,
                kidStatus: verification.kidStatus,
                alg: verification.alg,
                currentHash: verification.currentHash,
                expectedHash: verification.expectedHash,
                forensics: verification.forensics,
                scheme: verification.scheme,
                reason: verification.reason,
                metadata: extractedMetadata,
            }
        });
    });

    /**
     * POST /api/art/artist/public-key
     * Upload artist public key (preparatory only).
     * Full artist private-key signing of downloads is OUT OF SCOPE — follow-up work.
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

        logger.info('Artist public key uploaded (signing path not yet active)', {
            userId,
            keyId,
            keyRecordId: keyRecord.id
        });

        res.status(200).json({
            success: true,
            message: 'Public key uploaded successfully. Artist-signed downloads are not enabled yet; proofs remain system-signed.',
            data: {
                keyId: keyRecord.kid,
                ownerType: keyRecord.ownerType,
                createdAt: keyRecord.createdAt,
                artistSignEnabled: false
            }
        });
    });
}

export const artController = new ArtController();
