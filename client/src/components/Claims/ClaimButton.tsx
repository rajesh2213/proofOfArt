'use client';

import React from 'react';

interface ClaimButtonProps {
    artworkId: string;
    onClaimClick: () => void;
}

export default function ClaimButton({ artworkId, onClaimClick }: ClaimButtonProps) {
    return (
        <button
            onClick={onClaimClick}
            className="w-full px-6 py-3 bg-orange-500 text-white rounded-lg hover:bg-orange-600 transition-colors font-semibold"
        >
            Claim This Artwork
        </button>
    );
}

