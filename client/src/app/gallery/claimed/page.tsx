'use client';

import React, { useEffect, useState } from 'react';
import { getMyClaimedArtworks, Artwork } from '../../../lib/api/art';
import ArtworkCard from '../../../components/Gallery/ArtworkCard';
import Link from 'next/link';
import { useAuth } from '../../../contexts/AuthContext';
import { useRouter } from 'next/navigation';

export default function ClaimedArtworksPage() {
    const [artworks, setArtworks] = useState<Artwork[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const { isAuthenticated, isLoading: authLoading } = useAuth();
    const router = useRouter();

    useEffect(() => {
        if (!authLoading) {
            if (!isAuthenticated) {
                router.push('/login');
                return;
            }
            loadArtworks();
        }
    }, [isAuthenticated, authLoading, router]);

    const loadArtworks = async () => {
        try {
            setLoading(true);
            setError(null);
            const response = await getMyClaimedArtworks();
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
            <div className="flex items-center justify-center min-h-screen">
                <div className="text-lg">Loading your claimed artworks...</div>
            </div>
        );
    }

    if (error) {
        return (
            <div className="flex items-center justify-center min-h-screen">
                <div className="text-red-500">Error: {error}</div>
            </div>
        );
    }

    return (
        <div className="container mx-auto px-4 py-8">
            <h1 className="text-3xl font-bold mb-6">Claimed Artworks</h1>
            
            {artworks.length === 0 ? (
                <div className="text-center py-12">
                    <p className="text-gray-500 text-lg">You haven't claimed any artworks yet.</p>
                    <p className="text-gray-400 text-sm mt-2">Browse artworks and submit ownership claims to add them here.</p>
                </div>
            ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
                    {artworks.map((artwork) => (
                        <ArtworkCard key={artwork.id} artwork={artwork} />
                    ))}
                </div>
            )}
        </div>
    );
}

