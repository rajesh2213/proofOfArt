import { prisma } from '../config/prismaClient';
import { DatabaseError, ValidationError } from '../utils/errors';
import logger from '../utils/logger';
import { UserModel } from '../src/types/user';
import { v4 as uuidv4 } from 'uuid';
import bcrypt from 'bcryptjs';

export class UserService {

    async createGuestUser(): Promise<UserModel | null> {
        try {
            const existingGuestUser = await this.getGuestUser();
            if (existingGuestUser) {
                logger.info('Guest user already exists, returning existing user', { 
                    userId: existingGuestUser.id 
                });
                return existingGuestUser;
            }

            const guestUserName = process.env.GUEST_USER_NAME || 'guest_user';
            const guestUserEmail = process.env.GUEST_USER_EMAIL || `guest_${uuidv4()}@proofofart.com`;
            const guestUserPasswordHash = await bcrypt.hash('guest_password_' + Date.now(), 10);
            
            const guestUser = await prisma.user.create({
                data: {
                    username: guestUserName,
                    email: guestUserEmail,
                    passwordHash: guestUserPasswordHash,
                    role: 'CREATOR',
                    verified: true,
                    isAnonymous: true,
                    verificationToken: null,
                    verificationTokenExpiresAt: null,
                }
            });
            
            logger.info('Guest user created successfully', { 
                userId: guestUser.id,
                email: guestUserEmail
            });
            
            return guestUser as unknown as UserModel | null;
        } catch (error) {
            logger.error('Error creating guest user', { 
                error: (error as Error).message 
            });
            throw new DatabaseError('Error creating guest user', 'createGuestUser');
        }
    }

    async getGuestUser(): Promise<UserModel | null> {
        try {
            const guestUser = await prisma.user.findFirst({
                where: {
                    isAnonymous: true,
                }
            });
            return guestUser ? (guestUser as unknown as UserModel) : null;
        } catch (error) {
            logger.error('Error fetching guest user', { 
                error: (error as Error).message 
            });
            throw new DatabaseError('Error fetching guest user', 'getGuestUser');
        }
    }

    async getUserById(userId: string): Promise<UserModel | null> {
        try {
            if (!userId) {
                throw new ValidationError('User ID is required', 'getUserById');
            }

            const user = await prisma.user.findUnique({
                where: { id: userId }
            });
            
            return user ? (user as unknown as UserModel) : null;
        } catch (error: any) {
            if (error instanceof ValidationError) {
                throw error;
            }
            logger.error('Error fetching user by ID', { 
                error: error.message,
                userId
            });
            throw new DatabaseError('Error fetching user by ID', 'getUserById');
        }
    }

    async getUserByEmail(email: string): Promise<UserModel | null> {
        try {
            if (!email) {
                throw new ValidationError('Email is required', 'getUserByEmail');
            }

            const user = await prisma.user.findUnique({
                where: { email }
            });
            
            return user ? (user as unknown as UserModel) : null;
        } catch (error: any) {
            if (error instanceof ValidationError) {
                throw error;
            }
            logger.error('Error fetching user by email', { 
                error: error.message,
                email: email.substring(0, 5) + '...'
            });
            throw new DatabaseError('Error fetching user by email', 'getUserByEmail');
        }
    }

    /**
     * Gets user statistics
     * @param userId - The user ID
     * @returns Object containing user statistics
     */
    async getUserStats(userId: string): Promise<{
        totalClaims: number;
        verifiedClaims: number;
        pendingClaims: number;
    }> {
        try {
            const claims = await prisma.imageClaim.findMany({
                where: { userId },
                select: { status: true }
            });

            const stats = {
                totalClaims: claims.length,
                verifiedClaims: claims.filter(c => 
                    c.status === 'VERIFIED_OWNER' || c.status === 'VERIFIED_UPLOADER'
                ).length,
                pendingClaims: claims.filter(c => c.status === 'PENDING').length
            };

            return stats;
        } catch (error: any) {
            logger.error('Error fetching user stats', { 
                error: error.message,
                userId
            });
            throw new DatabaseError('Error fetching user stats', 'getUserStats');
        }
    }
}

export const userService = new UserService();
