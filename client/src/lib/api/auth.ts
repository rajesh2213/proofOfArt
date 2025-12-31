const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000';

export interface LoginResponse {
  message: string;
  user: {
    id: string;
    username: string;
    email: string;
    googleId?: string | null;
    createdAt: string;
    updatedAt: string;
  };
  accessToken: string;
}

export interface RegisterResponse {
  message: string;
}

export interface VerifyResponse {
  message: string;
}

export interface RefreshTokenResponse {
  message: string;
  user: {
    id: string;
    username: string;
    email: string;
    googleId?: string | null;
    createdAt: string;
    updatedAt: string;
  };
  accessToken: string;
}

class AuthError extends Error {
  constructor(message: string, public field?: string) {
    super(message);
    this.name = 'AuthError';
  }
}

const handleResponse = async <T>(response: Response): Promise<T> => {
  const data = await response.json();
  
  if (!response.ok) {
    const errorMessage = data.message || data.error || 'An error occurred';
    const field = data.field || undefined;
    throw new AuthError(errorMessage, field);
  }
  
  return data;
};

export const login = async (email: string, password: string): Promise<LoginResponse> => {
  const response = await fetch(`${API_URL}/api/auth/login`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    credentials: 'include',
    body: JSON.stringify({ email, password }),
  });

  return handleResponse<LoginResponse>(response);
};

export const register = async (
  username: string,
  email: string,
  password: string,
  confirmPassword: string
): Promise<RegisterResponse> => {
  const response = await fetch(`${API_URL}/api/auth/register`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    credentials: 'include',
    body: JSON.stringify({ username, email, password, confirmPassword }),
  });

  return handleResponse<RegisterResponse>(response);
};

export const logout = async (): Promise<{ message: string }> => {
  const token = localStorage.getItem('accessToken');
  const response = await fetch(`${API_URL}/api/auth/logout`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token && { Authorization: `Bearer ${token}` }),
    },
    credentials: 'include',
  });

  localStorage.removeItem('accessToken');
  
  return handleResponse<{ message: string }>(response);
};

export const verifyEmail = async (token: string): Promise<VerifyResponse> => {
  const response = await fetch(`${API_URL}/api/auth/verify?token=${encodeURIComponent(token)}`, {
    method: 'GET',
    headers: {
      'Content-Type': 'application/json',
    },
    credentials: 'include',
  });

  return handleResponse<VerifyResponse>(response);
};

export const resendVerificationEmail = async (email: string): Promise<{ message: string }> => {
  const response = await fetch(`${API_URL}/api/auth/resend-verification-email`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    credentials: 'include',
    body: JSON.stringify({ email }),
  });

  return handleResponse<{ message: string }>(response);
};

export const refreshToken = async (): Promise<RefreshTokenResponse> => {
  const response = await fetch(`${API_URL}/api/auth/refresh-token`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    credentials: 'include',
  });

  return handleResponse<RefreshTokenResponse>(response);
};

export interface CompleteGoogleSignupResponse {
  message: string;
  user: {
    id: string;
    username: string;
    email: string;
    googleId?: string | null;
    createdAt: string;
    updatedAt: string;
  };
  accessToken: string;
}

export const completeGoogleSignup = async (
  googleId: string,
  email: string,
  username: string,
  password: string
): Promise<CompleteGoogleSignupResponse> => {
  const response = await fetch(`${API_URL}/api/auth/google/complete`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    credentials: 'include',
    body: JSON.stringify({ googleId, email, username, password }),
  });

  return handleResponse<CompleteGoogleSignupResponse>(response);
};

