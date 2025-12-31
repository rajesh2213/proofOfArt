'use client';

import React, { useState, useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useAuth } from '../../contexts/AuthContext';
import { Palette, CheckCircle, XCircle } from 'lucide-react';
import PageTransitionWrapper from '../../components/DrawingLoader/PageTransitionWrapper';

function VerifyPageContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { verifyEmail } = useAuth();
  const [status, setStatus] = useState<'loading' | 'success' | 'error'>('loading');
  const [message, setMessage] = useState('');

  useEffect(() => {
    const token = searchParams.get('token');
    if (!token) {
      setStatus('error');
      setMessage('Verification token is missing.');
      return;
    }

    const verify = async () => {
      try {
        await verifyEmail(token);
        setStatus('success');
        setMessage('Your email has been verified successfully! You can now log in.');
      } catch (err: any) {
        setStatus('error');
        setMessage(err.message || 'Verification failed. The token may be invalid or expired.');
      }
    };

    verify();
  }, [searchParams, verifyEmail]);

  return (
    <div className="min-h-screen flex items-center justify-center p-4" style={{ backgroundColor: '#fce3e7' }}>
      <div 
        className="w-full max-w-md bg-white border-2 border-black rounded-lg p-8 shadow-lg text-center"
        style={{
          fontFamily: 'var(--font-melt-paint)',
          boxShadow: '0 4px 8px rgba(0, 0, 0, 0.3), 0 2px 4px rgba(0, 0, 0, 0.2), inset 0 1px 0 rgba(255, 255, 255, 0.1)'
        }}
      >
        {status === 'loading' && (
          <>
            <div className="flex items-center justify-center mb-6">
              <Palette className="h-12 w-12 text-black animate-pulse" />
            </div>
            <h1 className="text-3xl font-bold mb-4 text-gray-900">Verifying...</h1>
            <p className="text-gray-600" style={{ fontFamily: 'var(--font-inter)' }}>
              Please wait while we verify your email.
            </p>
          </>
        )}

        {status === 'success' && (
          <>
            <div className="flex items-center justify-center mb-6">
              <CheckCircle className="h-12 w-12 text-green-600" />
            </div>
            <h1 className="text-3xl font-bold mb-4 text-gray-900">Verified!</h1>
            <p className="text-gray-600 mb-6" style={{ fontFamily: 'var(--font-inter)' }}>
              {message}
            </p>
            <button
              onClick={() => router.push('/login')}
              className="px-6 py-2 bg-black text-white rounded font-semibold hover:bg-gray-800 transition-colors"
            >
              Go to Login
            </button>
          </>
        )}

        {status === 'error' && (
          <>
            <div className="flex items-center justify-center mb-6">
              <XCircle className="h-12 w-12 text-red-600" />
            </div>
            <h1 className="text-3xl font-bold mb-4 text-gray-900">Verification Failed</h1>
            <p className="text-gray-600 mb-6" style={{ fontFamily: 'var(--font-inter)' }}>
              {message}
            </p>
            <div className="space-y-2">
              <button
                onClick={() => router.push('/login')}
                className="w-full px-6 py-2 bg-black text-white rounded font-semibold hover:bg-gray-800 transition-colors"
              >
                Go to Login
              </button>
              <button
                onClick={() => router.push('/register')}
                className="w-full px-6 py-2 bg-white border-2 border-black text-black rounded font-semibold hover:bg-gray-100 transition-colors"
              >
                Register Again
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

export default function VerifyPage() {
  return (
    <PageTransitionWrapper>
      <VerifyPageContent />
    </PageTransitionWrapper>
  );
}

