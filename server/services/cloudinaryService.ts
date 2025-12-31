import cloudinary, { checkIfExistsCloudinary } from '../config/cloudinary';
import { CloudinaryResource } from '../src/types/cloudinary';
import { ExternalServiceError } from '../utils/errors';
import logger from '../utils/logger';

export interface UploadOptions {
    folder?: string;
    resource_type?: string;
    public_id?: string;
}

export interface CloudinaryUploadResult {
    resource: CloudinaryResource;
    isNewUpload: boolean;
}

export class CloudinaryService {
    private readonly defaultFolder = 'proofOfArt';

    async checkIfExists(publicId: string): Promise<{ exists: boolean; data: CloudinaryResource | null }> {
        return checkIfExistsCloudinary(publicId);
    }

    async uploadFile(
        fileBuffer: Buffer,
        mimetype: string,
        publicId?: string,
        options?: UploadOptions
    ): Promise<CloudinaryResource> {
        try {
            const uploadOptions = {
                folder: options?.folder || this.defaultFolder,
                resource_type: options?.resource_type || 'auto',
                ...(publicId && { public_id: publicId }),
                ...options
            };

            logger.info('Uploading to Cloudinary', {
                publicId: publicId || 'auto-generated',
                fileSize: fileBuffer.length,
                mimetype,
                options: uploadOptions
            });

            const result = await cloudinary.uploader.upload(
                `data:${mimetype};base64,${fileBuffer.toString('base64')}`,
                uploadOptions
            );

            logger.info('Cloudinary upload successful', {
                publicId: result.public_id,
                secureUrl: result.secure_url,
                resourceType: result.resource_type
            });

            return result as CloudinaryResource;
        } catch (error: any) {
            logger.error('Cloudinary upload failed', {
                publicId,
                error: error.message,
                statusCode: error.http_code,
                response: error.response
            });
            throw new ExternalServiceError(
                'cloudinary',
                `Cloudinary upload failed: ${error.message}`
            );
        }
    }

    async getOrUploadFile(
        fileBuffer: Buffer,
        mimetype: string,
        hash: string,
        options?: UploadOptions
    ): Promise<CloudinaryUploadResult> {
        const publicId = options?.public_id || `proofOfArt/proofOfArt_${hash}`;

        const { exists, data } = await this.checkIfExists(publicId);

        if (exists && data) {
            logger.info('Resource already exists in Cloudinary', {
                publicId,
                secureUrl: data.secure_url
            });
            return {
                resource: data,
                isNewUpload: false
            };
        }

        const resource = await this.uploadFile(
            fileBuffer,
            mimetype,
            publicId,
            options
        );

        return {
            resource,
            isNewUpload: true
        };
    }
    extractMetadata(resource: CloudinaryResource): {
        width: number;
        height: number;
        format: string;
        version: number;
        resource_type: string;
        type: string;
        created_at: string;
        bytes: number;
        tags: string[];
    } {
        return {
            width: resource.width,
            height: resource.height,
            format: resource.format,
            version: resource.version,
            resource_type: resource.resource_type,
            type: resource.type,
            created_at: resource.created_at,
            bytes: resource.bytes,
            tags: resource.tags || []
        };
    }
}

export const cloudinaryService = new CloudinaryService();