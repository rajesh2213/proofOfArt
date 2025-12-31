'use client';

import React, { useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useAuth } from '../../../../contexts/AuthContext';

export default function GoogleCallbackPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { setUserFromToken } = useAuth();

  useEffect(() => {
    const token = searchParams.get('token');
    const userParam = searchParams.get('user');

    if (token && userParam) {
      try {
        const user = JSON.parse(decodeURIComponent(userParam));
        
        setUserFromToken(token, user);
        
        router.push('/');
      } catch {
        router.push('/login?error=google_auth_failed');
      }
    } else {
      router.push('/login?error=google_auth_failed');
    }
  }, [searchParams, router, setUserFromToken]);

  return (
    <div className="min-h-screen flex items-center justify-center" style={{ backgroundColor: '#fce3e7' }}>
      <div className="text-center">
        <p style={{ fontFamily: 'var(--font-melt-paint)' }} className="text-2xl text-gray-900">
          Completing authentication...
        </p>
      </div>
    </div>
  );
}

