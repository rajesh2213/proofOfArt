import { prisma } from '../config/prismaClient';
import { DatabaseError } from '../utils/errors';
import logger from '../utils/logger';

export interface KeyStoreRecord {
    id: string;
    kid: string;
    publicKeyPem: string;
    ownerType: 'system' | 'artist';
    ownerId: string | null;
    revoked: boolean;
    createdAt: Date;
    revokedAt: Date | null;
}

export class KeyStoreService {
    /**
     * Create or update a key in the store
     */
    async upsertKey(
        kid: string,
        publicKeyPem: string,
        ownerType: 'system' | 'artist',
        ownerId?: string
    ): Promise<KeyStoreRecord> {
        try {
            const key = await prisma.keyStore.upsert({
                where: { kid },
                update: {
                    publicKeyPem,
                    ownerType,
                    ownerId: ownerId || null,
                    revoked: false,
                    revokedAt: null,
                },
                create: {
                    kid,
                    publicKeyPem,
                    ownerType,
                    ownerId: ownerId || null,
                    revoked: false,
                },
            });

            return key as unknown as KeyStoreRecord;
        } catch (error: any) {
            logger.error('Error upserting key in KeyStore', {
                error: error.message,
                kid,
                ownerType
            });
            throw new DatabaseError('Failed to upsert key', 'KeyStoreService.upsertKey');
        }
    }

    /**
     * Get key by KID
     */
    async getKeyByKid(kid: string): Promise<KeyStoreRecord | null> {
        try {
            const key = await prisma.keyStore.findUnique({
                where: { kid },
            });

            if (!key) {
                return null;
            }

            return key as unknown as KeyStoreRecord;
        } catch (error: any) {
            logger.error('Error fetching key from KeyStore', {
                error: error.message,
                kid
            });
            throw new DatabaseError('Failed to fetch key', 'KeyStoreService.getKeyByKid');
        }
    }

    /**
     * Get active (non-revoked) key by KID
     */
    async getActiveKeyByKid(kid: string): Promise<KeyStoreRecord | null> {
        try {
            const key = await prisma.keyStore.findFirst({
                where: {
                    kid,
                    revoked: false,
                },
            });

            if (!key) {
                return null;
            }

            return key as unknown as KeyStoreRecord;
        } catch (error: any) {
            logger.error('Error fetching active key from KeyStore', {
                error: error.message,
                kid
            });
            throw new DatabaseError('Failed to fetch active key', 'KeyStoreService.getActiveKeyByKid');
        }
    }

    /**
     * Get all keys for an artist
     */
    async getArtistKeys(ownerId: string): Promise<KeyStoreRecord[]> {
        try {
            const keys = await prisma.keyStore.findMany({
                where: {
                    ownerType: 'artist',
                    ownerId,
                    revoked: false,
                },
                orderBy: {
                    createdAt: 'desc',
                },
            });

            return keys as unknown as KeyStoreRecord[];
        } catch (error: any) {
            logger.error('Error fetching artist keys', {
                error: error.message,
                ownerId
            });
            throw new DatabaseError('Failed to fetch artist keys', 'KeyStoreService.getArtistKeys');
        }
    }

    /**
     * Revoke a key
     */
    async revokeKey(kid: string): Promise<KeyStoreRecord> {
        try {
            const key = await prisma.keyStore.update({
                where: { kid },
                data: {
                    revoked: true,
                    revokedAt: new Date(),
                },
            });

            return key as unknown as KeyStoreRecord;
        } catch (error: any) {
            logger.error('Error revoking key', {
                error: error.message,
                kid
            });
            throw new DatabaseError('Failed to revoke key', 'KeyStoreService.revokeKey');
        }
    }

    async initializeSystemKey(kid: string, publicKeyPem: string): Promise<void> {
        try {
            await this.upsertKey(kid, publicKeyPem, 'system');
            logger.info('System key initialized in KeyStore', { kid });
        } catch (error: any) {
            logger.error('Error initializing system key', {
                error: error.message,
                kid
            });
            throw error;
        }
    }
}

export const keyStoreService = new KeyStoreService();

