export class AppError extends Error {
    public readonly statusCode: number;
    public readonly isOperational: boolean;
    public readonly timestamp: string;

    constructor(message: string, statusCode: number = 500, isOperational: boolean = true) {
        super(message);
        this.statusCode = statusCode;
        this.isOperational = isOperational;
        this.timestamp = new Date().toISOString();

        Error.captureStackTrace(this, this.constructor);
    }
}

export class ValidationError extends AppError {
    public readonly field?: string;

    constructor(message: string, field?: string) {
        super(message, 400);
        this.field = field;
    }
}

export class DatabaseError extends AppError {
    public readonly operation?: string;

    constructor(message: string = 'Database error', operation: string = 'Unknown operation') {
        super(message, 500);
        this.operation = operation
    }
}

export class NotFoundError extends AppError {
    constructor(resource: string = 'Resource') {
        super(`${resource} not found`, 404);
    }
}

export class ProgressError extends AppError {
    constructor(message: string = 'Progress error') {
        super(message, 500);
    }
}

export class ExternalServiceError extends AppError {
    public readonly service: string;

    constructor(service: string, message: string = 'External service error') {
        super(message, 502);
        this.service = service;
    }
}
