import {PrismaClient} from '../generated/prisma/client';
import logger from '../utils/logger';

export const prisma = new PrismaClient({
    log: process.env.NODE_ENV === 'development' ? ['error', 'warn'] : ['error'],
});

prisma.$on('error' as never, (e: any) => {
    logger.error('Prisma Client Error:', e);
});

export async function checkDatabaseConnection(): Promise<boolean> {
    try {
        await prisma.$queryRaw`SELECT 1`;
        logger.info('Database connection successful');
        return true;
    } catch (error: any) {
        logger.error('Database connection failed:', {
            error: error.message,
            code: error.code,
            meta: error.meta
        });
        
        if (error.code === 'ECONNREFUSED' || error.message?.includes("Can't reach database server")) {
            logger.error(`PostgreSQL database server is not running.`);
        }
        return false;
    }
}