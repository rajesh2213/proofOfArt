import crypto from 'crypto';
import logger from '../utils/logger';

export interface ProofMetadataPayload {
    image_sha256: string;
    ai_score: number;
    is_ai_generated: boolean;
    tamper_detected: boolean;
    timestamp: string;
    signer_kid: string;
}

export interface SignedProofMetadata extends ProofMetadataPayload {
    signature: string;
    signedBy: 'system' | 'artist';
    signedAt: string;
}

/**
 * Provides signing and verification of artwork proof metadata
 */
export class CryptographicSigner {
    private readonly curve = 'prime256v1'; // P-256 curve
    private systemPrivateKey: crypto.KeyObject | null = null;
    private systemKeyId: string | null = null;

    constructor() {
        this.initializeSystemKey();
    }

    private initializeSystemKey(): void {
        const privateKeyPem = process.env.SYSTEM_PRIVATE_KEY_PEM;
        const keyId = process.env.SYSTEM_KEY_ID || 'system-default';

        if (privateKeyPem) {
            try {
                this.systemPrivateKey = crypto.createPrivateKey(privateKeyPem);
                this.systemKeyId = keyId;
                logger.info('System private key loaded from environment');
            } catch (error: any) {
                logger.error('Failed to load system private key from environment', {
                    error: error.message
                });
                throw new Error('Invalid system private key configuration');
            }
        } else {
            logger.warn('SYSTEM_PRIVATE_KEY_PEM not set. Generating new key pair for development.');
            const { privateKey, publicKey } = crypto.generateKeyPairSync('ec', {
                namedCurve: this.curve,
            });
            this.systemPrivateKey = privateKey;
            this.systemKeyId = keyId;
            
            const publicKeyPem = publicKey.export({ type: 'spki', format: 'pem' });
            logger.warn('Generated system key pair. Public key:', {
                publicKeyPem,
                keyId: this.systemKeyId
            });
        }
    }

    /**
     * Create canonical JSON payload with stable key ordering
     */
    private createCanonicalPayload(payload: ProofMetadataPayload): string {
        const canonical = {
            image_sha256: payload.image_sha256,
            ai_score: payload.ai_score,
            is_ai_generated: payload.is_ai_generated,
            tamper_detected: payload.tamper_detected,
            timestamp: payload.timestamp,
            signer_kid: payload.signer_kid,
        };
        return JSON.stringify(canonical);
    }

    /**
     * Sign proof metadata payload
     */
    async signMetadata(
        payload: Omit<ProofMetadataPayload, 'signer_kid' | 'timestamp'>,
        privateKey: crypto.KeyObject,
        keyId: string
    ): Promise<SignedProofMetadata> {
        try {
            const timestamp = new Date().toISOString();
            const fullPayload: ProofMetadataPayload = {
                ...payload,
                timestamp,
                signer_kid: keyId,
            };

            const canonicalPayload = this.createCanonicalPayload(fullPayload);
            
            const signature = crypto.sign('sha256', Buffer.from(canonicalPayload), {
                key: privateKey,
                dsaEncoding: 'ieee-p1363',
            });

            const signatureBase64 = signature.toString('base64');

            return {
                ...fullPayload,
                signature: signatureBase64,
                signedBy: keyId.startsWith('system-') ? 'system' : 'artist',
                signedAt: timestamp,
            };
        } catch (error: any) {
            logger.error('Error signing metadata', {
                error: error.message,
                keyId
            });
            throw new Error(`Failed to sign metadata: ${error.message}`);
        }
    }

    /**
     * Sign metadata using system key
     */
    async signWithSystemKey(
        payload: Omit<ProofMetadataPayload, 'signer_kid' | 'timestamp'>
    ): Promise<SignedProofMetadata> {
        if (!this.systemPrivateKey || !this.systemKeyId) {
            throw new Error('System private key not initialized');
        }

        return this.signMetadata(payload, this.systemPrivateKey, this.systemKeyId);
    }

    /**
     * Verify signature against public key
     */
    async verifySignature(
        signedMetadata: SignedProofMetadata,
        publicKeyPem: string
    ): Promise<boolean> {
        try {
            const publicKey = crypto.createPublicKey(publicKeyPem);
            
            const { signature, signedBy, signedAt, ...payload } = signedMetadata;
            const canonicalPayload = this.createCanonicalPayload(payload as ProofMetadataPayload);
            
            const signatureBuffer = Buffer.from(signature, 'base64');
            
            const isValid = crypto.verify(
                'sha256',
                Buffer.from(canonicalPayload),
                {
                    key: publicKey,
                    dsaEncoding: 'ieee-p1363',
                },
                signatureBuffer
            );

            return isValid;
        } catch (error: any) {
            logger.error('Error verifying signature', {
                error: error.message,
                keyId: signedMetadata.signer_kid
            });
            return false;
        }
    }

    getSystemPublicKeyPem(): string {
        if (!this.systemPrivateKey) {
            throw new Error('System private key not initialized');
        }

        const publicKey = crypto.createPublicKey(this.systemPrivateKey);
        return publicKey.export({ type: 'spki', format: 'pem' }) as string;
    }

    getSystemKeyId(): string {
        if (!this.systemKeyId) {
            throw new Error('System key ID not initialized');
        }
        return this.systemKeyId;
    }
}

export const cryptographicSigner = new CryptographicSigner();

