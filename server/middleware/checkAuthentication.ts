import { Request, Response, NextFunction } from 'express';
import passport from '../config/passport';
import logger from '../utils/logger';
import { ExternalServiceError, AppError } from '../utils/errors';

class UnauthorizedError extends AppError {
    constructor(message: string = 'Unauthorized') {
        super(message, 401);
    }
}

export const checkAuthentication = (failIfNotAuthenticated: boolean = false) => {
    return (req: Request, res: Response, next: NextFunction): void => {
        passport.authenticate('jwt', { session: false }, (err: any, user: any, info: any) => {
            try {
                if (err) {
                    logger.error('Authentication error', { error: (err as Error).message });
                    return next(err);
                }
                if (!user) {
                    if (failIfNotAuthenticated) {
                        return next(new UnauthorizedError('Unauthorized'));
                    }
                    return next();
                }
                req.user = user;
                return next();
            } catch (error) {
                logger.error('Error checking authentication', { error: (error as Error).message });
                return next(new ExternalServiceError('auth', 'Error checking authentication'));
            }
        })(req, res, next);
    };
};