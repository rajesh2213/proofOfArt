import { Request, Response } from 'express';
import { ExternalServiceError, ValidationError, DatabaseError } from '../utils/errors';
import logger from '../utils/logger';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import { sendVerificationEmail } from '../utils/emailService';
import { getUserByEmail, createUser, updateUser, getUserByVerificationToken, getUserById } from '../models/authModel';
import { prisma } from '../config/prismaClient';
import jwt from 'jsonwebtoken';

export const registerUser = async (req: Request, res: Response): Promise<void> => {
    try {
        const { username, email, password } = req.body

        const existingUser = await getUserByEmail(email);
        if(existingUser) {
            throw new ValidationError('User already exists', 'email');
        }
        const hashedPwd = await bcrypt.hash(password, 10);
        const verificationToken = crypto.randomBytes(32).toString('hex');
        const verificationTokenExpiresAt = new Date(Date.now() + 1000 * 60 * 60 * 24)
        const user = await createUser({username, email, passwordHash: hashedPwd, verified: false, verificationToken, verificationTokenExpiresAt})

        if(!user) {
            throw new DatabaseError('Error creating user', 'registerUser');
        }

        await sendVerificationEmail(email, username, verificationToken)
        res.status(201).json({message: 'User created successfully. Please check your email for verification.'})

    } catch (error) {
        logger.error('Error registering user', { error: (error as Error).message });
        throw new ExternalServiceError('auth', 'Error registering user');
    }
}

export const resendVerificationEmail = async (require: Request, res: Response): Promise<void> => {
    try {
        const { email} = require.body;
        const user = await getUserByEmail(email);
        if(!user) {
            throw new ValidationError('User not found', 'email');
        }
        if(user.verified) {
            throw new ValidationError('User already verified', 'email');
        }
        if(user.verificationTokenExpiresAt && user.verificationTokenExpiresAt < new Date()) {
            throw new ValidationError('Verification token expired', 'email');
        }
        const verificationToken = crypto.randomBytes(32).toString('hex');
        const verificationTokenExpiresAt = new Date(Date.now() + 1000 * 60 * 60 * 24)
        await updateUser(user.id, {verificationToken, verificationTokenExpiresAt})
        await sendVerificationEmail(email, user.username, verificationToken)
        res.status(200).json({message: 'Verification email sent successfully. Please check your email for verification.'})
    } catch (error) {
        logger.error('Error resending verification email', { error: (error as Error).message });
        throw new ExternalServiceError('auth', 'Error resending verification email');
    }
}

export const verifyUser = async (req: Request, res: Response): Promise<void> => {
    try {
        const { token } = req.query;
        if(!token) {
            throw new ValidationError('Verification token is required', 'token');
        }
        const user = await getUserByVerificationToken(token as string);
        if(!user) {
            throw new ValidationError('Invalid verification token', 'token');
        }
        if(user.verificationTokenExpiresAt && user.verificationTokenExpiresAt < new Date()) {
            throw new ValidationError('Verification token expired', 'token');
        }
        if(user.verified) {
            throw new ValidationError('User already verified', 'token');
        }
        await updateUser(user.id, {verified: true, verificationToken: null, verificationTokenExpiresAt: null})
        res.status(200).json({message: 'User verified successfully.'})
        logger.info('User verified successfully', { userId: user.id });
    } catch (error) {
        logger.error('Error verifying user', { error: (error as Error).message });
        throw new ExternalServiceError('auth', 'Error verifying user');
    }
}

export const loginUser = async (req: Request, res: Response): Promise<void> => {
    try {
        const { email, password } = req.body;
        const user = await getUserByEmail(email);
        if(!user) {
            throw new ValidationError('Invalid email or password', 'email');
        }
        const isPasswordValid = await bcrypt.compare(password, user.passwordHash);
        if(!isPasswordValid) {
            throw new ValidationError('Invalid email or password', 'email');
        }
        if(!user.verified) {
            throw new ValidationError('User not verified', 'email');
        }

        const {passwordHash, role, verified, verificationToken, verificationTokenExpiresAt, ...userData} = user;
        const accessToken = jwt.sign({ id: user.id}, process.env.JWT_SECRET as string, {expiresIn: '15m'})
        const refreshToken = jwt.sign({ id: user.id}, process.env.JWT_SECRET as string, {expiresIn: '7d'})
        res.cookie('refreshToken', refreshToken, {
            httpOnly: true,
            secure: true,
            maxAge: 7 * 24 * 60 * 60 * 1000,
            sameSite: process.env.NODE_ENV === 'production' ? 'strict' : 'none',
            path: '/',
        })
        res.status(200).json({message: 'Login successful', user: userData ,accessToken})
    } catch (error) {
        logger.error('Error logging in user', { error: (error as Error).message });
        throw new ExternalServiceError('auth', 'Error logging in user');
    }
}

export const logoutUser = async (req: Request, res: Response): Promise<void> => {
    try {
        res.clearCookie('refreshToken', {
            httpOnly: true,
            secure: true,
            sameSite: process.env.NODE_ENV === 'production' ? 'strict' : 'none',
            path: '/',
        })
        res.status(200).json({message: 'Logout successful'})
    } catch (error) {
        logger.error('Error logging out user', { error: (error as Error).message });
        throw new ExternalServiceError('auth', 'Error logging out user');
    }
}

