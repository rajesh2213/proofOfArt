import dotenv from 'dotenv';
import { ExternalServiceError } from '../utils/errors';
import { CloudinaryResource } from '../src/types/cloudinary';
import logger from '../utils/logger';

dotenv.config();

const { v2: cloudinary } = require('cloudinary');

const { CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, CLOUDINARY_API_SECRET } = process.env as Record<string, string | undefined>;

if (!CLOUDINARY_CLOUD_NAME || !CLOUDINARY_API_KEY || !CLOUDINARY_API_SECRET) {
	throw new Error('Cloudinary not configured: set CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, CLOUDINARY_API_SECRET');
}

cloudinary.config({
	cloud_name: CLOUDINARY_CLOUD_NAME,
	api_key: CLOUDINARY_API_KEY,
	api_secret: CLOUDINARY_API_SECRET,
});

export default cloudinary;

export const checkIfExistsCloudinary = async (publicId: string): Promise<{exists: boolean, data: CloudinaryResource | null}> => {
    try {
        const res = await cloudinary.api.resource(publicId);
        logger.debug('Resource found in Cloudinary', { publicId: res.public_id });
        return { exists: true, data: res };
    } catch (error: any) {
        const statusCode = error.error?.http_code || error.statusCode;
        const message = error.error?.message || error.message;
        
        if (statusCode === 404) {
            logger.debug('Resource not found in Cloudinary', { publicId, statusCode });
            return { exists: false, data: null };
        }
        
        logger.error('Cloudinary API error', {
            statusCode,
            message,
            publicId,
            error: error.message
        });
        throw new ExternalServiceError('cloudinary', `API error: ${message} (Status: ${statusCode})`);
    }
}
