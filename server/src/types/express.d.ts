import { User } from '../../generated/prisma/client';

declare global {
    namespace Express {
        type Request = {
            user?: User;
        }
    }
}

export {};

