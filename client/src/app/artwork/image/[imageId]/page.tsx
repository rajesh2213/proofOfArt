'use client';

import React, { useEffect, useState, useCallback } from 'react';
import { useParams } from 'next/navigation';
import Image from 'next/image';
import { getArtworkByImageId, verifyArtworkProof, Artwork, ProofVerification } from '../../../../lib/api/art';

export default function ImageDetailPage() {
    const params = useParams();
    const imageId = params?.imageId as string;
    
    const [artwork, setArtwork] = useState<Artwork | null>(null);
    const [proofVerification, setProofVerification] = useState<ProofVerification | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [showMask, setShowMask] = useState(false);
    const [showProofUI, setShowProofUI] = useState(false);
    const [proofLoading, setProofLoading] = useState(false);
    const [proofError, setProofError] = useState<string | null>(null);

    const loadArtwork = useCallback(async () => {
        try {
            setLoading(true);
            const response = await getArtworkByImageId(imageId);
            if (response.success) {
                setArtwork(response.data.artwork);
            }
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Failed to load artwork');
        } finally {
            setLoading(false);
        }
    }, [imageId]);

    useEffect(() => {
        if (imageId) {
            loadArtwork();
        }
    }, [imageId, loadArtwork]);

    const openProofUI = async () => {
        if (!artwork || artwork.id.startsWith('virtual-')) return;
        setShowProofUI(true);
        if (proofVerification || proofLoading) return;

        try {
            setProofLoading(true);
            setProofError(null);
            const verifyResponse = await verifyArtworkProof(artwork.id);
            if (verifyResponse.success) {
                setProofVerification(verifyResponse.data.verification);
            }
        } catch (err) {
            setProofError(err instanceof Error ? err.message : 'Failed to verify proof');
        } finally {
            setProofLoading(false);
        }
    };

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
    const isVirtual = artwork.id.startsWith('virtual-');
    const hasStoredProof = !isVirtual && (!!artwork.proofMetadata || !!artwork.embeddedProof);

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
                        {showMask && maskUrl && (
                            <div className="absolute inset-0 opacity-50">
                                <Image
                                    src={maskUrl}
                                    alt="Edit mask"
                                    fill
                                    className="object-contain"
                                />
                            </div>
                        )}
                    </div>
                    {maskUrl && (
                        <button
                            onClick={() => setShowMask(!showMask)}
                            className="mt-4 px-4 py-2 bg-blue-500 text-white rounded hover:bg-blue-600"
                        >
                            {showMask ? 'Hide' : 'Show'} Edit Detection Mask
                        </button>
                    )}
                </div>

                <div>
                    <h1 className="text-3xl font-bold mb-4">
                        {artwork.image.filename || 'Untitled Artwork'}
                    </h1>

                    {isVirtual && (
                        <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4 mb-4">
                            <p className="text-yellow-800 text-sm">
                                This image was uploaded but not yet claimed as your artwork. 
                                You can claim it to add it to your gallery.
                            </p>
                        </div>
                    )}

                    <div className="flex gap-2 mb-4 flex-wrap">
                        {!isVirtual && proofVerification?.isValid && (
                            <span className="bg-green-500 text-white px-3 py-1 rounded-full text-sm">
                                Platform-signed snapshot OK
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
                        {!isVirtual && proofVerification?.wasEdited && (
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
                    </div>

                    {artwork.image.detectionReport && (
                        <div className="bg-gray-50 p-4 rounded-lg mb-4">
                            <h3 className="font-semibold mb-2">AI Detection</h3>
                            <p className="text-sm">
                                Confidence: {(() => {
                                    const isAi = artwork.image.detectionReport.detectedLabel === 'AI_GENERATED';
                                    const confidence = isAi 
                                        ? artwork.image.detectionReport.aiProbability 
                                        : (1 - artwork.image.detectionReport.aiProbability);
                                    return (confidence * 100).toFixed(1);
                                })()}%
                            </p>
                            <p className="text-sm">
                                Label: {artwork.image.detectionReport.detectedLabel}
                            </p>
                        </div>
                    )}

                    {hasStoredProof && (
                        <div className="mt-4">
                            {!showProofUI ? (
                                <button
                                    type="button"
                                    onClick={openProofUI}
                                    className="px-4 py-2 bg-gray-800 text-white rounded-lg text-sm hover:bg-gray-700"
                                >
                                    View platform-signed forensic snapshot
                                </button>
                            ) : (
                                <div className="bg-gray-50 p-4 rounded-lg">
                                    <h3 className="font-semibold mb-2">Platform-signed forensic snapshot</h3>
                                    {proofLoading && (
                                        <p className="text-sm text-gray-500">Verifying snapshot…</p>
                                    )}
                                    {proofError && (
                                        <p className="text-sm text-red-600">{proofError}</p>
                                    )}
                                    {proofVerification && (
                                        <div className="text-sm space-y-1">
                                            <p>
                                                Signature check:{' '}
                                                <span className={proofVerification.isValid ? 'text-green-600' : 'text-red-600'}>
                                                    {proofVerification.isValid ? 'OK' : 'Failed'}
                                                </span>
                                            </p>
                                            <p>
                                                Hash mismatch:{' '}
                                                <span className={proofVerification.wasEdited ? 'text-red-600' : 'text-green-600'}>
                                                    {proofVerification.wasEdited ? 'Yes' : 'No'}
                                                </span>
                                            </p>
                                        </div>
                                    )}
                                </div>
                            )}
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}