export const refreshToken = async (req: Request, res: Response): Promise<void> => {
    try {   
        const refreshToken = req.cookies.refreshToken;
        if(!refreshToken) {
            throw new ValidationError('Refresh token is required', 'refreshToken');
        }
        const decoded = jwt.verify(refreshToken, process.env.JWT_SECRET as string) as { id: string };
        const user = await getUserById(decoded.id);
        if(!user) {
            throw new ValidationError('User not found', 'refreshToken');
        }
        if(!user.verified) {
            throw new ValidationError('User not verified', 'refreshToken');
        }
        const {passwordHash, role, verified, verificationToken, verificationTokenExpiresAt, ...userData} = user;
        const accessToken = jwt.sign({ id: user.id}, process.env.JWT_SECRET as string, {expiresIn: '15m'})
        res.status(200).json({message: 'Token refreshed successfully', user: userData, accessToken})
    } catch (error) {
        logger.error('Error refreshing token', { error: (error as Error).message });
        throw new ExternalServiceError('auth', 'Error refreshing token');
    }
}

export const googleAuthCallback = async (req: Request, res: Response): Promise<void> => {
    try {
        const user = req.user as any;
        if(!user) {
            throw new ValidationError('Authentication failed', 'google');
        }

        if (user.isNewUser === true) {
            const clientUrl = process.env.CLIENT_URL || 'http://localhost:3000';
            res.redirect(`${clientUrl}/auth/google/pending-setup?googleId=${encodeURIComponent(user.googleId)}&email=${encodeURIComponent(user.email)}`);
            return;
        }

        const {passwordHash, role, verified, verificationToken, verificationTokenExpiresAt, ...userData} = user;
        const accessToken = jwt.sign({ id: user.id}, process.env.JWT_SECRET as string, {expiresIn: '15m'})
        const refreshToken = jwt.sign({ id: user.id}, process.env.JWT_SECRET as string, {expiresIn: '7d'})
        
        res.cookie('refreshToken', refreshToken, {
            httpOnly: true,
            secure: true,
            maxAge: 7 * 24 * 60 * 60 * 1000,
            sameSite: process.env.NODE_ENV === 'production' ? 'strict' : 'none',
            path: '/',
        })

        const clientUrl = process.env.CLIENT_URL || 'http://localhost:3000';
        res.redirect(`${clientUrl}/auth/google/callback?token=${accessToken}&user=${encodeURIComponent(JSON.stringify(userData))}`);
    } catch (error) {
        logger.error('Error in Google OAuth callback', { error: (error as Error).message });
        const clientUrl = process.env.CLIENT_URL || 'http://localhost:3000';
        res.redirect(`${clientUrl}/login?error=google_auth_failed`);
    }
}

export const completeGoogleSignup = async (req: Request, res: Response): Promise<void> => {
    try {
        const { googleId, email, username, password } = req.body;

        if (!googleId || !email || !username || !password) {
            throw new ValidationError('All fields are required', 'completeGoogleSignup');
        }

        if (password.length < 8) {
            throw new ValidationError('Password must be at least 8 characters long', 'password');
        }

        const existingUserByGoogleId = await prisma.user.findUnique({
            where: { googleId: googleId }
        });
        if (existingUserByGoogleId) {
            throw new ValidationError('User already exists', 'email');
        }

        const existingUserByUsername = await prisma.user.findFirst({
            where: { username: username }
        });
        if (existingUserByUsername) {
            throw new ValidationError('Username already taken', 'username');
        }

        const existingUserByEmail = await getUserByEmail(email);
        if (existingUserByEmail) {
            throw new ValidationError('Email already registered', 'email');
        }

        const hashedPassword = await bcrypt.hash(password, 10);

        const user = await createUser({
            username,
            email,
            passwordHash: hashedPassword,
            verified: true,
            verificationToken: null,
            verificationTokenExpiresAt: null,
        });

        if (!user) {
            throw new DatabaseError('Error creating user', 'completeGoogleSignup');
        }

        await prisma.user.update({
            where: { id: user.id },
            data: {
                googleId: googleId,
            } as any
        });

        const {passwordHash: _, role, verified, verificationToken, verificationTokenExpiresAt, ...userData} = user;
        const accessToken = jwt.sign({ id: user.id}, process.env.JWT_SECRET as string, {expiresIn: '15m'})
        const refreshToken = jwt.sign({ id: user.id}, process.env.JWT_SECRET as string, {expiresIn: '7d'})
        
        res.cookie('refreshToken', refreshToken, {
            httpOnly: true,
            secure: true,
            maxAge: 7 * 24 * 60 * 60 * 1000,
            sameSite: process.env.NODE_ENV === 'production' ? 'strict' : 'none',
            path: '/',
        })

        res.status(201).json({
            message: 'Account created successfully',
            user: userData,
            accessToken
        });
    } catch (error) {
        logger.error('Error completing Google signup', { error: (error as Error).message });
        throw error;
    }
}