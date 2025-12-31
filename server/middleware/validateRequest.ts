import { validationResult } from 'express-validator';
import logger from '../utils/logger';
import { Request, Response, NextFunction } from 'express';
import { ValidationError } from '../utils/errors';

export const validateRequest = (req: Request, res: Response, next: NextFunction): void => {
    const errors = validationResult(req);
    if(!errors.isEmpty()) {
        logger.error('Validation errors', { errors: errors.array() });
        throw new ValidationError('Validation errors', errors.array().map(err => err.msg).join(', '));
    }
    next();
}