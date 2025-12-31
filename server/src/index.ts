import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import cookieParser from "cookie-parser";
import session from "express-session";

dotenv.config();

import uploadRouter from "../routes/upload";
import authRouter from "../routes/auth";
import progressRouter from "../routes/progress";
import artRouter from "../routes/art";
import notificationRouter from "../routes/notifications";

import {
    globalErrorHandler,
    notFoundHandler
} from "../middleware/errorHandler";
import logger from "../utils/logger";
import passport from '../config/passport';
import { checkDatabaseConnection } from '../config/prismaClient';
import { checkRedisConnection } from '../config/redis';
import { cryptographicSigner } from '../services/cryptographicSigner';
import { keyStoreService } from '../services/keyStoreService';

const app = express();

app.set('trust proxy', 1);

app.use(express.json({ limit: '25mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());

async function startServer() {
    const dbConnected = await checkDatabaseConnection();
    if (!dbConnected) {
        logger.error('Server startup aborted: Database connection failed');
        process.exit(1);
    }

    try {
        const systemKeyId = cryptographicSigner.getSystemKeyId();
        const systemPublicKeyPem = cryptographicSigner.getSystemPublicKeyPem();
        await keyStoreService.initializeSystemKey(systemKeyId, systemPublicKeyPem);
        logger.info('System key initialized in KeyStore', { keyId: systemKeyId });
    } catch (error: any) {
        logger.error('Failed to initialize system key', { error: error.message });
    }
    app.use(cors({
        origin: process.env.CLIENT_URL || "http://localhost:3000",
        credentials: true,
        methods: ["GET", "POST", "PUT", "DELETE", "PATCH", "OPTIONS"],
        allowedHeaders: ["Content-Type", "Authorization", "X-Requested-With", "Accept", "Origin"]
    }));

    app.use(session({
        secret: process.env.SESSION_SECRET || process.env.JWT_SECRET || 'your-secret-key-change-in-production',
        resave: false,
        saveUninitialized: false,
        cookie: {
            secure: process.env.NODE_ENV === 'production',
            httpOnly: true,
            maxAge: 24 * 60 * 60 * 1000,
            sameSite: process.env.NODE_ENV === 'production' ? 'strict' : 'none',
        }
    }));

    app.use(passport.initialize());
    app.use(passport.session());

    app.use((req, res, next) => {
        const start = Date.now();

        res.on('finish', () => {
            const responseTime = Date.now() - start;
            logger.http(`${req.method} ${req.originalUrl}`, {
                statusCode: res.statusCode,
                responseTime: `${responseTime}ms`,
                ip: req.ip,
                userAgent: req.get('User-Agent')
            });
        });

        next();
    });

    app.get('/health', async (req, res) => {
        const dbHealthy = await checkDatabaseConnection();
        const redisHealthy = await checkRedisConnection();
        const allHealthy = dbHealthy && redisHealthy;
        
        res.status(allHealthy ? 200 : 503).json({
            success: allHealthy,
            message: allHealthy 
                ? 'Server is healthy' 
                : `Server is unhealthy - ${!dbHealthy ? 'database' : ''}${!dbHealthy && !redisHealthy ? ' and ' : ''}${!redisHealthy ? 'redis' : ''} connection failed`,
            timestamp: new Date().toISOString(),
            uptime: process.uptime(),
            database: dbHealthy ? 'connected' : 'disconnected',
            redis: redisHealthy ? 'connected' : 'disconnected'
        });
    });

    app.use('/api/upload', uploadRouter);
    app.use('/api/auth', authRouter);
    app.use('/api/progress', progressRouter);
    app.use('/api/art', artRouter);
    app.use('/api/notifications', notificationRouter);

    app.use(notFoundHandler);
    app.use(globalErrorHandler);

    const PORT = Number(process.env.PORT) || 4000;

    app.listen(PORT, () => {
        logger.info(`Server running on port ${PORT}`, {
            environment: process.env.NODE_ENV || 'development',
            port: PORT
        });
    });
}

startServer().catch((error) => {
    logger.error('Failed to start server', { error: error.message });
    process.exit(1);
});