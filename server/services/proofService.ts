import crypto from 'crypto';
import { createHash } from 'crypto';
import logger from '../utils/logger';
import { DatabaseError } from '../utils/errors';
import { cryptographicSigner, SignedProofMetadata } from './cryptographicSigner';
import { keyStoreService } from './keyStoreService';
import { imageMetadataEmbedder } from './imageMetadataEmbedder';

/** @deprecated Legacy HMAC proof stored on Artwork.embeddedProof. Prefer proofMetadata (EC). */
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

export interface UnifiedArtworkVerification {
    valid: boolean;
    signatureValid: boolean | null;
    hashMatches: boolean | null;
    hashChecked: boolean;
    kid: string | null;
    kidStatus: 'active' | 'revoked' | 'missing' | 'legacy-hmac' | 'none';
    alg: string | null;
    currentHash: string | null;
    expectedHash: string | null;
    forensics: {
        ai_score: number | null;
        is_ai_generated: boolean | null;
        tamper_detected: boolean | null;
        timestamp: string | null;
        signer: string | null;
    };
    scheme: 'ec-p256' | 'hmac-legacy' | 'none';
    reason?: string;
    proofMetadata?: SignedProofMetadata | null;
    legacyProof?: EmbeddedProof | null;
}

function isProduction(): boolean {
    return process.env.NODE_ENV === 'production';
}

export class ProofService {
    private readonly PROOF_SIGNATURE_KEY: string;

    constructor() {
        const envKey = process.env.PROOF_SIGNATURE_KEY;

        if (!envKey) {
            if (isProduction()) {
                throw new Error(
                    'PROOF_SIGNATURE_KEY is required in production. Refusing ephemeral/default keys.'
                );
            }
            this.PROOF_SIGNATURE_KEY = 'default-dev-key-change-in-production';
            logger.warn(
                'PROOF_SIGNATURE_KEY not set; using static default-dev-key for development only (HMAC legacy bridge).'
            );
        } else {
            this.PROOF_SIGNATURE_KEY = envKey;
        }
    }

    /**
     * @deprecated HMAC bridge for legacy embeddedProof only. New proofs use EC via createSignedProofMetadata.
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

    /** @deprecated */
    private verifySignature(proof: EmbeddedProof): boolean {
        if (!proof.signature) {
            return false;
        }

        const { signature, ...proofWithoutSignature } = proof;
        const expectedSignature = this.generateSignature(proofWithoutSignature);

        try {
            const a = Buffer.from(signature);
            const b = Buffer.from(expectedSignature);
            if (a.length !== b.length) {
                return false;
            }
            return crypto.timingSafeEqual(a, b);
        } catch {
            return false;
        }
    }

    calculateImageHash(buffer: Buffer): string {
        return createHash('sha256').update(buffer).digest('hex');
    }

    /**
     * @deprecated Prefer createSignedProofMetadata (EC P-256). Kept as read-only bridge.
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

    verifyProofHash(imageBuffer: Buffer, expectedHash: string): { wasEdited: boolean; currentHash: string } {
        try {
            const currentHash = imageMetadataEmbedder.calculateContentHash(imageBuffer);
            return {
                wasEdited: currentHash !== expectedHash,
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
     * @deprecated Legacy HMAC bridge stored alongside EC proofMetadata for old clients.
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

    /** @deprecated HMAC-only verify. Prefer verifyArtworkUnified. */
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
     * Primary proof path: EC P-256 signed forensic snapshot via KeyStore kid.
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

    /**
     * Unified verify: EC proofMetadata first, HMAC embeddedProof as legacy bridge.
     * Hash checks require an external currentHash (file or Cloudinary) — never DB-hash vs itself.
     */
    async verifyArtworkUnified(options: {
        proofMetadata?: SignedProofMetadata | null;
        legacyProof?: EmbeddedProof | null;
        /** Content hash of candidate bytes (file / Cloudinary). Omit to skip tamper check. */
        currentHash?: string | null;
        storedImageHash?: string | null;
    }): Promise<UnifiedArtworkVerification> {
        const { proofMetadata, legacyProof, currentHash, storedImageHash } = options;

        if (proofMetadata?.signature && proofMetadata?.signer_kid) {
            return this.verifyEcProof(proofMetadata, currentHash ?? null, storedImageHash ?? null);
        }

        if (legacyProof?.signature) {
            return this.verifyLegacyHmac(legacyProof, currentHash ?? null, storedImageHash ?? null);
        }

        return {
            valid: false,
            signatureValid: null,
            hashMatches: null,
            hashChecked: false,
            kid: null,
            kidStatus: 'none',
            alg: null,
            currentHash: currentHash ?? null,
            expectedHash: storedImageHash ?? null,
            forensics: {
                ai_score: null,
                is_ai_generated: null,
                tamper_detected: null,
                timestamp: null,
                signer: null,
            },
            scheme: 'none',
            reason: 'No proof metadata found',
            proofMetadata: null,
            legacyProof: legacyProof ?? null,
        };
    }

