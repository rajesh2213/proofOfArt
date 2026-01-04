'use client';

import React, { useEffect } from 'react';
import Image from 'next/image';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Download, Shield, CheckCircle2, AlertTriangle, Sparkles, Eye } from 'lucide-react';
import { Artwork } from '../../lib/api/art';
import { downloadArtwork } from '../../lib/api/art';
import { useAuth } from '../../contexts/AuthContext';
import { useUI } from '../../contexts/UIContext';

interface ResultsViewerProps {
    artwork: Artwork;
    isOpen: boolean;
    onClose: () => void;
    onViewFullProof?: () => void;
}

export default function ResultsViewer({ artwork, isOpen, onClose, onViewFullProof }: ResultsViewerProps) {
    const [downloading, setDownloading] = React.useState(false);
    const [showMask, setShowMask] = React.useState(false);
    const [reducedMotion, setReducedMotion] = React.useState(false);
    const [imageAspectRatio, setImageAspectRatio] = React.useState<'portrait' | 'landscape'>('portrait');
    const { user } = useAuth();
    const { setHideHeader } = useUI();

    const hasMask = artwork.image.editDetections && artwork.image.editDetections.length > 0;
    const maskUrl = hasMask ? artwork.image.editDetections?.[0]?.maskUrl : null;
    const proofMetadata = artwork.proofMetadata as any;
    const isAiGenerated = artwork.image.detectionReport?.detectedLabel === 'AI_GENERATED';
    const hasTamper = (artwork.image.editDetections?.length || 0) > 0;
    const aiProbability = artwork.image.detectionReport?.aiProbability || 0;
    const displayConfidence = isAiGenerated ? aiProbability : (1 - aiProbability);
    const hasProof = !!artwork.proofMetadata || !!artwork.embeddedProof;
    const canDownload = user && (artwork.currentOwnerId === user.id || artwork.originalUploaderId === user.id);

    useEffect(() => {
        if (isOpen) {
            const img = new window.Image();
            img.onload = () => {
                const aspectRatio = img.width / img.height;
                setImageAspectRatio(aspectRatio > 1 ? 'landscape' : 'portrait');
            };
            img.src = artwork.image.url;
        }
    }, [artwork.image.url, isOpen]);

    useEffect(() => {
        if (typeof window !== 'undefined') {
            const mediaQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
            setReducedMotion(mediaQuery.matches);
        }
    }, []);

    useEffect(() => {
        if (isOpen) {
            setHideHeader(true);
            const handleEscape = (e: KeyboardEvent) => {
                if (e.key === 'Escape') {
                    onClose();
                }
            };
            document.addEventListener('keydown', handleEscape);
            document.body.style.overflow = 'hidden';
            return () => {
                setHideHeader(false);
                document.removeEventListener('keydown', handleEscape);
                document.body.style.overflow = 'unset';
            };
        } else {
            setHideHeader(false);
        }
    }, [isOpen, onClose, setHideHeader]);

    const handleDownload = async (e: React.MouseEvent) => {
        e.stopPropagation();
        if (!canDownload || downloading) return;

        try {
            setDownloading(true);
            await downloadArtwork(artwork.imageId, 'system');
        } catch {
            alert('Failed to download artwork. Please try again.');
        } finally {
            setDownloading(false);
        }
    };

    const frameAspectRatio = imageAspectRatio === 'landscape' ? '4/3' : '3/4';

    return (
        <AnimatePresence>
            {isOpen && (
                <>
                    <motion.div
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        onClick={onClose}
                        className="fixed inset-0 z-[100] bg-black/70 backdrop-blur-md"
                    />

                    <motion.div
                        initial={{ opacity: 0, scale: 0.9, y: 20 }}
                        animate={{ opacity: 1, scale: 1, y: 0 }}
                        exit={{ opacity: 0, scale: 0.9, y: 20 }}
                        transition={{
                            duration: reducedMotion ? 0.2 : 0.3,
                            ease: [0.4, 0, 0.2, 1],
                        }}
                        className="fixed inset-0 z-[101] flex items-center justify-center p-4 pointer-events-none"
                        onClick={(e) => e.stopPropagation()}
                    >
                        <div 
                            className="relative w-full max-w-[90vw] max-h-[90vh] overflow-y-auto overflow-x-hidden pointer-events-auto bg-transparent"
                            onClick={(e) => e.stopPropagation()}
                            style={{
                                padding: '20px',
                            }}
                        >
                            <button
                                onClick={onClose}
                                className="absolute top-2 right-2 z-50 bg-white/90 hover:bg-white backdrop-blur-sm rounded-full p-2 shadow-lg border border-white/50 text-gray-800 hover:text-gray-900 transition-colors"
                                aria-label="Close results"
                            >
                                <X className="h-5 w-5" />
                            </button>

                            <div className="max-w-4xl mx-auto">
                                <h2
                                    className="text-2xl font-semibold text-white mb-6"
                                    style={{
                                        fontFamily: "'Georgia', 'Times New Roman', serif",
                                        letterSpacing: '0.02em',
                                    }}
                                >
                                    Authenticity Certificate
                                </h2>

                                <div
                                    className="mb-6"
                                    style={{
                                        height: '2px',
                                        background: 'linear-gradient(to right, transparent, #d4af37, transparent)',
                                        boxShadow: '0 1px 2px rgba(212, 175, 55, 0.3)',
                                    }}
                                />

                                <div
                                    className="relative mb-8 mx-auto"
                                    style={{
                                        maxWidth: 'min(75vw, 500px)',
                                    }}
                                >
                                    <div
                                        className="relative w-full"
                                        style={{
                                            padding: '12px',
                                            background: `
                                                linear-gradient(135deg, #8b6f47 0%, #6b5230 50%, #8b6f47 100%),
                                                url('/assets/textures/wood-frame.svg')
                                            `,
                                            backgroundSize: 'auto, 100px 100px',
                                            backgroundBlendMode: 'multiply, normal',
                                            borderRadius: '8px',
                                            boxShadow: `
                                                inset 0 2px 4px rgba(255, 255, 255, 0.1),
                                                inset 0 -2px 4px rgba(0, 0, 0, 0.2),
                                                0 4px 8px rgba(0, 0, 0, 0.15)
                                            `,
                                        }}
                                    >
                                        <div
                                            className="relative"
                                            style={{
                                                padding: '16px',
                                                background: 'linear-gradient(135deg, #f5f3ef 0%, #e8e5e0 100%)',
                                                borderRadius: '4px',
                                                boxShadow: 'inset 0 1px 2px rgba(255, 255, 255, 0.8), inset 0 -1px 2px rgba(0, 0, 0, 0.1)',
                                            }}
                                        >
                                            <div
                                                className="relative overflow-hidden w-full"
                                                style={{
                                                    aspectRatio: frameAspectRatio,
                                                    background: '#faf9f6',
                                                    borderRadius: '2px',
                                                    boxShadow: `
                                                        inset 0 2px 4px rgba(0, 0, 0, 0.1),
                                                        inset 0 -1px 2px rgba(255, 255, 255, 0.5),
                                                        0 1px 0 rgba(0, 0, 0, 0.05)
                                                    `,
                                                }}
                                            >
                                                <div
                                                    className="absolute inset-0 pointer-events-none z-10"
                                                    style={{
                                                        backgroundImage: 'url(/assets/textures/canvas-texture.svg)',
                                                        backgroundSize: '200px 200px',
                                                        opacity: 0.15,
                                                        mixBlendMode: 'multiply',
                                                    }}
                                                />

                                                <div className="relative w-full h-full z-20">
                                                    <Image
                                                        src={artwork.image.url}
                                                        alt={artwork.image.filename || 'Artwork'}
                                                        fill
                                                        className="object-contain"
                                                        priority
                                                        style={{
                                                            filter: 'contrast(1.02) saturate(1.05)',
                                                            clipPath: 'polygon(2% 2%, 98% 2%, 97% 98%, 3% 98%)',
                                                        }}
                                                    />
                                                    
                                                    {showMask && maskUrl && (
                                                        <div className="absolute inset-0 z-30">
                                                            <Image
                                                                src={maskUrl}
                                                                alt="Edit detection mask"
                                                                fill
                                                                className="object-contain mix-blend-multiply"
                                                                style={{ opacity: 0.5 }}
                                                            />
                                                        </div>
                                                    )}

                                                    <div
                                                        className="absolute inset-0 pointer-events-none z-40"
                                                        style={{
                                                            background: 'radial-gradient(ellipse at 2% 2%, transparent 0%, rgba(0,0,0,0.03) 40%, transparent 60%), radial-gradient(ellipse at 98% 98%, transparent 0%, rgba(0,0,0,0.03) 40%, transparent 60%)',
                                                            mixBlendMode: 'multiply',
                                                        }}
                                                    />
                                                </div>
                                            </div>
                                        </div>
                                    </div>
                                </div>

                                <div
                                    className="bg-white/10 backdrop-blur-sm rounded-lg p-6 mb-6"
                                    style={{
                                        border: '1px solid rgba(255, 255, 255, 0.1)',
                                        fontFamily: "'Georgia', 'Times New Roman', serif",
                                    }}
                                >
                                    {/* AI Authenticity Score */}
                                    <div className="mb-6">
                                        <h3
                                            className="text-lg font-semibold text-white mb-3"
                                            style={{
                                                fontFamily: "'Georgia', 'Times New Roman', serif",
                                            }}
                                        >
                                            AI Authenticity Score
                                        </h3>
                                        <div className="flex items-center justify-between text-white">
                                            <span className="text-white/80 italic">Score:</span>
                                            <span className="font-medium text-lg">{(displayConfidence * 100).toFixed(1)}%</span>
                                        </div>
                                    </div>

                                    {/* Gold divider */}
                                    <div
                                        className="my-6"
                                        style={{
                                            height: '1px',
                                            background: 'linear-gradient(to right, transparent, #d4af37, transparent)',
                                            boxShadow: '0 1px 2px rgba(212, 175, 55, 0.3)',
                                        }}
                                    />

                                    {/* Classification */}
                                    <div className="mb-6">
                                        <h3
                                            className="text-lg font-semibold text-white mb-3"
                                            style={{
                                                fontFamily: "'Georgia', 'Times New Roman', serif",
                                            }}
                                        >
                                            Classification
                                        </h3>
                                        <div className="flex items-center justify-between">
                                            <span className="text-white/80 italic">AI Generated?</span>
                                            <div className={`flex items-center gap-2 font-medium ${isAiGenerated ? 'text-orange-400' : 'text-green-400'}`}>
                                                {isAiGenerated ? (
                                                    <>
                                                        <Sparkles className="h-4 w-4" />
                                                        <span>Yes</span>
                                                    </>
                                                ) : (
                                                    <>
                                                        <CheckCircle2 className="h-4 w-4" />
                                                        <span>No (Human Created)</span>
                                                    </>
                                                )}
                                            </div>
                                        </div>
                                    </div>

                                    {/* Tamper Detection - Always show */}
                                    <div
                                        className="my-6"
                                        style={{
                                            height: '1px',
                                            background: 'linear-gradient(to right, transparent, #d4af37, transparent)',
                                            boxShadow: '0 1px 2px rgba(212, 175, 55, 0.3)',
                                        }}
                                    />
                                    <div className="mb-6">
                                        <h3
                                            className="text-lg font-semibold text-white mb-3"
                                            style={{
                                                fontFamily: "'Georgia', 'Times New Roman', serif",
                                            }}
                                        >
                                            Tamper Detection
                                        </h3>
                                        <div className="flex items-center justify-between mb-4">
                                            <span className="text-white/80 italic">Status:</span>
                                            {hasTamper ? (
                                                <div className="flex items-center gap-2 font-medium text-red-400">
                                                    <AlertTriangle className="h-4 w-4" />
                                                    <span>Detected</span>
                                                </div>
                                            ) : (
                                                <div className="flex items-center gap-2 font-medium text-green-400">
                                                    <CheckCircle2 className="h-4 w-4" />
                                                    <span>No Tampering Detected</span>
                                                </div>
                                            )}
                                        </div>
                                        {hasTamper && hasMask && (
                                            <div className="mt-4">
                                                <button
                                                    onClick={(e) => {
                                                        e.stopPropagation();
                                                        setShowMask(!showMask);
                                                    }}
                                                    className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors shadow-lg ${
                                                        showMask
                                                            ? 'bg-blue-600 hover:bg-blue-700 text-white'
                                                            : 'bg-gray-700 hover:bg-gray-800 text-white'
                                                    }`}
                                                    style={{
                                                        fontFamily: "'Georgia', 'Times New Roman', serif",
                                                    }}
                                                >
                                                    <Eye className="h-4 w-4" />
                                                    {showMask ? 'Hide Mask Overlay' : 'Show Mask Overlay'}
                                                </button>
                                            </div>
                                        )}
                                    </div>

                                    {/* Proof Metadata */}
                                    {hasProof && proofMetadata && (
                                        <>
                                            <div
                                                className="my-6"
                                                style={{
                                                    height: '1px',
                                                    background: 'linear-gradient(to right, transparent, #d4af37, transparent)',
                                                    boxShadow: '0 1px 2px rgba(212, 175, 55, 0.3)',
                                                }}
                                            />
                                            <div className="mb-6">
                                                <h3
                                                    className="text-lg font-semibold text-white mb-3 flex items-center gap-2"
                                                    style={{
                                                        fontFamily: "'Georgia', 'Times New Roman', serif",
                                                    }}
                                                >
                                                    <Shield className="h-5 w-5 text-green-400" />
                                                    Signed Metadata
                                                </h3>
                                                <div className="space-y-3 text-sm text-white/90">
                                                    <div className="flex items-start justify-between">
                                                        <span className="text-white/70 italic">Timestamp:</span>
                                                        <span className="font-medium text-right max-w-[60%]">
                                                            {new Date(proofMetadata.signedAt || proofMetadata.timestamp).toLocaleString()}
                                                        </span>
                                                    </div>
                                                    <div className="flex items-start justify-between">
                                                        <span className="text-white/70 italic">Signer KID:</span>
                                                        <span className="font-mono text-xs break-all max-w-[60%] text-right">
                                                            {proofMetadata.signer_kid || 'N/A'}
                                                        </span>
                                                    </div>
                                                    <div className="flex items-start justify-between">
                                                        <span className="text-white/70 italic">Image SHA256:</span>
                                                        <span className="font-mono text-xs break-all max-w-[60%] text-right">
                                                            {proofMetadata.image_sha256 || 'N/A'}
                                                        </span>
                                                    </div>
                                                    {proofMetadata.signature && (
                                                        <div className="flex items-start justify-between">
                                                            <span className="text-white/70 italic">Signature:</span>
                                                            <span className="font-mono text-xs break-all max-w-[60%] text-right">
                                                                {proofMetadata.signature.substring(0, 40)}...
                                                            </span>
                                                        </div>
                                                    )}
                                                </div>
                                            </div>
                                        </>
                                    )}
                                </div>

                                <div className="flex gap-3 justify-center flex-wrap">
                                    {canDownload && (
                                        <button
                                            onClick={handleDownload}
                                            disabled={downloading}
                                            className="flex items-center gap-2 px-6 py-3 bg-amber-700 hover:bg-amber-800 disabled:opacity-50 disabled:cursor-not-allowed rounded-lg text-sm font-medium transition-colors text-white shadow-lg"
                                            style={{
                                                fontFamily: "'Georgia', 'Times New Roman', serif",
                                            }}
                                        >
                                            <Download className="h-4 w-4" />
                                            {downloading ? 'Downloading...' : 'Download (with signed metadata)'}
                                        </button>
                                    )}
                                    {hasProof && onViewFullProof && (
                                        <button
                                            onClick={(e) => {
                                                e.stopPropagation();
                                                onViewFullProof();
                                                onClose();
                                            }}
                                            className="flex items-center gap-2 px-6 py-3 bg-gray-700 hover:bg-gray-800 rounded-lg text-sm font-medium transition-colors text-white shadow-lg"
                                            style={{
                                                fontFamily: "'Georgia', 'Times New Roman', serif",
                                            }}
                                        >
                                            <Eye className="h-4 w-4" />
                                            View Full Proof
                                        </button>
                                    )}
                                </div>
                            </div>
                        </div>
                    </motion.div>
                </>
            )}
        </AnimatePresence>
    );
}

