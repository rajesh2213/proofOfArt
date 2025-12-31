'use client';

import React, { useState, useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useAuth } from '../../contexts/AuthContext';
import { Palette } from 'lucide-react';
import Image from 'next/image';

export default function LoginPageClient() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { login, loginWithGoogle, isAuthenticated } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    if (isAuthenticated) {
      router.push('/');
    }
  }, [isAuthenticated, router]);

  useEffect(() => {
    const errorParam = searchParams.get('error');
    if (errorParam === 'google_auth_failed') {
      setError('Google authentication failed. Please try again.');
    }
  }, [searchParams]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setIsLoading(true);

    try {
      await login(email, password);
      router.push('/');
    } catch (err: any) {
      setError(err.message || 'Login failed. Please check your credentials.');
    } finally {
      setIsLoading(false);
    }
  };

  const handleGoogleLogin = () => {
    loginWithGoogle();
  };

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
              Login
            </h1>
            <p
              className="text-center mb-4 text-sm text-white/90"
              style={{
                fontFamily: "var(--font-mono), 'Courier New', Courier, monospace",
                textShadow: '0 1px 2px rgba(0, 0, 0, 0.7)',
              }}
            >
              Welcome back to Proof of Art
            </p>
          </div>

          <div className="w-2/3 p-6 overflow-y-auto flex-1">

            {error && (
              <div className="mb-4 p-3 bg-red-500/20 border border-red-500/50 rounded text-red-200 text-sm" style={{ fontFamily: "var(--font-mono), 'Courier New', Courier, monospace" }}>
                {error}
              </div>
            )}

            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label htmlFor="email" className="block text-sm font-semibold mb-2 text-white" style={{ fontFamily: "var(--font-mono), 'Courier New', Courier, monospace" }}>
                  Email
                </label>
                <input
                  id="email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                  className="w-full px-4 py-2 bg-white/10 border border-white/20 rounded text-white placeholder-white/50 focus:outline-none focus:border-white/50 focus:bg-white/15 transition-colors"
                  style={{ fontFamily: "var(--font-mono), 'Courier New', Courier, monospace" }}
                  placeholder="your@email.com"
                />
              </div>

              <div>
                <label htmlFor="password" className="block text-sm font-semibold mb-2 text-white" style={{ fontFamily: "var(--font-mono), 'Courier New', Courier, monospace" }}>
                  Password
                </label>
                <input
                  id="password"
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  className="w-full px-4 py-2 bg-white/10 border border-white/20 rounded text-white placeholder-white/50 focus:outline-none focus:border-white/50 focus:bg-white/15 transition-colors"
                  style={{ fontFamily: "var(--font-mono), 'Courier New', Courier, monospace" }}
                  placeholder="••••••••"
                />
              </div>

              <button
                type="submit"
                disabled={isLoading}
                className="w-full py-3 bg-black/80 text-white rounded font-semibold hover:bg-black transition-colors disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
                style={{ fontFamily: "var(--font-mono), 'Courier New', Courier, monospace" }}
              >
                {isLoading ? 'Logging in...' : 'Login'}
              </button>
            </form>

            <div className="mt-6">
              <div className="relative">
                <div className="absolute inset-0 flex items-center">
                  <div className="w-full border-t border-white/20"></div>
                </div>
                <div className="relative flex justify-center text-sm">
                  <span className="px-2 bg-transparent text-white/70" style={{ fontFamily: "var(--font-mono), 'Courier New', Courier, monospace" }}>
                    OR
                  </span>
                </div>
              </div>

              <button
                onClick={handleGoogleLogin}
                className="w-full mt-4 py-3 bg-white/10 border border-white/20 rounded font-semibold text-white hover:bg-white/15 transition-colors flex items-center justify-center gap-2 cursor-pointer"
                style={{ fontFamily: "var(--font-mono), 'Courier New', Courier, monospace" }}
              >
                <svg className="w-5 h-5" viewBox="0 0 24 24">
                  <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
                  <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
                  <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" />
                  <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" />
                </svg>
                Continue with Google
              </button>
            </div>

            <p className="mt-6 text-center text-sm text-white/70" style={{ fontFamily: "var(--font-mono), 'Courier New', Courier, monospace" }}>
              Don't have an account?{' '}
              <button
                onClick={() => router.push('/register')}
                className="text-white font-semibold hover:underline cursor-pointer"
                style={{ fontFamily: "var(--font-mono), 'Courier New', Courier, monospace" }}
              >
                Register
              </button>
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}


