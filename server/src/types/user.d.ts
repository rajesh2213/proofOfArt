export type UserModel = {
    id: string;
    username: string;
    email: string;
    passwordHash: string;
    role: Role;
    verified: boolean;
    verificationToken: string | null;
    verificationTokenExpiresAt: Date | null;
}

export type UserCreateInput = {
    username: string;
    email: string;
    passwordHash: string;
    verified: boolean;
    verificationToken: string | null;
    verificationTokenExpiresAt: Date | null;
}

export type UserUpdateInput ={
    verified?: boolean;
    verificationToken: string | null;
    verificationTokenExpiresAt: Date | null;
}
