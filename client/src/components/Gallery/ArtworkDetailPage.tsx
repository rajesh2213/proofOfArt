'use client';

import React, { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import Image from 'next/image';
import { getArtworkById, verifyArtworkProof, Artwork, ProofVerification } from '../../lib/api/art';
import { useAuth } from '../../contexts/AuthContext';
import ClaimButton from '../Claims/ClaimButton';
import ClaimModal from '../Claims/ClaimModal';
import ScannerOverlay from '../ScannerOverlay';
import MaskOverlay from './MaskOverlay';
import { useJobStatus } from '../../hooks/useJobStatus';

export default function ArtworkDetailPage() {
    const params = useParams();
    const artworkId = params?.id as string;
    const { user } = useAuth();
    
    const [artwork, setArtwork] = useState<Artwork | null>(null);
    const [proofVerification, setProofVerification] = useState<ProofVerification | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [showClaimModal, setShowClaimModal] = useState(false);
    
    const { status: jobStatus, progress: jobProgress, isPolling } = useJobStatus({
        imageId: artwork?.imageId || null,
        enabled: !!artwork && !artwork.image.detectionReport,
        onComplete: (data) => {
            if (artworkId) {
                loadArtwork();
            }
        },
    });

    useEffect(() => {
        if (artworkId) {
            loadArtwork();
        }
    }, [artworkId]);

    const loadArtwork = async () => {
        try {
            setLoading(true);
            const response = await getArtworkById(artworkId);
            if (response.success) {
                setArtwork(response.data.artwork);
                const verifyResponse = await verifyArtworkProof(artworkId);
                if (verifyResponse.success) {
                    setProofVerification(verifyResponse.data.verification);
                }
            }
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Failed to load artwork');
        } finally {
            setLoading(false);
        }
    };

    const isOwner = user && artwork && artwork.currentOwnerId === user.id;
    const canClaim = user && artwork && artwork.currentOwnerId !== user.id;

    if (loading) {
        return (
            <div className="flex items-center justify-center min-h-screen">
                <div className="text-lg">Loading artwork...</div>
            </div>
        );
    }

    if (error || !artwork) {
        return (
            <div className="flex items-center justify-center min-h-screen">
                <div className="text-red-500">Error: {error || 'Artwork not found'}</div>
            </div>
        );
    }

    const isAiGenerated = artwork.image.detectionReport?.detectedLabel === 'AI_GENERATED';
    const hasTamper = (artwork.image.editDetections?.length || 0) > 0;
    const maskUrl = artwork.image.editDetections?.[0]?.maskUrl;

    return (
        <div className="container mx-auto px-4 py-8">
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
                <div className="relative">
                    <div className="relative aspect-square bg-gray-100 rounded-lg overflow-hidden">
                        <Image
                            src={artwork.image.url}
                            alt={artwork.image.filename || 'Artwork'}
                            fill
                            className="object-contain"
                        />
                        <ScannerOverlay
                            active={isPolling && (jobStatus === 'pending' || jobStatus === 'processing')}
                            progress={jobProgress}
                        />
                    </div>
                    {maskUrl && (
                        <div className="mt-4">
                            <MaskOverlay
                                maskUrl={maskUrl}
                                imageUrl={artwork.image.url}
                            />
                        </div>
                    )}
                </div>

                <div>
                    <h1 className="text-3xl font-bold mb-4">
                        {artwork.image.filename || 'Untitled Artwork'}
                    </h1>

                    <div className="flex gap-2 mb-4">
                        {proofVerification?.isValid && (
                            <span className="bg-green-500 text-white px-3 py-1 rounded-full text-sm">
                                ✓ Verified Authentic
                            </span>
                        )}
                        {!isAiGenerated && (
                            <span className="bg-green-500 text-white px-3 py-1 rounded-full text-sm">
                                Real Artwork
                            </span>
                        )}
                        {isAiGenerated && (
                            <span className="bg-orange-500 text-white px-3 py-1 rounded-full text-sm">
                                AI Generated
                            </span>
                        )}
                        {hasTamper && (
                            <span className="bg-red-500 text-white px-3 py-1 rounded-full text-sm">
                                Tamper Detected
                            </span>
                        )}
                        {proofVerification?.wasEdited && (
                            <span className="bg-yellow-500 text-white px-3 py-1 rounded-full text-sm">
                                Image Modified
                            </span>
                        )}
                    </div>

                    <div className="bg-gray-50 p-4 rounded-lg mb-4">
                        <h3 className="font-semibold mb-2">Ownership</h3>
                        <p className="text-sm text-gray-600">
                            Current Owner: <span className="font-medium">{artwork.currentOwner.username}</span>
                        </p>
                        <p className="text-sm text-gray-600">
                            Original Uploader: <span className="font-medium">{artwork.originalUploader.username}</span>
                        </p>
                        {isOwner && (
                            <p className="text-green-600 text-sm mt-2">✓ You own this artwork</p>
                        )}
                    </div>

                    {artwork.image.detectionReport && (
                        <div className="bg-gray-50 p-4 rounded-lg mb-4">
                            <h3 className="font-semibold mb-2">AI Detection</h3>
                            <p className="text-sm">
                                Confidence: {(artwork.image.detectionReport.aiProbability * 100).toFixed(1)}%
                            </p>
                            <p className="text-sm">
                                Label: {artwork.image.detectionReport.detectedLabel}
                            </p>
                        </div>
                    )}

                    {artwork.claims && artwork.claims.length > 0 && (
                        <div className="bg-gray-50 p-4 rounded-lg mb-4">
                            <h3 className="font-semibold mb-2">Claims</h3>
                            <div className="space-y-2">
                                {artwork.claims.map((claim) => (
                                    <div key={claim.id} className="text-sm">
                                        <span className="font-medium">Status: </span>
                                        <span className={`${
                                            claim.status === 'APPROVED' ? 'text-green-600' :
                                            claim.status === 'REJECTED' ? 'text-red-600' :
                                            'text-orange-600'
                                        }`}>
                                            {claim.status}
                                        </span>
                                        {claim.reason && (
                                            <p className="text-gray-600 mt-1">{claim.reason}</p>
                                        )}
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}

                    {canClaim && (
                        <div className="mt-4">
                            <ClaimButton
                                artworkId={artwork.id}
                                onClaimClick={() => setShowClaimModal(true)}
                            />
                        </div>
                    )}

                    {proofVerification && (
                        <div className="bg-gray-50 p-4 rounded-lg mt-4">
                            <h3 className="font-semibold mb-2">Proof Verification</h3>
                            <div className="text-sm space-y-1">
                                <p>
                                    Valid: <span className={proofVerification.isValid ? 'text-green-600' : 'text-red-600'}>
                                        {proofVerification.isValid ? 'Yes' : 'No'}
                                    </span>
                                </p>
                                <p>
                                    Was Edited: <span className={proofVerification.wasEdited ? 'text-red-600' : 'text-green-600'}>
                                        {proofVerification.wasEdited ? 'Yes' : 'No'}
                                    </span>
                                </p>
                                {proofVerification.originalMetadata && (
                                    <div className="mt-2">
                                        <p className="font-medium">Original Metadata:</p>
                                        <pre className="text-xs bg-white p-2 rounded mt-1 overflow-auto">
                                            {JSON.stringify(proofVerification.originalMetadata, null, 2)}
                                        </pre>
                                    </div>
                                )}
                            </div>
                        </div>
                    )}
                </div>
            </div>

            {showClaimModal && (
                <ClaimModal
                    artworkId={artwork.id}
                    artworkTitle={artwork.image.filename || 'Untitled'}
                    onClose={() => {
                        setShowClaimModal(false);
                        loadArtwork();
                    }}
                />
            )}
        </div>
    );
}

