import passport from 'passport';
import { Strategy as GoogleStrategy } from 'passport-google-oauth20';
import { prisma } from '../config/prismaClient';
import logger from '../utils/logger';
import { ExtractJwt, Strategy as JwtStrategy, VerifiedCallback } from 'passport-jwt';

interface JwtPayload {
    id: string;
}

const options = {
    jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
    secretOrKey: process.env.JWT_SECRET as string,
}

passport.use(new JwtStrategy(options, async (jwtPayload: JwtPayload, done: VerifiedCallback) => {
    try {
        const user = await prisma.user.findUnique({
            where: {id: jwtPayload.id}
        })
        if(!user) {
            return done(null, false, { message: 'User not found' })
        }
        return done(null, user);
    } catch (error) {
        logger.error('Error verifying token', { error: (error as Error).message });
        return done(error);
    }
}))

passport.use(new GoogleStrategy({
    clientID: process.env.GOOGLE_CLIENT_ID as string,
    clientSecret: process.env.GOOGLE_CLIENT_SECRET as string,
    callbackURL: process.env.GOOGLE_CALLBACK_URL || "/api/auth/google/callback"
}, async (accessToken, refreshToken, profile, done) => {
    try {
        if (!profile.emails || !profile.emails[0]) {
            return done(new Error('No email found in Google profile'), false);
        }

        const email = profile.emails[0].value;
        const googleId = profile.id;

        let user = await prisma.user.findUnique({
            where: { googleId: googleId }
        });

        if (user) {
            return done(null, user);
        }

        user = await prisma.user.findUnique({
            where: { email: email }
        });

        if (user) {
            user = await prisma.user.update({
                where: { id: user.id },
                data: {
                    googleId: googleId,
                } as any
            });
            return done(null, user);
        }

        return done(null, {
            googleId: googleId,
            email: email,
            isNewUser: true
        });
    } catch (error) {
        logger.error('Error in Google OAuth strategy:', error);
        return done(error, false);
    }
}));

passport.serializeUser((user: any, done: (err: any, id?: string) => void) => {
    done(null, user.id);
})

passport.deserializeUser(async (id: string, done: (err: any, user?: any) => void) => {
    try {
        const user = await prisma.user.findUnique({
            where: {id: id}
        })
        if(!user) {
            return done(null, false)
        }
        return done(null, user);
    } catch (error) {
        logger.error('Error deserializing user', { error: (error as Error).message });
        return done(error);
    }
})

export default passport;