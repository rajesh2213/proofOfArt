'use client';

import React, { useState } from 'react';
import Image from 'next/image';
import { motion, AnimatePresence } from 'framer-motion';

interface MaskOverlayProps {
    maskUrl: string | null;
    imageUrl: string;
    className?: string;
}

export default function MaskOverlay({ maskUrl, imageUrl, className = '' }: MaskOverlayProps) {
    const [showMask, setShowMask] = useState(false);
    const [opacity, setOpacity] = useState(0.5);
    const [reducedMotion, setReducedMotion] = useState(false);

    React.useEffect(() => {
        if (typeof window !== 'undefined') {
            const mediaQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
            setReducedMotion(mediaQuery.matches);
        }
    }, []);

    if (!maskUrl) return null;

    return (
        <div className={`relative ${className}`}>
            <div className="relative aspect-square bg-gray-100 rounded-lg overflow-hidden">
                <Image
                    src={imageUrl}
                    alt="Artwork"
                    fill
                    className="object-contain"
                />
                
                <AnimatePresence>
                    {showMask && (
                        <motion.div
                            initial={{ opacity: 0 }}
                            animate={{ opacity: opacity }}
                            exit={{ opacity: 0 }}
                            transition={{ duration: reducedMotion ? 0 : 0.3 }}
                            className="absolute inset-0 pointer-events-none"
                        >
                            <Image
                                src={maskUrl}
                                alt="Edit detection mask"
                                fill
                                className="object-contain mix-blend-multiply"
                                style={{ opacity }}
                            />
                        </motion.div>
                    )}
                </AnimatePresence>
            </div>

            <div className="mt-4 space-y-3">
                <div className="flex items-center justify-between">
                    <label className="text-sm font-medium text-gray-700 flex items-center gap-2">
                        <input
                            type="checkbox"
                            checked={showMask}
                            onChange={(e) => setShowMask(e.target.checked)}
                            className="w-4 h-4 rounded border-gray-300"
                        />
                        Show Edit Detection Mask
                    </label>
                </div>

                {showMask && (
                    <motion.div
                        initial={{ opacity: 0, height: 0 }}
                        animate={{ opacity: 1, height: 'auto' }}
                        exit={{ opacity: 0, height: 0 }}
                        transition={{ duration: reducedMotion ? 0 : 0.2 }}
                    >
                        <label className="text-sm text-gray-600">
                            Opacity: {Math.round(opacity * 100)}%
                        </label>
                        <input
                            type="range"
                            min="0"
                            max="1"
                            step="0.1"
                            value={opacity}
                            onChange={(e) => setOpacity(parseFloat(e.target.value))}
                            className="w-full h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer"
                            style={{
                                background: `linear-gradient(to right, #3b82f6 0%, #3b82f6 ${opacity * 100}%, #e5e7eb ${opacity * 100}%, #e5e7eb 100%)`,
                            }}
                        />
                    </motion.div>
                )}

                <div className="text-xs text-gray-500 space-y-1">
                    <p className="font-medium">Mask Legend:</p>
                    <div className="flex items-center gap-2">
                        <div className="w-4 h-4 bg-red-500/50 rounded"></div>
                        <span>Edited regions (high confidence)</span>
                    </div>
                    <div className="flex items-center gap-2">
                        <div className="w-4 h-4 bg-yellow-500/50 rounded"></div>
                        <span>Potentially edited regions</span>
                    </div>
                </div>
            </div>
        </div>
    );
}

