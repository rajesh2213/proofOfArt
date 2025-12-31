import express from 'express'
import { body } from 'express-validator';
import { registerUser, loginUser, logoutUser, refreshToken, resendVerificationEmail, verifyUser, googleAuthCallback, completeGoogleSignup } from '../controllers/authController';
import { validateRequest } from '../middleware/validateRequest';
import passport from '../config/passport';

const authRouter = express.Router();

authRouter.post('/register', [
    body('username').notEmpty().withMessage('Username is required'),
    body('email').notEmpty().withMessage('Email is required').isEmail().withMessage('Invalid email'),
    body('password').notEmpty().withMessage('Password is required').isLength({ min: 8 }).withMessage('Password must be at least 8 characters long'),
    body('confirmPassword').notEmpty().withMessage('Confirm password is required.')
    .custom((value, { req }) => value === req.body.password).withMessage('Passwords do not match')
] ,validateRequest, registerUser);
authRouter.post('/login', loginUser);
authRouter.post('/logout', logoutUser);
authRouter.post('/refresh-token', refreshToken);
authRouter.post('/resend-verification-email', resendVerificationEmail);
authRouter.get('/verify', verifyUser);

authRouter.get('/google', passport.authenticate('google', { scope: ['profile', 'email'] }));
authRouter.get('/google/callback', passport.authenticate('google', { session: false }), googleAuthCallback);
authRouter.post('/google/complete', [
    body('googleId').notEmpty().withMessage('Google ID is required'),
    body('email').notEmpty().withMessage('Email is required').isEmail().withMessage('Invalid email'),
    body('username').notEmpty().withMessage('Username is required'),
    body('password').notEmpty().withMessage('Password is required').isLength({ min: 8 }).withMessage('Password must be at least 8 characters long'),
], validateRequest, completeGoogleSignup);

export default authRouter;