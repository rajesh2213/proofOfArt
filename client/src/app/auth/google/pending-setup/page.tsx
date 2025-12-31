'use client';

import React, { useState, useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useAuth } from '../../../../contexts/AuthContext';
import { Palette } from 'lucide-react';
import Image from 'next/image';
import { completeGoogleSignup } from '../../../../lib/api/auth';

export default function GooglePendingSetupPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { setUserFromToken } = useAuth();
  
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  
  const googleId = searchParams.get('googleId');
          const email = searchParams.get('email');

          useEffect(() => {
            if (!googleId || !email) {
      router.push('/login?error=google_setup_failed');
    }
  }, [googleId, email, router]);

  const handleSubmit = async (e: React.FormEvent) => {
            e.preventDefault();
            setError('');

            if (!username.trim()) {
      setError('Username is required');
      return;
    }

    if (password.length < 8) {
      setError('Password must be at least 8 characters long');
      return;
    }

    if (password !== confirmPassword) {
      setError('Passwords do not match');
      return;
    }

    if (!googleId || !email) {
      setError('Missing authentication information. Please try again.');
      router.push('/login?error=google_setup_failed');
      return;
    }

    setIsLoading(true);

            try {
              const response = await completeGoogleSignup(googleId, email, username.trim(), password);
              
              if (response.accessToken && response.user) {
        setUserFromToken(response.accessToken, response.user);
        router.push('/');
      } else {
        throw new Error('Invalid response from server');
      }
    } catch (err: any) {
      setError(err.message || 'Failed to complete signup. Please try again.');
    } finally {
      setIsLoading(false);
    }
  };

  if (!googleId || !email) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ backgroundColor: '#fce3e7' }}>
        <div className="text-center">
          <p style={{ fontFamily: 'var(--font-melt-paint)' }} className="text-2xl text-gray-900">
            Loading...
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="relative" style={{ width: '100%', height: '100%', position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }}>
      <Image
        src="/images/8522422.jpg"
        alt="Auth Background"
        fill
        priority
        style={{
          objectFit: 'cover',
          objectPosition: 'center',
          zIndex: 0,
        }}
      />
      <div 
        className="absolute inset-0 z-[1]"
        style={{
          background: 'radial-gradient(ellipse at center, rgba(0, 0, 0, 0.1) 0%, rgba(0, 0, 0, 0.2) 50%, rgba(0, 0, 0, 0.7) 100%)',
        }}
      />
      <div className="relative z-10 flex items-center justify-center p-4" style={{ width: '100%', height: '100%', position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }}>
        <div
          className="w-full max-w-2xl rounded-2xl shadow-2xl overflow-hidden flex flex-row"
          style={{
            background: "rgba(255, 255, 255, 0.08)",
            backdropFilter: "blur(24px)",
            border: "0.5px solid rgba(0, 0, 0, 0.9)",
            boxShadow: `
            0 8px 32px rgba(0, 0, 0, 0.9),
            0 0 0 1px rgba(0, 0, 0, 0.8),
            inset 0 1px 1px rgba(255, 255, 255, 0.9),
            inset 0 -1px 1px rgba(0, 0, 0, 0.8),
            inset 0 0 0 1px rgba(0, 0, 0, 0.3)
          `,
            WebkitBackdropFilter: "blur(24px) saturate(200%)",
            fontFamily: "var(--font-mono), 'Courier New', Courier, monospace",
          }}
        >
          <div className="w-1/3 px-6 pt-6 pb-4 text-center border-r border-black/30 flex flex-col justify-center">
            <div className="flex items-center justify-center mb-3">
              <Palette className="h-10 w-10 text-white" style={{ filter: 'drop-shadow(0 2px 4px rgba(0, 0, 0, 0.7))' }} />
            </div>
            <h1
              className="text-xl md:text-2xl font-bold text-center mb-2 text-white leading-relaxed drop-shadow-md"
              style={{
                letterSpacing: '0.05em',
                textShadow: '0 2px 4px rgba(0, 0, 0, 0.7), 0 0 8px rgba(255, 255, 255, 0.3), 0 1px 2px rgba(0, 0, 0, 0.9)',
                fontFamily: "var(--font-mono), 'Courier New', Courier, monospace",
              }}
            >
              Complete Signup
            </h1>
            <p className="text-sm text-white/80 mt-2" style={{ fontFamily: "var(--font-mono), 'Courier New', Courier, monospace" }}>
              Finish setting up your account
            </p>
          </div>

          <div className="w-2/3 px-8 py-8">
            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label htmlFor="email" className="block text-sm font-medium text-white/90 mb-2" style={{ fontFamily: "var(--font-mono), 'Courier New', Courier, monospace" }}>
                  Email
                </label>
                <input
                  type="email"
                  id="email"
                  value={email}
                  disabled
                  className="w-full px-4 py-2 bg-white/10 border border-white/20 rounded-lg text-white placeholder-white/50 focus:outline-none focus:ring-2 focus:ring-white/50 disabled:opacity-60 disabled:cursor-not-allowed"
                  style={{ fontFamily: "var(--font-mono), 'Courier New', Courier, monospace" }}
                />
                <p className="text-xs text-white/60 mt-1" style={{ fontFamily: "var(--font-mono), 'Courier New', Courier, monospace" }}>
                  Connected via Google
                </p>
              </div>

              <div>
                <label htmlFor="username" className="block text-sm font-medium text-white/90 mb-2" style={{ fontFamily: "var(--font-mono), 'Courier New', Courier, monospace" }}>
                  Username *
                </label>
                <input
                  type="text"
                  id="username"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  required
                  className="w-full px-4 py-2 bg-white/10 border border-white/20 rounded-lg text-white placeholder-white/50 focus:outline-none focus:ring-2 focus:ring-white/50"
                  placeholder="Choose a username"
                  style={{ fontFamily: "var(--font-mono), 'Courier New', Courier, monospace" }}
                />
              </div>

              <div>
                <label htmlFor="password" className="block text-sm font-medium text-white/90 mb-2" style={{ fontFamily: "var(--font-mono), 'Courier New', Courier, monospace" }}>
                  Password *
                </label>
                <input
                  type="password"
                  id="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  minLength={8}
                  className="w-full px-4 py-2 bg-white/10 border border-white/20 rounded-lg text-white placeholder-white/50 focus:outline-none focus:ring-2 focus:ring-white/50"
                  placeholder="At least 8 characters"
                  style={{ fontFamily: "var(--font-mono), 'Courier New', Courier, monospace" }}
                />
              </div>

              <div>
                <label htmlFor="confirmPassword" className="block text-sm font-medium text-white/90 mb-2" style={{ fontFamily: "var(--font-mono), 'Courier New', Courier, monospace" }}>
                  Confirm Password *
                </label>
                <input
                  type="password"
                  id="confirmPassword"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  required
                  minLength={8}
                  className="w-full px-4 py-2 bg-white/10 border border-white/20 rounded-lg text-white placeholder-white/50 focus:outline-none focus:ring-2 focus:ring-white/50"
                  placeholder="Confirm your password"
                  style={{ fontFamily: "var(--font-mono), 'Courier New', Courier, monospace" }}
                />
              </div>

              {error && (
                <div className="bg-red-500/20 border border-red-500/50 rounded-lg p-3">
                  <p className="text-sm text-red-200" style={{ fontFamily: "var(--font-mono), 'Courier New', Courier, monospace" }}>
                    {error}
                  </p>
                </div>
              )}

              <button
                type="submit"
                disabled={isLoading}
                className="w-full bg-pink-500 text-white font-semibold py-3 px-6 rounded-lg border-2 border-white/30 transition-all duration-200 transform hover:scale-105 hover:bg-pink-600 shadow-lg cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed disabled:transform-none"
                style={{ 
                  boxShadow: "0 4px 12px rgba(236, 72, 153, 0.4), inset 0 1px 1px rgba(255, 255, 255, 0.3)", 
                  letterSpacing: "0.02em", 
                  fontFamily: "var(--font-mono), 'Courier New', Courier, monospace" 
                }}
              >
                {isLoading ? 'Creating Account...' : 'Complete Signup'}
              </button>
            </form>
          </div>
        </div>
      </div>
    </div>
  );
}

