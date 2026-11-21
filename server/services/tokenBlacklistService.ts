import { getRedisClient } from '../config/redis';
import logger from '../utils/logger';
import jwt from 'jsonwebtoken';

const BLACKLIST_PREFIX = 'blacklist:token:';
const REFRESH_TOKEN_PREFIX = 'blacklist:refresh:';

export class TokenBlacklistService {
    /**
     * Add a token to the blacklist
     * @param token - The JWT token to blacklist
     * @param expirationTime - Optional expiration time in seconds. If not provided, will decode token to get expiration
     */
    async addToBlacklist(token: string, expirationTime?: number): Promise<void> {
        try {
            const redis = await getRedisClient();
            
            // If expiration time not provided, decode token to get expiration
            if (!expirationTime) {
                const decoded = jwt.decode(token) as { exp?: number } | null;
                if (decoded && decoded.exp) {
                    expirationTime = decoded.exp;
                } else {
                    // Default to 15 minutes if we can't decode
                    expirationTime = Math.floor(Date.now() / 1000) + (15 * 60);
                }
            }

            const currentTime = Math.floor(Date.now() / 1000);
            const ttl = expirationTime - currentTime;

            // Only add if token hasn't expired yet
            if (ttl > 0) {
                await redis.setex(`${BLACKLIST_PREFIX}${token}`, ttl, '1');
                logger.debug('Token added to blacklist', { ttl });
            }
        } catch (error: any) {
            logger.error('Error adding token to blacklist', { error: error.message });
            // Don't throw - allow request to continue even if blacklist fails
        }
    }

    /**
     * Add a refresh token to the blacklist
     * @param refreshToken - The refresh token to blacklist
     * @param expirationTime - Optional expiration time in seconds. If not provided, will decode token to get expiration
     */
    async addRefreshTokenToBlacklist(refreshToken: string, expirationTime?: number): Promise<void> {
        try {
            const redis = await getRedisClient();
            
            // If expiration time not provided, decode token to get expiration
            if (!expirationTime) {
                const decoded = jwt.decode(refreshToken) as { exp?: number } | null;
                if (decoded && decoded.exp) {
                    expirationTime = decoded.exp;
                } else {
                    // Default to 7 days if we can't decode
                    expirationTime = Math.floor(Date.now() / 1000) + (7 * 24 * 60 * 60);
                }
            }

            const currentTime = Math.floor(Date.now() / 1000);
            const ttl = expirationTime - currentTime;

            // Only add if token hasn't expired yet
            if (ttl > 0) {
                await redis.setex(`${REFRESH_TOKEN_PREFIX}${refreshToken}`, ttl, '1');
                logger.debug('Refresh token added to blacklist', { ttl });
            }
        } catch (error: any) {
            logger.error('Error adding refresh token to blacklist', { error: error.message });
            // Don't throw - allow request to continue even if blacklist fails
        }
    }

    /**
     * Check if a token is blacklisted
     * @param token - The JWT token to check
     * @returns true if token is blacklisted, false otherwise
     */
    async isTokenBlacklisted(token: string): Promise<boolean> {
        try {
            const redis = await getRedisClient();
            const result = await redis.exists(`${BLACKLIST_PREFIX}${token}`);
            return result === 1;
        } catch (error: any) {
            logger.error('Error checking token blacklist', { error: error.message });
            // If Redis fails, assume token is not blacklisted to avoid blocking legitimate requests
            return false;
        }
    }

    /**
     * Check if a refresh token is blacklisted
     * @param refreshToken - The refresh token to check
     * @returns true if refresh token is blacklisted, false otherwise
     */
    async isRefreshTokenBlacklisted(refreshToken: string): Promise<boolean> {
        try {
            const redis = await getRedisClient();
            const result = await redis.exists(`${REFRESH_TOKEN_PREFIX}${refreshToken}`);
            return result === 1;
        } catch (error: any) {
            logger.error('Error checking refresh token blacklist', { error: error.message });
            // If Redis fails, assume token is not blacklisted to avoid blocking legitimate requests
            return false;
        }
    }

    /**
     * Blacklist all tokens for a user (useful for password reset, account compromise, etc.)
     * Note: This doesn't actually invalidate existing tokens, but can be used to track
     * that a user's tokens should be considered invalid
     * @param userId - The user ID
     * @param ttl - Time to live in seconds (default: 7 days)
     */
    async blacklistUserTokens(userId: string, ttl: number = 7 * 24 * 60 * 60): Promise<void> {
        try {
            const redis = await getRedisClient();
            const key = `blacklist:user:${userId}`;
            await redis.setex(key, ttl, '1');
            logger.info('User tokens blacklisted', { userId, ttl });
        } catch (error: any) {
            logger.error('Error blacklisting user tokens', { error: error.message, userId });
        }
    }

    /**
     * Check if a user's tokens are blacklisted
     * @param userId - The user ID
     * @returns true if user tokens are blacklisted, false otherwise
     */
    async isUserBlacklisted(userId: string): Promise<boolean> {
        try {
            const redis = await getRedisClient();
            const result = await redis.exists(`blacklist:user:${userId}`);
            return result === 1;
        } catch (error: any) {
            logger.error('Error checking user blacklist', { error: error.message, userId });
            return false;
        }
    }
}

export const tokenBlacklistService = new TokenBlacklistService();











