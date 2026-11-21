import crypto from 'crypto';
import logger from '../utils/logger';
import { SignedProofMetadata } from './cryptographicSigner';

const TRAILER_PREFIX = '\n<!-- ProofOfArt:';
const TRAILER_SUFFIX = ' -->\n';
const TRAILER_REGEX = /\n<!-- ProofOfArt:([\s\S]*?) -->\n$/;

/**
 * Embed and extract proof metadata as a file trailer (no pixel re-encode).
 * image_sha256 covers content bytes only — strip the trailer before hashing.
 */
export class ImageMetadataEmbedder {
    /**
     * Append signed proof metadata as a trailer. Does not re-encode the image.
     */
    async embedMetadata(
        imageBuffer: Buffer,
        metadata: SignedProofMetadata,
        _mimeType: string = 'image/png'
    ): Promise<Buffer> {
        try {
            return this.embedAsTrailer(imageBuffer, metadata);
        } catch (error: any) {
            logger.error('Error embedding metadata', {
                error: error.message
            });
            throw new Error(`Failed to embed metadata: ${error.message}`);
        }
    }

    private embedAsTrailer(imageBuffer: Buffer, metadata: SignedProofMetadata): Buffer {
        const { content } = this.stripProofTrailer(imageBuffer);
        const metadataJson = JSON.stringify(metadata);
        const trailer = Buffer.from(`${TRAILER_PREFIX}${metadataJson}${TRAILER_SUFFIX}`, 'utf8');
        return Buffer.concat([content, trailer]);
    }

    /**
     * Strip ProofOfArt trailer if present. Returns content bytes + parsed metadata.
     */
    stripProofTrailer(imageBuffer: Buffer): {
        content: Buffer;
        metadata: SignedProofMetadata | null;
    } {
        const tail = imageBuffer.toString(
            'utf8',
            Math.max(0, imageBuffer.length - 20000)
        );
        const match = tail.match(TRAILER_REGEX);
        if (!match || !match[1]) {
            return { content: imageBuffer, metadata: null };
        }

        const trailerByteLength = Buffer.byteLength(
            `${TRAILER_PREFIX}${match[1]}${TRAILER_SUFFIX}`,
            'utf8'
        );
        const content = imageBuffer.subarray(0, imageBuffer.length - trailerByteLength);

        try {
            const metadata = JSON.parse(match[1]) as SignedProofMetadata;
            return { content, metadata };
        } catch {
            return { content: imageBuffer, metadata: null };
        }
    }

    /**
     * Extract metadata from image buffer (trailer first; Sharp fallback for legacy embeds).
     */
    async extractMetadata(imageBuffer: Buffer, mimeType?: string): Promise<SignedProofMetadata | null> {
        try {
            const stripped = this.stripProofTrailer(imageBuffer);
            if (stripped.metadata) {
                return stripped.metadata;
            }

            try {
                const sharp = require('sharp');
                return await this.extractWithSharp(sharp, imageBuffer, mimeType);
            } catch {
                return null;
            }
        } catch (error: any) {
            logger.error('Error extracting metadata', {
                error: error.message
            });
            return null;
        }
    }

    private async extractWithSharp(
        sharp: any,
        imageBuffer: Buffer,
        _mimeType?: string
    ): Promise<SignedProofMetadata | null> {
        try {
            const metadata = await sharp(imageBuffer).metadata();
            const key = 'ProofOfArt.ProofMetadata';

            if (metadata.png && metadata.png[key]) {
                return JSON.parse(metadata.png[key]) as SignedProofMetadata;
            }

            return null;
        } catch (error: any) {
            logger.error('Error extracting metadata with Sharp', {
                error: error.message
            });
            return null;
        }
    }

    /**
     * SHA-256 of content bytes (strips ProofOfArt trailer when present).
     */
    calculateContentHash(imageBuffer: Buffer): string {
        const { content } = this.stripProofTrailer(imageBuffer);
        return crypto.createHash('sha256').update(content).digest('hex');
    }

    /**
     * SHA-256 of raw buffer as-is (no strip). Prefer calculateContentHash for verify.
     */
    calculateImageHash(imageBuffer: Buffer): string {
        return crypto.createHash('sha256').update(imageBuffer).digest('hex');
    }

    detectMimeType(imageBuffer: Buffer): string {
        const { content } = this.stripProofTrailer(imageBuffer);
        if (content[0] === 0x89 && content[1] === 0x50 && content[2] === 0x4E && content[3] === 0x47) {
            return 'image/png';
        }
        if (content[0] === 0xFF && content[1] === 0xD8) {
            return 'image/jpeg';
        }
        if (content[0] === 0x47 && content[1] === 0x49 && content[2] === 0x46) {
            return 'image/gif';
        }
        if (content[0] === 0x52 && content[1] === 0x49 && content[2] === 0x46 && content[3] === 0x46) {
            return 'image/webp';
        }
        return 'image/png';
    }
}

export const imageMetadataEmbedder = new ImageMetadataEmbedder();
