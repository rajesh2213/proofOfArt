import crypto from 'crypto';
import { createHash } from 'crypto';
import logger from '../utils/logger';
import { DatabaseError, ValidationError } from '../utils/errors';
import { cryptographicSigner, SignedProofMetadata } from './cryptographicSigner';

export interface EmbeddedProof {
    verified_not_ai: boolean;
    hash: string;
    timestamp: string;
    signer: 'system' | 'artist';
    ai_score?: number;
    is_ai_generated?: boolean;
    tamper_detected?: boolean;
    signature?: string;
}

export interface ProofVerificationResult {
    isValid: boolean;
    wasEdited: boolean;
    originalMetadata: EmbeddedProof | null;
    currentHash: string;
    error?: string;
}

export class ProofService {
    private readonly PROOF_SIGNATURE_KEY: string;

    constructor() {
        this.PROOF_SIGNATURE_KEY = process.env.PROOF_SIGNATURE_KEY || 
            'default-dev-key-change-in-production-' + Date.now();
        
        if (!process.env.PROOF_SIGNATURE_KEY) {
            logger.warn('PROOF_SIGNATURE_KEY not set, using default key. This should be changed in production!');
        }
    }

    /**
     * Generate a proof signature using HMAC
     */
    private generateSignature(proof: Omit<EmbeddedProof, 'signature'>): string {
        const data = JSON.stringify({
            verified_not_ai: proof.verified_not_ai,
            hash: proof.hash,
            timestamp: proof.timestamp,
            signer: proof.signer,
            ai_score: proof.ai_score,
            is_ai_generated: proof.is_ai_generated,
            tamper_detected: proof.tamper_detected
        });
        
        return crypto
            .createHmac('sha256', this.PROOF_SIGNATURE_KEY)
            .update(data)
            .digest('hex');
    }

    /**
     * Verify a proof signature
     */
    private verifySignature(proof: EmbeddedProof): boolean {
        if (!proof.signature) {
            return false;
        }

        const { signature, ...proofWithoutSignature } = proof;
        const expectedSignature = this.generateSignature(proofWithoutSignature);
        
        return crypto.timingSafeEqual(
            Buffer.from(signature),
            Buffer.from(expectedSignature)
        );
    }

    /**
     * Calculate SHA256 hash of image buffer
     */
    calculateImageHash(buffer: Buffer): string {
        return createHash('sha256').update(buffer).digest('hex');
    }

    /**
     * Create proof object (stored in database, not embedded in image file)
     */
    createProof(
        proof: Omit<EmbeddedProof, 'signature' | 'hash' | 'timestamp'>,
        imageHash: string
    ): EmbeddedProof {
        try {
            const timestamp = new Date().toISOString();
            const fullProof: EmbeddedProof = {
                ...proof,
                hash: imageHash,
                timestamp,
                signature: undefined
            };

            fullProof.signature = this.generateSignature(fullProof);

            return fullProof;
        } catch (error: any) {
            logger.error('Error creating proof', {
                error: error.message,
                imageHash: imageHash.substring(0, 16) + '...'
            });
            throw new DatabaseError('Failed to create proof', 'createProof');
        }
    }

    /**
     * Verify proof from image buffer (compares hash)
     */
    verifyProofHash(imageBuffer: Buffer, expectedHash: string): { wasEdited: boolean; currentHash: string } {
        try {
            const currentHash = this.calculateImageHash(imageBuffer);
            const wasEdited = currentHash !== expectedHash;
            
            return {
                wasEdited,
                currentHash
            };
        } catch (error: any) {
            logger.error('Error verifying proof hash', {
                error: error.message
            });
            return {
                wasEdited: false,
                currentHash: ''
            };
        }
    }

    /**
     * Create proof object from inference results
     */
    createProofFromInference(
        aiScore: number,
        isAiGenerated: boolean,
        tamperDetected: boolean,
        imageHash: string,
        signer: 'system' | 'artist' = 'system'
    ): EmbeddedProof {
        const timestamp = new Date().toISOString();
        const proof: Omit<EmbeddedProof, 'signature'> = {
            verified_not_ai: !isAiGenerated,
            hash: imageHash,
            timestamp,
            signer,
            ai_score: aiScore,
            is_ai_generated: isAiGenerated,
            tamper_detected: tamperDetected
        };

        return {
            ...proof,
            signature: this.generateSignature(proof)
        };
    }

    /**
     * Verify proof from database against current image
     */
    verifyProofFromDatabase(
        storedProof: EmbeddedProof | null,
        currentImageHash: string
    ): ProofVerificationResult {
        if (!storedProof) {
            return {
                isValid: false,
                wasEdited: false,
                originalMetadata: null,
                currentHash: currentImageHash,
                error: 'No proof found in database'
            };
        }

        const signatureValid = this.verifySignature(storedProof);
        const wasEdited = storedProof.hash !== currentImageHash;

        return {
            isValid: signatureValid && !wasEdited,
            wasEdited,
            originalMetadata: storedProof,
            currentHash: currentImageHash
        };
    }

    /**
     * Create cryptographically signed proof metadata
     */
    async createSignedProofMetadata(
        aiScore: number,
        isAiGenerated: boolean,
        tamperDetected: boolean,
        imageHash: string
    ): Promise<SignedProofMetadata> {
        return await cryptographicSigner.signWithSystemKey({
            image_sha256: imageHash,
            ai_score: aiScore,
            is_ai_generated: isAiGenerated,
            tamper_detected: tamperDetected,
        });
    }
}

export const proofService = new ProofService();

