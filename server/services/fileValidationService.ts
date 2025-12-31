import { ValidationError } from '../utils/errors';
import logger from '../utils/logger';

export interface FileValidationOptions {
    allowedTypes?: string[];
    maxSize?: number; 
    cloudinaryMaxSize?: number; 
}

export interface ValidationResult {
    isValid: boolean;
    warnings?: string[];
}

export class FileValidationService {
    private readonly defaultAllowedTypes = ['image/jpeg', 'image/jpg', 'image/png'];
    private readonly defaultMaxSize = 100 * 1024 * 1024; 
    private readonly defaultCloudinaryMaxSize = 50 * 1024 * 1024; 

    validateFileType(mimetype: string, allowedTypes?: string[]): void {
        const types = allowedTypes || this.defaultAllowedTypes;
        
        if (!types.includes(mimetype)) {
            const allowedTypesStr = types.join(', ');
            throw new ValidationError(
                `Only images (${allowedTypesStr}) are allowed`,
                'file'
            );
        }
    }

    validateFileSize(fileSize: number, maxSize?: number): void {
        const max = maxSize || this.defaultMaxSize;
        
        if (fileSize > max) {
            const maxSizeMB = Math.round(max / (1024 * 1024));
            throw new ValidationError(
                `File too large. Maximum size is ${maxSizeMB}MB`,
                'file'
            );
        }
    }

    checkCloudinarySize(fileSize: number, filename: string, cloudinaryMaxSize?: number): void {
        const max = cloudinaryMaxSize || this.defaultCloudinaryMaxSize;
        
        if (fileSize > max) {
            logger.warn('Large file detected', {
                fileSize,
                maxRecommended: max,
                filename
            });
        }
    }

    validateFile(
        file: Express.Multer.File,
        options?: FileValidationOptions
    ): ValidationResult {
        const warnings: string[] = [];

        this.validateFileType(file.mimetype, options?.allowedTypes);

        this.validateFileSize(file.size, options?.maxSize);

        this.checkCloudinarySize(
            file.size,
            file.originalname,
            options?.cloudinaryMaxSize
        );

        return {
            isValid: true,
            warnings: warnings.length > 0 ? warnings : undefined
        };
    }
}

export const fileValidationService = new FileValidationService();

