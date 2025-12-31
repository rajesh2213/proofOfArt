'use client';

import React, { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';

interface ScannerOverlayProps {
    active: boolean;
    progress?: number;
    className?: string;
}

export default function ScannerOverlay({ active, progress = 0, className = '' }: ScannerOverlayProps) {
    const [reducedMotion, setReducedMotion] = useState(false);

    useEffect(() => {
        if (typeof window !== 'undefined') {
            const mediaQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
            setReducedMotion(mediaQuery.matches);

            const handleChange = (e: MediaQueryListEvent) => {
                setReducedMotion(e.matches);
            };

            mediaQuery.addEventListener('change', handleChange);
            return () => mediaQuery.removeEventListener('change', handleChange);
        }
    }, []);

    if (!active) return null;

    const scannerAnimate = reducedMotion
        ? {
              opacity: [0.3, 0.5, 0.3],
          }
        : {
              y: ['0%', '100%', '0%'],
              opacity: [0.3, 0.8, 0.3],
          };

    const pulseAnimate = reducedMotion
        ? {
              opacity: [0.5, 0.8, 0.5],
          }
        : {
              scale: [1, 1.2, 1],
              opacity: [0.5, 1, 0.5],
          };

    return (
        <AnimatePresence>
            {active && (
                <motion.div
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    className={`absolute inset-0 z-10 pointer-events-none ${className}`}
                    style={{
                        background: 'linear-gradient(to bottom, transparent 0%, rgba(59, 130, 246, 0.1) 50%, transparent 100%)',
                    }}
                >
                    {!reducedMotion && (
                        <motion.div
                            className="absolute left-0 right-0 h-1 bg-blue-500/60 shadow-lg"
                            style={{
                                boxShadow: '0 0 20px rgba(59, 130, 246, 0.8), 0 0 40px rgba(59, 130, 246, 0.4)',
                            }}
                            animate={scannerAnimate}
                            transition={{
                                duration: 2,
                                repeat: Infinity,
                                ease: 'easeInOut',
                            }}
                        />
                    )}

                    <motion.div
                        className="absolute inset-0"
                        style={{
                            background: 'linear-gradient(90deg, transparent 0%, rgba(255, 255, 255, 0.1) 50%, transparent 100%)',
                            backgroundSize: '200% 100%',
                        }}
                        animate={
                            reducedMotion
                                ? {}
                                : {
                                      backgroundPosition: ['0% 0%', '200% 0%'],
                                  }
                        }
                        transition={{
                            duration: 3,
                            repeat: Infinity,
                            ease: 'linear',
                        }}
                    />

                    <div className="absolute top-4 left-4 flex items-center gap-2">
                        <motion.div
                            className="w-3 h-3 rounded-full bg-blue-500"
                            animate={pulseAnimate}
                            transition={{
                                duration: 1.5,
                                repeat: Infinity,
                                ease: 'easeInOut',
                            }}
                            style={{
                                boxShadow: '0 0 10px rgba(59, 130, 246, 0.8)',
                            }}
                        />
                        <span className="text-xs text-white font-medium drop-shadow-md">
                            Scanning...
                        </span>
                    </div>

                    {progress > 0 && (
                        <div className="absolute bottom-4 left-1/2 transform -translate-x-1/2">
                            <div className="bg-black/50 backdrop-blur-sm rounded-full px-4 py-2">
                                <span className="text-xs text-white font-medium">
                                    {Math.round(progress)}%
                                </span>
                            </div>
                        </div>
                    )}
                </motion.div>
            )}
        </AnimatePresence>
    );
}

