import { prisma } from '../config/prismaClient';
import { Role } from '../generated/prisma/client';
import logger from '../utils/logger';
import { DatabaseError } from '../utils/errors';
import { UserModel, UserCreateInput, UserUpdateInput } from '../src/types/user';

export const getUserByEmail = async (email: string): Promise<UserModel | null> => {
    try { 
        const user = await prisma.user.findUnique({
            where: {email}
        })
        return user as unknown as UserModel | null;
    } catch (error) {
        logger.error('Error fetching user', { error: (error as Error).message });
        throw new DatabaseError('Error fetching user', 'getUserByEmail');
    }
}

export const createUser = async (userData: UserCreateInput): Promise<UserModel | null> => {
    try {
        const user = await prisma.user.create({
            data: {
                username: userData.username,
                email: userData.email,
                passwordHash: userData.passwordHash,
                verified: userData.verified,
                role: Role.CREATOR,
                verificationToken: userData.verificationToken,
                verificationTokenExpiresAt: userData.verificationTokenExpiresAt,
            } as any
        })
        return user as unknown as UserModel | null;
    } catch (error) {
        logger.error('Error creating user', { error: (error as Error).message });
        throw new DatabaseError('Error creating user', 'createUser');
    }
}

export const updateUser = async (userId: string, userData: UserUpdateInput): Promise<UserModel | null> => {
    try {
        const user = await prisma.user.update({
            where: {id: userId},
            data: {
                ...(userData.verified !== undefined && { verified: userData.verified }),
                verificationToken: userData.verificationToken,
                verificationTokenExpiresAt: userData.verificationTokenExpiresAt,
            }
        })
        return user as unknown as UserModel | null;
    } catch (error) {
        logger.error('Error updating user', { error: (error as Error).message });
        throw new DatabaseError('Error updating user', 'updateUser');
    }
}

export const getUserByVerificationToken = async (verificationToken: string): Promise<UserModel | null> => {
    try {
        const user = await prisma.user.findUnique({
            where: {verificationToken}
        })
        return user as unknown as UserModel | null;
    } catch (error) {
        logger.error('Error fetching user by verification token', { error: (error as Error).message });
        throw new DatabaseError('Error fetching user by verification token', 'getUserByVerificationToken');
    }
}

export const getUserById = async (userId: string): Promise<UserModel | null> => {
    try {
        const user = await prisma.user.findUnique({
            where: {id: userId}
        })
        return user as unknown as UserModel | null;
    } catch (error) {
        logger.error('Error fetching user by id', { error: (error as Error).message });
        throw new DatabaseError('Error fetching user by id', 'getUserById');
    }
}