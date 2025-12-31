import winston from 'winston';
import path from 'path';
import 'winston-daily-rotate-file';

const levels = {
    error: 0,
    warn: 1,
    info: 2,
    http: 3,
    debug: 4,
};

const colors = {
    error: 'red',
    warn: 'yellow',
    info: 'green',
    http: 'magenta',
    debug: 'white',
};

winston.addColors(colors);

const transports = [
    new winston.transports.Console({
        format: winston.format.combine(
            winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss:ms' }),
            winston.format.colorize({ all: true }),
            winston.format.printf(
                (info: any) => `${info.timestamp} ${info.level}: ${info.message}`
            )
        ),
    }),
    new winston.transports.DailyRotateFile({
        filename: path.join(process.cwd(), 'logs', 'error-%DATE%.log'),
        datePattern: 'YYYY-MM-DD',
        level: 'error',
        maxSize: '20m',
        maxFiles: '14d',
        format: winston.format.combine(
            winston.format.timestamp(),
            winston.format.errors({ stack: true }),
            winston.format.json()
        ),
    }),
    new winston.transports.DailyRotateFile({
        filename: path.join(process.cwd(), 'logs', 'combined-%DATE%.log'),
        datePattern: 'YYYY-MM-DD',
        maxSize: '20m',
        maxFiles: '10d',
        format: winston.format.combine(
            winston.format.timestamp(),
            winston.format.errors({ stack: true }),
            winston.format.json()
        ),
    }),
];

const logger = winston.createLogger({
    level: process.env.NODE_ENV === 'development' ? 'debug' : 'warn',
    levels,
    transports,
    exceptionHandlers: [
        new winston.transports.DailyRotateFile({ 
            filename: path.join(process.cwd(), 'logs', 'exceptions-%DATE%.log'),
            datePattern: 'YYYY-MM-DD',
            maxSize: '20m',
            maxFiles: '10d'
        })
    ]
});

export default logger;
