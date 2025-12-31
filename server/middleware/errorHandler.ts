import { Request, Response, NextFunction } from 'express';
import { AppError } from '../utils/errors';
import logger from '../utils/logger';

const isDevelopment = process.env.NODE_ENV === 'development';

const handleMulterError = (err: any): AppError => {
    switch (err.code) {
        case 'LIMIT_FILE_SIZE':
            return new AppError('File too large. Maximum size is 100MB.', 400);
        case 'LIMIT_FILE_COUNT':
            return new AppError('Too many files. Maximum is 1 file.', 400);
        case 'LIMIT_UNEXPECTED_FILE':
            return new AppError('Unexpected field name for file upload.', 400);
        case 'LIMIT_PART_COUNT':
            return new AppError('Too many parts in the request.', 400);
        case 'LIMIT_FIELD_KEY':
            return new AppError('Field name too long.', 400);
        case 'LIMIT_FIELD_VALUE':
            return new AppError('Field value too long.', 400);
        case 'LIMIT_FIELD_COUNT':
            return new AppError('Too many fields.', 400);
        default:
            return new AppError(err.message || 'File upload error', 400);
    }
};

const sendErrorDev = (err: any, req: Request, res: Response) => {
    const statusCode = err.statusCode || 500;
    const errorResponse = {
        success: false,
        error: {
            message: err.message,
            statusCode: statusCode,
            timestamp: err.timestamp,
            path: req.originalUrl,
            method: req.method,
            stack: err.stack
        },
        stack: err.stack
    };
    res.status(statusCode).json(errorResponse);
};

const sendErrorProd = (err: any, req: Request, res: Response) => {
    if (err.isOperational) {
        const statusCode = err.statusCode || 500;
        const errorResponse = {
            success: false,
            error: {
                message: err.message,
                statusCode: statusCode,
                timestamp: err.timestamp,
                path: req.originalUrl,
                method: req.method
            }
        };
        res.status(statusCode).json(errorResponse);
    } else {
        logger.error('Programming or unknown error', {
            message: err.message,
            stack: err.stack,
            name: err.name,
            code: err.code,
            fullError: err,
            path: req.originalUrl,
            method: req.method,
            ip: req.ip
        });
        const errorResponse = {
            success: false,
            error: {
                message: 'Something went wrong!',
                statusCode: 500,
                timestamp: new Date().toISOString(),
                path: req.originalUrl,
                method: req.method
            }
        };
        res.status(500).json(errorResponse);
    }
};

const logError = (err: any, req: Request) => {
    logger.error(err.message || 'Unknown error', {
        statusCode: err.statusCode,
        path: req.originalUrl,
        method: req.method,
        userAgent: req.get('User-Agent'),
        ip: req.ip,
        stack: err.stack,
        name: err.name,
        code: err.code,
        fullError: err
    });
};

export const globalErrorHandler = (err: any, req: Request, res: Response, next: NextFunction) => {
    let error = { ...err };
    error.message = err.message;
    error.timestamp = new Date().toISOString();
    
    logError(error, req);
    
    if (err.name === 'MulterError') {
        error = handleMulterError(err);
    }
    
    if (err.name === 'FetchError' || err.name === 'AxiosError') {
        error = new AppError('External service unavailable', 502);
    }
    
    if (err instanceof SyntaxError && err.message.includes('JSON')) {
        error = new AppError('Invalid JSON in request body', 400);
    }
    
    if (!error.statusCode) {
        error.statusCode = 500;
        error.isOperational = false;
    }
    
    if (isDevelopment) {
        sendErrorDev(error, req, res);
    } else {
        sendErrorProd(error, req, res);
    }
};

export const catchAsync = (fn: Function) => {
    return (req: Request, res: Response, next: NextFunction) => {
        fn(req, res, next).catch(next);
    };
};

export const handleUnhandledRejection = () => {
    process.on('unhandledRejection', (err: any) => {
        logger.error('UNHANDLED REJECTION! Shutting down...', {
            name: err.name,
            message: err.message,
            stack: err.stack
        });
        process.exit(1);
    });
};

export const handleUncaughtException = () => {
    process.on('uncaughtException', (err: any) => {
        logger.error('UNCAUGHT EXCEPTION! Shutting down...', {
            name: err.name,
            message: err.message,
            stack: err.stack
        });
        process.exit(1);
    });
};

export const notFoundHandler = (req: Request, res: Response, next: NextFunction) => {
    const error = new AppError(`Route ${req.originalUrl} not found`, 404);
    next(error);
};
