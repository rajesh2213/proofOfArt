'use client';

import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import * as authApi from '../lib/api/auth';

export interface User {
  id: string;
  username: string;
  email: string;
  googleId?: string | null;
  createdAt: string;
  updatedAt: string;
}

type AuthContextType = {
  user: User | null;
  isLoading: boolean;
  isAuthenticated: boolean;
  login: (email: string, password: string) => Promise<void>;
  register: (username: string, email: string, password: string, confirmPassword: string) => Promise<void>;
  logout: () => Promise<void>;
  verifyEmail: (token: string) => Promise<void>;
  resendVerificationEmail: (email: string) => Promise<void>;
  loginWithGoogle: () => void;
  refreshAuth: () => Promise<void>;
  setUserFromToken: (token: string, userData: User) => void;
};

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider = ({ children }: { children: React.ReactNode }) => {
  const [user, setUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const router = useRouter();

  useEffect(() => {
    const checkAuth = async () => {
      try {
        const token = localStorage.getItem('accessToken');
        if (token) {
          await refreshAuth();
        }
      } catch (error) {
        localStorage.removeItem('accessToken');
        setUser(null);
      } finally {
        setIsLoading(false);
      }
    };
    checkAuth();
  }, []);

  const refreshAuth = useCallback(async () => {
    try {
      const response = await authApi.refreshToken();
      if (response.accessToken) {
        localStorage.setItem('accessToken', response.accessToken);
        setUser(response.user);
      }
    } catch (error) {
      localStorage.removeItem('accessToken');
      setUser(null);
      throw error;
    }
  }, []);

  const login = useCallback(async (email: string, password: string) => {
    try {
      const response = await authApi.login(email, password);
      if (response.accessToken) {
        localStorage.setItem('accessToken', response.accessToken);
        setUser(response.user);
      }
    } catch (error) {
      throw error;
    }
  }, []);

  const register = useCallback(async (username: string, email: string, password: string, confirmPassword: string) => {
    try {
      await authApi.register(username, email, password, confirmPassword);
    } catch (error) {
      throw error;
    }
  }, []);

  const logout = useCallback(async () => {
    try {
      await authApi.logout();
      localStorage.removeItem('accessToken');
      setUser(null);
      router.push('/');
    } catch (error) {
      localStorage.removeItem('accessToken');
      setUser(null);
      router.push('/');
    }
  }, [router]);

  const verifyEmail = useCallback(async (token: string) => {
    try {
      await authApi.verifyEmail(token);
    } catch (error) {
      throw error;
    }
  }, []);

  const resendVerificationEmail = useCallback(async (email: string) => {
    try {
      await authApi.resendVerificationEmail(email);
    } catch (error) {
      throw error;
    }
  }, []);

  const loginWithGoogle = useCallback(() => {
    const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000';
    window.location.href = `${apiUrl}/api/auth/google`;
  }, []);

  const setUserFromToken = useCallback((token: string, userData: User) => {
    localStorage.setItem('accessToken', token);
    setUser(userData);
  }, []);

  return (
    <AuthContext.Provider
      value={{
        user,
        isLoading,
        isAuthenticated: !!user,
        login,
        register,
        logout,
        verifyEmail,
        resendVerificationEmail,
        loginWithGoogle,
        refreshAuth,
        setUserFromToken,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};