    private async verifyEcProof(
        proofMetadata: SignedProofMetadata,
        currentHash: string | null,
        storedImageHash: string | null
    ): Promise<UnifiedArtworkVerification> {
        const expectedHash = proofMetadata.image_sha256;
        const keyRecord = await keyStoreService.getKeyByKid(proofMetadata.signer_kid);

        let kidStatus: UnifiedArtworkVerification['kidStatus'] = 'missing';
        let signatureValid: boolean | null = null;

        if (!keyRecord) {
            kidStatus = 'missing';
            signatureValid = false;
        } else if (keyRecord.revoked) {
            kidStatus = 'revoked';
            signatureValid = false;
        } else {
            kidStatus = 'active';
            signatureValid = await cryptographicSigner.verifySignature(
                proofMetadata,
                keyRecord.publicKeyPem
            );
        }

        let hashMatches: boolean | null = null;
        let hashChecked = false;
        if (currentHash) {
            hashChecked = true;
            hashMatches = currentHash === expectedHash;
        }

        const continuityOk =
            !storedImageHash || !expectedHash || storedImageHash === expectedHash;

        const valid =
            signatureValid === true &&
            kidStatus === 'active' &&
            continuityOk &&
            (hashChecked ? hashMatches === true : true);

        let reason: string | undefined;
        if (signatureValid === false) {
            reason = kidStatus === 'revoked'
                ? 'Signer key revoked'
                : kidStatus === 'missing'
                    ? 'Signer key not found'
                    : 'Invalid signature';
        } else if (!continuityOk) {
            reason = 'Proof hash does not match stored image hash';
        } else if (hashChecked && hashMatches === false) {
            reason = 'Image hash mismatch (content may have been modified)';
        } else if (!hashChecked) {
            reason = 'Signature checked; provide file or re-fetch bytes to verify tamper/hash';
        }

        return {
            valid: hashChecked ? valid : (signatureValid === true && kidStatus === 'active' && continuityOk),
            signatureValid,
            hashMatches,
            hashChecked,
            kid: proofMetadata.signer_kid,
            kidStatus,
            alg: proofMetadata.alg || 'ES256',
            currentHash,
            expectedHash,
            forensics: {
                ai_score: proofMetadata.ai_score ?? null,
                is_ai_generated: proofMetadata.is_ai_generated ?? null,
                tamper_detected: proofMetadata.tamper_detected ?? null,
                timestamp: proofMetadata.timestamp ?? null,
                signer: proofMetadata.signedBy ?? null,
            },
            scheme: 'ec-p256',
            reason,
            proofMetadata,
            legacyProof: null,
        };
    }

    private verifyLegacyHmac(
        legacyProof: EmbeddedProof,
        currentHash: string | null,
        storedImageHash: string | null
    ): UnifiedArtworkVerification {
        const signatureValid = this.verifySignature(legacyProof);
        const expectedHash = legacyProof.hash;

        let hashMatches: boolean | null = null;
        let hashChecked = false;
        if (currentHash) {
            hashChecked = true;
            hashMatches = currentHash === expectedHash;
        }

        const continuityOk =
            !storedImageHash || !expectedHash || storedImageHash === expectedHash;

        return {
            valid: signatureValid && continuityOk && (hashChecked ? hashMatches === true : signatureValid),
            signatureValid,
            hashMatches,
            hashChecked,
            kid: null,
            kidStatus: 'legacy-hmac',
            alg: 'HS256',
            currentHash,
            expectedHash,
            forensics: {
                ai_score: legacyProof.ai_score ?? null,
                is_ai_generated: legacyProof.is_ai_generated ?? null,
                tamper_detected: legacyProof.tamper_detected ?? null,
                timestamp: legacyProof.timestamp ?? null,
                signer: legacyProof.signer ?? null,
            },
            scheme: 'hmac-legacy',
            reason: !signatureValid
                ? 'Invalid legacy HMAC signature'
                : !hashChecked
                    ? 'Legacy HMAC checked; provide file or re-fetch bytes to verify tamper/hash'
                    : hashMatches === false
                        ? 'Image hash mismatch (content may have been modified)'
                        : undefined,
            proofMetadata: null,
            legacyProof,
        };
    }

    /**
     * Assert proof hash matches stored image hash. Used by claim/transfer guards.
     */
    getExpectedContentHash(
        proofMetadata?: SignedProofMetadata | null,
        legacyProof?: EmbeddedProof | null,
        storedImageHash?: string | null
    ): string | null {
        if (proofMetadata?.image_sha256) {
            return proofMetadata.image_sha256;
        }
        if (legacyProof?.hash) {
            return legacyProof.hash;
        }
        return storedImageHash ?? null;
    }
}

export const proofService = new ProofService();
