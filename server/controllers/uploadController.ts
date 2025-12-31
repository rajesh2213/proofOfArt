import { NextFunction, Request, Response } from "express";
import crypto from 'crypto';
import dotenv from 'dotenv';
import { InferenceResponse } from '../src/types/inference';
import { CloudinaryResource } from '../src/types/cloudinary'
import { ImageMetaData, ImageClaim } from '../src/types/image'
import { ValidationError } from '../utils/errors';
import logger from '../utils/logger';
import { catchAsync } from '../middleware/errorHandler';
import { fileValidationService } from '../services/fileValidationService';
import { cloudinaryService } from '../services/cloudinaryService';
import { imageService } from '../services/imageService';
import { userService } from '../services/userService';
import { claimService } from '../services/claimService';
import { inferenceQueueService } from '../services/inferenceQueueService';
import { artService } from '../services/artService';
import { proofService } from '../services/proofService';

dotenv.config();

type UploadAction = "insert" | "update";

export const handleUpload = catchAsync(async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    if (!req.file) {
        throw new ValidationError('No file uploaded', 'file');
    }

    const file = req.file;
    const action: UploadAction = (req.body.action as UploadAction) || 'insert';
    const imageMetaData = req.body.imageMetaData
        ? JSON.parse(req.body.imageMetaData)
        : null;
    
    const title = imageMetaData?.imageTitle || req.body.title;
    const creationDate = imageMetaData?.creationDate || req.body.creationDate;
    const allowAITraining = imageMetaData?.allowAITraining || req.body.allowAITraining;
    const type = imageMetaData?.type || req.body.type;
    const isMadeByUser = imageMetaData?.isMadeByUser ?? (req.body.isMadeByUser !== undefined ? req.body.isMadeByUser : null);
    let userId = (req as any).user?.id || null;

    logger.info('Upload request received', {
        hasUser: !!((req as any).user),
        userId: userId || 'null',
        isMadeByUser: isMadeByUser,
        isAuthenticated: userId !== null
    });

    fileValidationService.validateFile(file);

    try {
        const fileBuffer = file.buffer;
        const imgHash = crypto.createHash('sha256').update(fileBuffer).digest('hex');

        logger.info('File upload processed', {
            filename: file.originalname,
            mimetype: file.mimetype,
            size: file.size,
            hash: imgHash
        });

        let image = await imageService.getImageByHash(imgHash, true);
        let cloudinaryResult: CloudinaryResource | null = null;
        let isNewImage = false;

        if (image === null) {
            isNewImage = true;
            const { resource } = await cloudinaryService.getOrUploadFile(
                fileBuffer,
                file.mimetype,
                imgHash
            );
            
            cloudinaryResult = resource;

            const cloudinaryMetadata = cloudinaryService.extractMetadata(resource);
            
            const metaData: ImageMetaData = {
                ...cloudinaryMetadata,
                title: title,
                art_creation_date: creationDate,
                allow_ai_training: allowAITraining,
                art_type: type,
                is_made_by_user: isMadeByUser
            };

            image = await imageService.createImage(imgHash, cloudinaryResult.secure_url, file.originalname, metaData);
        } else {
            logger.info('Using existing image with claims', {
                imageId: image.id,
                hasImageClaims: !!image.imageClaims,
                imageClaimsCount: image.imageClaims?.length || 0,
                imageClaimsUserIds: image.imageClaims?.map(c => c.userId) || []
            });
            const metadata = image.metadata as any;  
            cloudinaryResult = {
                secure_url: image.url,
                width: metadata?.width,
                height: metadata?.height,
                format: metadata?.format,
            } as CloudinaryResource;
        }

        if (!image) {
            res.status(500).json({
                success: false,
                message: 'Image creation failed',
                errorCode: 'IMAGE_CREATION_FAILED',
                data: {
                    file: {
                        originalName: file.originalname,
                        mimetype: file.mimetype,
                        size: file.size,
                        hash: imgHash,
                    },
                    imageId: null,
                }
            });
            throw new ValidationError('Image creation failed', 'image');
        }

        const sessionId = req.sessionID || null;
        const wasAuthenticated = userId !== null; 
        const isGuestUser = userId === null;

        if (isGuestUser) {
            userId = (await userService.createGuestUser())?.id || null;
            logger.info('Guest user created', { userId });
        }

        if (!userId) {
            throw new ValidationError('Internal server error', 'userId');
        }

        if (isGuestUser && (isMadeByUser || action === 'update')) {
            res.status(400).json({
                success: false,
                message: 'Guest users cannot claim images',
                errorCode: 'GUEST_USERS_CANNOT_CLAIM_ART',
                data: null
            });
            throw new ValidationError('Guest users cannot claim images', 'isMadeByUser');
        }

        let imageClaim: ImageClaim | null = null;
        logger.info('isMadeByUser check', { isMadeByUser, type: typeof isMadeByUser });

        if (!isGuestUser && userId) {
            imageClaim = await claimService.findClaimByUserAndImage(userId, image.id);

            logger.info('claim check', { 
                hasImageClaim: !!imageClaim, 
                action, 
                imageClaimId: imageClaim?.id || 'none',
                imageClaimUserId: imageClaim?.userId || 'none'
            });
            
            if (imageClaim && action === 'insert') {
                res.status(200).json({
                    success: false,
                    message: 'You have already claimed this image',
                    errorCode: "IMAGE_ALREADY_CLAIMED",
                    data: {
                        file: {
                            originalName: file.originalname,
                            mimetype: file.mimetype,
                            size: file.size,
                            hash: imgHash,
                        },
                        imageId: image.id,
                        alreadyClaimed: true
                    }
                });
                return;
            } else if (imageClaim && action === 'update') {
                const claimEvidenceMetadata = req.body.claimEvidenceMetadata
                    ? JSON.parse(req.body.claimEvidenceMetadata)
                    : null;
                logger.info('claim evidence metadata', { claimEvidenceMetadata });

                try {
                    imageClaim = await claimService.updateImageClaim(userId, image.id, claimEvidenceMetadata);
                    logger.info('Image claim updated', { userId, imageId: image.id, sessionId, isGuest: isGuestUser });
                } catch (error: any) {
                    logger.error('Error updating image claim', { 
                        error: error.message, 
                        userId, 
                        imageId: image.id 
                    });
                    throw error;
                }
            } else if (!imageClaim && isMadeByUser) {
                const claimEvidenceMetadata = req.body.claimEvidenceMetadata
                    ? JSON.parse(req.body.claimEvidenceMetadata)
                    : null;
                
                try {
                    imageClaim = await claimService.createImageClaim(userId, image.id, claimEvidenceMetadata, sessionId || undefined);
                    logger.info('Image claim created', { userId, imageId: image.id, sessionId, isGuest: isGuestUser });
                } catch (error: any) {
                    if (error.message?.includes('already exists') || error.message?.includes('Claim already exists')) {
                        logger.warn('Duplicate claim attempt detected', { userId, imageId: image.id });
                        res.status(200).json({
                            success: false,
                            message: 'You have already claimed this image',
                            errorCode: "IMAGE_ALREADY_CLAIMED",
                            data: {
                                file: {
                                    originalName: file.originalname,
                                    mimetype: file.mimetype,
                                    size: file.size,
                                    hash: imgHash,
                                },
                                imageId: image.id,
                                alreadyClaimed: true
                            }
                        });
                        return;
                    }
                    logger.error('Error creating image claim', { 
                        error: error.message, 
                        userId, 
                        imageId: image.id 
                    });
                    throw error;
                }
            }
        }

        let inferenceResult: InferenceResponse | null = null;
        let inferenceQueued = false;
        let artworkCreated = false;

        if ((isNewImage || !image.detectionReport) && image) {
            const inferBaseUrl = process.env.INFER_BASE_URL;
            if (!inferBaseUrl) {
                logger.warn('INFER_BASE_URL not configured, skipping inference', { imageId: image.id });
            } else {
                if (!image.url || (!image.url.startsWith('http://') && !image.url.startsWith('https://'))) {
                    logger.error('Invalid image URL format for inference', { 
                        imageUrl: image.url, 
                        imageId: image.id 
                    });
                } else {
                    try {
                        await inferenceQueueService.queueInference(image.id, image.url);
                        inferenceQueued = true;
                        logger.info('Inference job queued successfully', {
                            imageId: image.id,
                            imageUrl: image.url.substring(0, 50) + '...'
                        });
                    } catch (queueError: any) {
                        logger.error('Error queueing inference job', {
                            error: queueError.message,
                            imageId: image.id,
                            imageUrl: image.url.substring(0, 50) + '...'
                        });
                    }
                }
            }
        } else {
            if (image.detectionReport) {
                inferenceResult = {
                    predictions: {
                        is_ai_generated: image.detectionReport.detectedLabel === 'AI_GENERATED',
                        confidence: image.detectionReport.aiProbability
                    },
                    tampering: {
                        is_edited: false,
                        mask_pixesls: 0,
                        mask_base64: image.detectionReport.heatmapUrl || ''
                    }
                };
            }
        }

        if (wasAuthenticated && userId && image) {
            try {
                const existingArtwork = await artService.getArtworkByImageId(image.id);
                
                if (!existingArtwork) {
                    let aiScore = 0.5;
                    let isAiGenerated = false;
                    let tamperDetected = false;

                    if (inferenceResult) {
                        aiScore = inferenceResult.predictions.confidence;
                        isAiGenerated = inferenceResult.predictions.is_ai_generated;
                        tamperDetected = inferenceResult.tampering.is_edited;
                    } else if (image.detectionReport) {
                        aiScore = image.detectionReport.aiProbability;
                        isAiGenerated = image.detectionReport.detectedLabel === 'AI_GENERATED';
                        const imageWithEdits = await imageService.getImageById(image.id, true);
                        tamperDetected = ((imageWithEdits as any)?.editDetections?.length || 0) > 0;
                    }

                    const proof = proofService.createProofFromInference(
                        aiScore,
                        isAiGenerated,
                        tamperDetected,
                        imgHash,
                        isMadeByUser ? 'artist' : 'system'
                    );

                    await artService.createArtwork(image.id, userId, proof);
                    artworkCreated = true;

                    logger.info('Artwork created for user upload', {
                        imageId: image.id,
                        userId,
                        isMadeByUser
                    });
                } else {
                    logger.info('Artwork already exists for image', {
                        imageId: image.id,
                        artworkId: existingArtwork.id
                    });
                }
            } catch (artError: any) {
                logger.error('Error creating artwork during upload', {
                    error: artError.message,
                    imageId: image.id,
                    userId
                });
            }
        }

        logger.info('File upload and processing completed successfully', {
            fileHash: imgHash,
            originalName: file.originalname,
            size: file.size,
            isNewImage,
            hasInference: !!inferenceResult
        });

        res.status(200).json({
            success: true,
            message: isNewImage ? 'File uploaded and processed successfully' : 'File processed successfully',
            data: {
                file: {
                    originalName: file.originalname,
                    mimetype: file.mimetype,
                    size: file.size,
                    hash: imgHash,
                },
                imageId: image.id,
                imageUrl: image.url,
                inference: inferenceResult,
                claimCreated: !!imageClaim,
                artworkCreated: artworkCreated,
                inferenceQueued: inferenceQueued,
                status: (image as any).status || 'QUEUED'
            }
        });

    } catch (error) {
        throw error;
    }
});