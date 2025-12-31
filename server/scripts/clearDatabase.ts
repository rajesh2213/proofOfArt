import dotenv from 'dotenv';
dotenv.config();

import { prisma } from '../config/prismaClient';
import logger from '../utils/logger';

async function clearDatabase() {
    try {
        logger.info('Starting database cleanup...');

        await prisma.$executeRawUnsafe(`
            TRUNCATE TABLE 
                notifications,
                ownership_history,
                artwork_claims,
                artworks,
                key_store,
                edit_detections,
                detection_report,
                image_claims,
                images,
                users
            CASCADE;
        `);

        logger.info('Database cleared successfully - all data deleted, tables preserved');
    } catch (error: any) {
        logger.error('Error clearing database', {
            error: error.message,
            code: error.code
        });
        throw error;
    } finally {
        await prisma.$disconnect();
    }
}

if (require.main === module) {
    clearDatabase()
        .then(() => {
            logger.info('Database cleanup completed');
            process.exit(0);
        })
        .catch((error) => {
            logger.error('Database cleanup failed', { error: error.message });
            process.exit(1);
        });
}

export { clearDatabase };

