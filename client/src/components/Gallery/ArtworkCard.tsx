'use client';

import React from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { Artwork } from '../../lib/api/art';

interface ArtworkCardProps {
    artwork: Artwork;
}

export default function ArtworkCard({ artwork }: ArtworkCardProps) {
    const isAiGenerated = artwork.image.detectionReport?.detectedLabel === 'AI_GENERATED';
    const hasTamper = (artwork.image.editDetections?.length || 0) > 0;
    const hasClaims = (artwork.claims?.length || 0) > 0;
    const pendingClaims = artwork.claims?.filter(c => c.status === 'PENDING').length || 0;
    const isVirtual = artwork.id.startsWith('virtual-');
    
    const artworkLink = isVirtual ? `/artwork/image/${artwork.imageId}` : `/artwork/${artwork.id}`;

    return (
        <Link href={artworkLink}>
            <div className="bg-white rounded-lg shadow-md overflow-hidden hover:shadow-lg transition-shadow cursor-pointer">
                <div className="relative aspect-square">
                    <Image
                        src={artwork.image.url}
                        alt={artwork.image.filename || 'Artwork'}
                        fill
                        className="object-cover"
                    />
                    <div className="absolute top-2 right-2 flex gap-2">
                        {!isAiGenerated && (
                            <span className="bg-green-500 text-white text-xs px-2 py-1 rounded">
                                Real
                            </span>
                        )}
                        {isAiGenerated && (
                            <span className="bg-orange-500 text-white text-xs px-2 py-1 rounded">
                                AI
                            </span>
                        )}
                        {hasTamper && (
                            <span className="bg-red-500 text-white text-xs px-2 py-1 rounded">
                                Edited
                            </span>
                        )}
                    </div>
                </div>
                <div className="p-4">
                    <h3 className="font-semibold text-lg mb-2 truncate">
                        {artwork.image.filename || 'Untitled'}
                    </h3>
                    <div className="flex items-center justify-between text-sm text-gray-600">
                        <span>Owner: {artwork.currentOwner.username}</span>
                        {hasClaims && (
                            <span className="text-orange-500">
                                {pendingClaims} pending claim{pendingClaims !== 1 ? 's' : ''}
                            </span>
                        )}
                    </div>
                </div>
            </div>
        </Link>
    );
}

