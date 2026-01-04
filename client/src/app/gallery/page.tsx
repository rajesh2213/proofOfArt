'use client';

import React, { useEffect, useState } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import { useRouter } from 'next/navigation';
import { getArtworks, Artwork } from '../../lib/api/art';
import ArtCard from '../../components/Gallery/ArtCard';
import GalleryLayout from '../../components/Gallery/GalleryLayout';
import PageTransitionWrapper from '../../components/DrawingLoader/PageTransitionWrapper';
import { motion, useReducedMotion } from 'framer-motion';

type FilterType = 'all' | 'uploaded' | 'claimed';

const filterNotes: Record<FilterType, string> = {
    all: 'All artworks associated with you — uploaded or successfully claimed.',
    uploaded: 'Artworks you originally created or added to ProofOfArt. These are artworks you added to ProofOfArt, even if you indicated they were not made by you.',
    claimed: 'Artworks you now own through an approved claim.',
};

export default function GalleryPage() {
    const [artworks, setArtworks] = useState<Artwork[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [filter, setFilter] = useState<FilterType>('all');
    const { isAuthenticated, isLoading: authLoading } = useAuth();
    const router = useRouter();
    const shouldReduceMotion = useReducedMotion();

    useEffect(() => {
        if (!authLoading) {
            if (!isAuthenticated) {
                router.push('/login');
                return;
            }
            loadArtworks();
        }
    }, [isAuthenticated, authLoading, router, filter]);

    const loadArtworks = async () => {
        try {
            setLoading(true);
            setError(null);
            const response = await getArtworks(filter, 100, 0);
            if (response.success) {
                setArtworks(response.data.artworks);
            }
        } catch (err) {
            const errorMessage = err instanceof Error ? err.message : 'Failed to load artworks';
            setError(errorMessage);
            if (errorMessage.includes('log in') || errorMessage.includes('Session expired')) {
                router.push('/login');
            }
        } finally {
            setLoading(false);
        }
    };

    if (authLoading || loading) {
        return (
            <GalleryLayout>
                <div className="flex items-center justify-center min-h-[60vh]">
                    <div className="text-lg text-white" style={{
                        fontFamily: "var(--font-mono), 'Courier New', Courier, monospace",
                    }}>
                        Loading gallery...
                    </div>
                </div>
            </GalleryLayout>
        );
    }

    if (error) {
        return (
            <GalleryLayout>
                <div className="flex items-center justify-center min-h-[60vh]">
                    <div className="text-red-400">Error: {error}</div>
                </div>
            </GalleryLayout>
        );
    }

    return (
        <PageTransitionWrapper>
            <GalleryLayout>
                <div className="w-full h-full overflow-y-auto" style={{ alignSelf: 'flex-start' }}>
                    <div className="container mx-auto px-4 py-20 w-full">
                    {/* Filter Tabs */}
                    <div className="mb-8">
                        <div className="flex gap-2 p-1 rounded-lg" style={{
                            background: 'rgba(255, 255, 255, 0.1)',
                            backdropFilter: 'blur(12px)',
                            border: '0.5px solid rgba(0, 0, 0, 0.3)',
                        }}>
                            {(['all', 'uploaded', 'claimed'] as FilterType[]).map((filterType) => (
                                <motion.button
                                    key={filterType}
                                    onClick={() => setFilter(filterType)}
                                    className={`flex-1 px-6 py-3 rounded-md text-sm font-medium transition-colors ${
                                        filter === filterType
                                            ? 'text-white'
                                            : 'text-white/70 hover:text-white'
                                    }`}
                                    style={{
                                        fontFamily: "var(--font-mono), 'Courier New', Courier, monospace",
                                        background: filter === filterType
                                            ? 'rgba(59, 130, 246, 0.3)'
                                            : 'transparent',
                                    }}
                                    whileHover={shouldReduceMotion ? {} : { scale: 1.02, cursor: 'pointer' }}
                                    whileTap={shouldReduceMotion ? {} : { scale: 0.98, cursor: 'pointer' }}
                                >
                                    {filterType.charAt(0).toUpperCase() + filterType.slice(1)}
                                </motion.button>
                            ))}
                        </div>
                        
                        <motion.div
                            key={filter}
                            initial={{ opacity: 0, y: -8 }}
                            animate={{ opacity: 1, y: 0 }}
                            exit={{ opacity: 0, y: -8 }}
                            transition={{
                                duration: shouldReduceMotion ? 0 : 0.5,
                                ease: [0.4, 0, 0.2, 1],
                            }}
                            className="mt-4 px-4 py-3 rounded-lg relative overflow-hidden"
                            style={{
                                background: 'rgba(255, 255, 255, 0.05)',
                                backdropFilter: 'blur(8px)',
                                border: '0.5px solid rgba(255, 255, 255, 0.1)',
                                boxShadow: '0 2px 8px rgba(0, 0, 0, 0.1), inset 0 1px 1px rgba(255, 255, 255, 0.05)',
                            }}
                        >
                            <div
                                className="absolute inset-0 opacity-10 pointer-events-none"
                                style={{
                                    background: `
                                        radial-gradient(circle at 20% 30%, rgba(255, 182, 193, 0.3) 0%, transparent 50%),
                                        radial-gradient(circle at 80% 70%, rgba(230, 230, 250, 0.3) 0%, transparent 50%),
                                        radial-gradient(circle at 50% 50%, rgba(255, 228, 225, 0.2) 0%, transparent 60%),
                                        linear-gradient(135deg, rgba(255, 255, 255, 0.1) 0%, transparent 100%)
                                    `,
                                    mixBlendMode: 'overlay',
                                }}
                            />
                            
                            <p
                                className="text-sm text-white/85 relative z-10 italic leading-relaxed"
                                style={{
                                    fontFamily: "var(--font-inter), -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif",
                                    textShadow: '0 1px 2px rgba(0, 0, 0, 0.3)',
                                    letterSpacing: '0.01em',
                                }}
                            >
                                {filterNotes[filter]}
                            </p>
                        </motion.div>

                        <motion.div
                            initial={{ opacity: 0, y: -8 }}
                            animate={{ opacity: 1, y: 0 }}
                            transition={{
                                duration: shouldReduceMotion ? 0 : 0.5,
                                delay: 0.1,
                                ease: [0.4, 0, 0.2, 1],
                            }}
                            className="mt-3 px-4 py-2 rounded-lg relative overflow-hidden"
                            style={{
                                background: 'rgba(59, 130, 246, 0.1)',
                                backdropFilter: 'blur(8px)',
                                border: '0.5px solid rgba(59, 130, 246, 0.2)',
                            }}
                        >
                            <p
                                className="text-xs text-blue-200 relative z-10 leading-relaxed"
                                style={{
                                    fontFamily: "var(--font-inter), -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif",
                                    textShadow: '0 1px 2px rgba(0, 0, 0, 0.3)',
                                }}
                            >
                                All authenticity checks (AI detection, tamper detection, proof metadata) are performed automatically when you upload artwork. You can download original-quality images with cryptographically signed proof metadata embedded.
                            </p>
                        </motion.div>
                    </div>

                    {artworks.length === 0 ? (
                        <div className="text-center py-12 min-h-[400px] flex items-center justify-center">
                            <p className="text-white/80 text-lg mb-4" style={{
                                fontFamily: "var(--font-mono), 'Courier New', Courier, monospace",
                            }}>
                                No artworks found in this category.
                            </p>
                        </div>
                    ) : (
                        <motion.div
                            initial={{ opacity: 0 }}
                            animate={{ opacity: 1 }}
                            transition={{ duration: 0.3 }}
                            className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-6"
                            style={{ 
                                gridAutoRows: 'minmax(0, auto)',
                            }}
                        >
                            {artworks.map((artwork) => (
                                <ArtCard key={artwork.id} artwork={artwork} />
                            ))}
                        </motion.div>
                    )}
                    </div>
                </div>
            </GalleryLayout>
        </PageTransitionWrapper>
    );
}
