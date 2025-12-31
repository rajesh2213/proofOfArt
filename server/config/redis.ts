import dotenv from 'dotenv';
import Redis, { RedisOptions } from 'ioredis';
import logger from '../utils/logger';

dotenv.config();

class RedisClient {
    private client: Redis | null = null;

    async connect(): Promise<Redis> {
        try {
            logger.info('Connecting to Redis...');
            let redisConfig: RedisOptions;

            if (process.env.REDIS_URL) {
                const redisUrl = new URL(process.env.REDIS_URL);
                redisConfig = {
                    host: redisUrl.hostname,
                    port: parseInt(redisUrl.port) || 6379,
                    password: redisUrl.password || undefined,
                    db: parseInt(redisUrl.searchParams.get('db') || '0'),
                    retryStrategy: (times: number) => {
                        if (times > 3) {
                            return null; 
                        }
                        return Math.min(times * 50, 1000);
                    },
                    lazyConnect: true,
                    maxRetriesPerRequest: 3,
                    connectTimeout: 10000,
                    commandTimeout: 5000,
                };
            } else {
                redisConfig = {
                    host: process.env.REDIS_HOST || 'localhost',
                    port: parseInt(process.env.REDIS_PORT || '6379'),
                    password: process.env.REDIS_PASSWORD || undefined,
                    db: parseInt(process.env.REDIS_DB || '0'),
                    retryStrategy: (times: number) => {
                        if (times > 3) {
                            return null; 
                        }
                        return Math.min(times * 50, 1000);
                    },
                    lazyConnect: true,
                    maxRetriesPerRequest: 3,
                    connectTimeout: 10000,
                    commandTimeout: 5000,
                };
            }

            this.client = new Redis(redisConfig);

            this.client.on('connect', () => {
                logger.info('Redis connection established');
            });

            this.client.on('ready', () => {
                logger.info('Redis client ready');
            });

            this.client.on('error', (error: Error) => {
                logger.error('Redis connection error:', error);
            });

            this.client.on('close', () => {
                logger.info('Redis connection closed');
            });

            this.client.on('reconnecting', () => {
                logger.warn('Redis connection lost. Attempting to reconnect...');
            });

            await this.client.connect();
            return this.client;
        } catch (error) {
            logger.error('Failed to connect to Redis:', error);
            throw error;
        }
    }

    async getClient(): Promise<Redis> {
        if (!this.client) {
            await this.connect();
        }
        if (!this.client) {
            throw new Error('Failed to establish Redis connection');
        }
        return this.client;
    }

    async checkConnection(): Promise<boolean> {
        try {
            if (!this.client) {
                await this.connect();
            }
            const result = await this.client!.ping();
            if (result === 'PONG') {
                logger.info('Redis connection check successful');
                return true;
            }
            return false;
        } catch (error: any) {
            logger.error('Redis connection check failed:', {
                error: error.message,
                code: error.code,
            });

            if (error.code === 'ECONNREFUSED' || error.message?.includes('connect')) {
                const host = process.env.REDIS_HOST || 'localhost';
                const port = process.env.REDIS_PORT || '6379';
                logger.error(`Redis connection error on ${host}:${port}: ${error.message}`);
            }
            return false;
        }
    }

    async disconnect(): Promise<void> {
        if (this.client) {
            await this.client.quit();
            this.client = null;
            logger.info('Redis connection closed');
        }
    }
}

const redisClient = new RedisClient();

export async function checkRedisConnection(): Promise<boolean> {
    return redisClient.checkConnection();
}

export async function getRedisClient(): Promise<Redis> {
    return redisClient.getClient();
}

process.on('SIGINT', async () => {
    logger.info('Closing Redis connection...');
    await redisClient.disconnect();
    process.exit(0);
});

process.on('SIGTERM', async () => {
    logger.info('Closing Redis connection...');
    await redisClient.disconnect();
    process.exit(0);
});

export default redisClient;
