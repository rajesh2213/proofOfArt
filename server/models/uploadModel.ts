import {prisma} from '../config/prismaClient';
import logger from '../utils/logger';
import { DatabaseError } from '../utils/errors';
import { ImageClaim, DetectionReport } from '../generated/prisma/client';
import { ImageModel } from '../src/types/image';

export const insertImage = async (hash: string, url: string, filename?: string, metadata?: any): Promise<ImageModel> => {
    try {
        const image = await prisma.image.create({
            data: {
                hash,
                url,
                filename: filename || null,
                status: 'PROCESSING',
                metadata: metadata || null,
            }
        })
        return image as unknown as ImageModel;
    } catch (error: any) {
        logger.error('Error creating document:', {
            error: error.message,
            code: error.code,
            meta: error.meta
        });
                
        throw new DatabaseError(
            error.message || 'Error creating document',
            'insertImage'
        );
    }
}


export const getImageByHash = async (hash: string, includeClaims: boolean = true): Promise<ImageModel | null> => {
    try {
        const image = await prisma.image.findUnique({
            where: { hash},
            include: {
                imageClaims: includeClaims,
                detectionReport: true
            }
        })
        return image as unknown as ImageModel || null;
    } catch (error: any) {
        logger.error('Error fetching image by hash:', {
            error: error.message,
            code: error.code,
            meta: error.meta
        });
                
        throw new DatabaseError(
            error.message || 'Error fetching image by hash',
            'getImageByHash'
        );
    }
}

export const findImageClaimBySessionId = async (
    imageId: string,
    sessionId: string
): Promise<ImageClaim | null> => {
    try {
        const claim = await prisma.imageClaim.findFirst({
            where: {
                imageId,
                sessionId
            }
        });
        return claim as unknown as ImageClaim | null;
    } catch (error: any) {
        logger.error('Error finding image claim by sessionId:', {
            error: error.message,
            code: error.code,
            meta: error.meta
        });
        throw new DatabaseError(
            error.message || 'Error finding image claim by sessionId',
            'findImageClaimBySessionId'
        );
    }
}

export const createImageClaim = async (
    userId: string, 
    imageId: string, 
    claimEvidenceMetadata?: any,
    sessionId?: string
): Promise<ImageClaim> => {
    try {
        const claim = await prisma.imageClaim.create({
            data: {
                userId,
                imageId,
                claimEvidenceMetadata: claimEvidenceMetadata || null,
                sessionId: sessionId || null,
            }
        });
        return claim as unknown as ImageClaim;
    } catch (error: any) {
        logger.error('Error creating image claim:', {
            error: error.message,
            code: error.code,
            meta: error.meta
        });
        throw new DatabaseError(
            error.message || 'Error creating image claim',
            'createImageClaim'
        );
    }
}

export const updateImageClaim = async (
    userId: string,
    imageId: string,
    claimEvidenceMetadata?: any
): Promise<ImageClaim> => {
    try {
        const claim = await prisma.imageClaim.update({
            where: {
                userId_imageId: {
                    userId,
                    imageId
                }
            },
            data: {
                claimEvidenceMetadata: claimEvidenceMetadata || null,
            }
        });
        return claim as unknown as ImageClaim;
    } catch (error: any) {
        logger.error('Error updating image claim:', {
            error: error.message,
            code: error.code,
            meta: error.meta
        });
        throw new DatabaseError(
            error.message || 'Error updating image claim',
            'updateImageClaim'
        );
    }
}