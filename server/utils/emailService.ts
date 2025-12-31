import nodemailer from 'nodemailer';
import dotenv from 'dotenv';
dotenv.config();
import logger from './logger';
import { ExternalServiceError } from './errors';
import sgMail from '@sendgrid/mail';

export const sendVerificationEmail = async (email: string, username: string, verificationToken: string): Promise<void> => {
    try {
        const baseUrl = process.env.BASE_URL || 'http://localhost:3000';
        const verificationUrl = `${baseUrl}/api/auth/verify?token=${verificationToken}`;

        if (process.env.SENDGRID_API_KEY && process.env.SENDGRID_FROM_EMAIL) {
            sgMail.setApiKey(process.env.SENDGRID_API_KEY);

            const msg = {
                to: email,
                from: process.env.SENDGRID_FROM_EMAIL,
                subject: 'Verify your email',
                html: `
            <p>Hello ${username},</p>
            <p>Thank you for registering to Proof of Art. Please click the link below to verify your email:</p>
            <a href="${verificationUrl}">Verify Email</a>
            <p>If you did not request this verification, please ignore this email.</p>
            <p>If the button doesn't work, copy and paste the following link into your browser:</p>
            <p>${verificationUrl}</p>
            <p>Best regards,</p>
            <p>The Proof of Art Team</p>
            `
            }

            await sgMail.send(msg);
            logger.info('Verification email sent to', { email });
        } else {
            const transporter = nodemailer.createTransport({
                service: 'gmail',
                auth: {
                    user: process.env.EMAIL_USER,
                    pass: process.env.EMAIL_PASS?.replace(/\s/g, ''),
                },
                connectionTimeout: 10000,
                greetingTimeout: 5000,
                socketTimeout: 10000,
            })

            const mailOptions = {
                from: process.env.EMAIL_USER,
                to: email,
                subject: 'Verify your email',
                html: `
            <p>Hello ${username},</p>
            <p>Thank you for registering to Proof of Art. Please click the link below to verify your email:</p>
            <a href="${verificationUrl}">Verify Email</a>
            <p>If you did not request this verification, please ignore this email.</p>
            <p>If the button doesn't work, copy and paste the following link into your browser:</p>
            <p>${verificationUrl}</p>
            <p>Best regards,</p>
            <p>The Proof of Art Team</p>
            
            `
            }

            const emailPromise = await transporter.sendMail(mailOptions);
            const timeoutPromise = new Promise((_, reject) => {
                setTimeout(() => reject(new Error('Email sending timeout')), 15000);
            })

            await Promise.race([emailPromise, timeoutPromise]);
            logger.info('Verification email sent to', { email });
        }
    } catch (error) {
        logger.error('Error sending verification email', { error: (error as Error).message });
        throw new ExternalServiceError('email', 'Error sending verification email');
    }
}