import crypto from 'crypto';
import logger from '../utils/logger';
import { SignedProofMetadata } from './cryptographicSigner';

/**
 * Service for embedding and extracting proof metadata from image files
 */
export class ImageMetadataEmbedder {
    private readonly METADATA_KEY = 'ProofOfArt.ProofMetadata';

    async embedMetadata(
        imageBuffer: Buffer,
        metadata: SignedProofMetadata,
        mimeType: string = 'image/png'
    ): Promise<Buffer> {
        try {
            try {
                const sharp = require('sharp');
                return await this.embedWithSharp(sharp, imageBuffer, metadata, mimeType);
            } catch (sharpError) {
                logger.warn('Sharp not available, using manual metadata embedding');
                return await this.embedManually(imageBuffer, metadata, mimeType);
            }
        } catch (error: any) {
            logger.error('Error embedding metadata', {
                error: error.message,
                mimeType
            });
            throw new Error(`Failed to embed metadata: ${error.message}`);
        }
    }

    private async embedWithSharp(
        sharp: any,
        imageBuffer: Buffer,
        metadata: SignedProofMetadata,
        mimeType: string
    ): Promise<Buffer> {
        const metadataJson = JSON.stringify(metadata);
        
        if (mimeType === 'image/png' || mimeType.includes('png')) {
            return await sharp(imageBuffer)
                .png({ 
                    metadata: {
                        [this.METADATA_KEY]: metadataJson
                    }
                })
                .toBuffer();
        } else if (mimeType === 'image/jpeg' || mimeType.includes('jpeg') || mimeType.includes('jpg')) {
            return await sharp(imageBuffer)
                .jpeg({
                    mozjpeg: true,
                    metadata: {
                        exif: {
                            IFD0: {
                                UserComment: metadataJson
                            }
                        }
                    }
                })
                .toBuffer();
        } else {
            logger.warn('Unsupported format for metadata embedding, converting to PNG', { mimeType });
            return await sharp(imageBuffer)
                .png({
                    metadata: {
                        [this.METADATA_KEY]: metadataJson
                    }
                })
                .toBuffer();
        }
    }

    private async embedManually(
        imageBuffer: Buffer,
        metadata: SignedProofMetadata,
        mimeType: string
    ): Promise<Buffer> {
        const metadataJson = JSON.stringify(metadata);
        const metadataComment = Buffer.from(`\n<!-- ProofOfArt:${metadataJson} -->\n`);
        
        return Buffer.concat([imageBuffer, metadataComment]);
    }

    /**
     * Extract metadata from image buffer
     */
    async extractMetadata(imageBuffer: Buffer, mimeType?: string): Promise<SignedProofMetadata | null> {
        try {
            try {
                const sharp = require('sharp');
                return await this.extractWithSharp(sharp, imageBuffer, mimeType);
            } catch (sharpError) {
                return await this.extractManually(imageBuffer);
            }
        } catch (error: any) {
            logger.error('Error extracting metadata', {
                error: error.message
            });
            return null;
        }
    }

    /**
     * Extract metadata using Sharp library
     */
    private async extractWithSharp(
        sharp: any,
        imageBuffer: Buffer,
        mimeType?: string
    ): Promise<SignedProofMetadata | null> {
        try {
            const metadata = await sharp(imageBuffer).metadata();
            
            if (metadata.png && metadata.png[this.METADATA_KEY]) {
                const metadataJson = metadata.png[this.METADATA_KEY];
                return JSON.parse(metadataJson) as SignedProofMetadata;
            }
            
            if (metadata.exif) {
                const exifBuffer = Buffer.from(metadata.exif);
            }
            
            return null;
        } catch (error: any) {
            logger.error('Error extracting metadata with Sharp', {
                error: error.message
            });
            return null;
        }
    }

    private async extractManually(imageBuffer: Buffer): Promise<SignedProofMetadata | null> {
        try {
            const bufferString = imageBuffer.toString('utf8', Math.max(0, imageBuffer.length - 10000));
            const match = bufferString.match(/<!-- ProofOfArt:({.*?}) -->/);
            
            if (match && match[1]) {
                return JSON.parse(match[1]) as SignedProofMetadata;
            }
            
            return null;
        } catch (error: any) {
            logger.error('Error in manual metadata extraction', {
                error: error.message
            });
            return null;
        }
    }

    /**
     * Calculate SHA256 hash of image buffer
     */
    calculateImageHash(imageBuffer: Buffer): string {
        return crypto.createHash('sha256').update(imageBuffer).digest('hex');
    }

    /**
     * Detect image MIME type from buffer
     */
    detectMimeType(imageBuffer: Buffer): string {
        if (imageBuffer[0] === 0x89 && imageBuffer[1] === 0x50 && imageBuffer[2] === 0x4E && imageBuffer[3] === 0x47) {
            return 'image/png';
        }
        if (imageBuffer[0] === 0xFF && imageBuffer[1] === 0xD8) {
            return 'image/jpeg';
        }
        if (imageBuffer[0] === 0x47 && imageBuffer[1] === 0x49 && imageBuffer[2] === 0x46) {
            return 'image/gif';
        }
        if (imageBuffer[0] === 0x52 && imageBuffer[1] === 0x49 && imageBuffer[2] === 0x46 && imageBuffer[3] === 0x46) {
            return 'image/webp';
        }
        return 'image/png'; 
    }
}

export const imageMetadataEmbedder = new ImageMetadataEmbedder();

