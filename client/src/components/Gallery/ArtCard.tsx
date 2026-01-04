'use client';

import React, { useState, useRef, useEffect, useMemo } from 'react';
import Image from 'next/image';
import { motion, useMotionValue, useSpring, useTransform, AnimatePresence } from 'framer-motion';
import { Artwork } from '../../lib/api/art';
import { CheckCircle2, AlertTriangle, Sparkles, Shield, Download, Eye, X } from 'lucide-react';
import { downloadArtwork } from '../../lib/api/art';
import { useAuth } from '../../contexts/AuthContext';
import PreviewModal from './PreviewModal';
import ResultsViewer from './ResultsViewer';

interface ArtCardProps {
    artwork: Artwork;
}

interface ViewProofModalProps {
    artwork: Artwork;
    isOpen: boolean;
    onClose: () => void;
}

function ViewProofModal({ artwork, isOpen, onClose }: ViewProofModalProps) {
    const proofMetadata = artwork.proofMetadata as any;
    
    if (!proofMetadata) {
        return null;
    }

    return (
        <AnimatePresence>
            {isOpen && (
                <>
                    <motion.div
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        onClick={onClose}
                        className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50"
                    />
                    <motion.div
                        initial={{ opacity: 0, scale: 0.9, y: 20 }}
                        animate={{ opacity: 1, scale: 1, y: 0 }}
                        exit={{ opacity: 0, scale: 0.9, y: 20 }}
                        className="fixed inset-0 z-50 flex items-center justify-center p-4"
                        onClick={(e) => e.stopPropagation()}
                    >
                        <div
                            className="bg-gray-900 rounded-2xl p-6 max-w-2xl w-full max-h-[90vh] overflow-y-auto"
                            style={{
                                border: '1px solid rgba(255, 255, 255, 0.1)',
                                boxShadow: '0 20px 60px rgba(0, 0, 0, 0.5)',
                            }}
                        >
                            <div className="flex items-center justify-between mb-4">
                                <h3 className="text-xl font-semibold text-white" style={{
                                    fontFamily: "var(--font-mono), 'Courier New', Courier, monospace",
                                }}>
                                    Proof Metadata
                                </h3>
                                <button
                                    onClick={onClose}
                                    className="text-gray-400 hover:text-white transition-colors"
                                    aria-label="Close modal"
                                >
                                    <X className="h-5 w-5" />
                                </button>
                            </div>

                            <div className="space-y-4 text-sm">
                                <div className="grid grid-cols-2 gap-4">
                                    <div>
                                        <span className="text-gray-400">Image SHA256:</span>
                                        <div className="mt-1 font-mono text-xs text-white break-all bg-gray-800 p-2 rounded">
                                            {proofMetadata.image_sha256}
                                        </div>
                                    </div>
                                    <div>
                                        <span className="text-gray-400">AI Score:</span>
                                        <div className="mt-1 text-white">
                                            {(proofMetadata.ai_score * 100).toFixed(2)}%
                                        </div>
                                    </div>
                                    <div>
                                        <span className="text-gray-400">Is AI Generated:</span>
                                        <div className="mt-1 text-white">
                                            {proofMetadata.is_ai_generated ? 'Yes' : 'No'}
                                        </div>
                                    </div>
                                    <div>
                                        <span className="text-gray-400">Tamper Detected:</span>
                                        <div className="mt-1 text-white">
                                            {proofMetadata.tamper_detected ? 'Yes' : 'No'}
                                        </div>
                                    </div>
                                    <div>
                                        <span className="text-gray-400">Signer KID:</span>
                                        <div className="mt-1 font-mono text-xs text-white break-all bg-gray-800 p-2 rounded">
                                            {proofMetadata.signer_kid}
                                        </div>
                                    </div>
                                    <div>
                                        <span className="text-gray-400">Signed At:</span>
                                        <div className="mt-1 text-white">
                                            {new Date(proofMetadata.signedAt || proofMetadata.timestamp).toLocaleString()}
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </motion.div>
                </>
            )}
        </AnimatePresence>
    );
}

export default function ArtCard({ artwork }: ArtCardProps) {
    const [isHovered, setIsHovered] = useState(false);
    const [reducedMotion, setReducedMotion] = useState(false);
    const [showProofModal, setShowProofModal] = useState(false);
    const [showPreviewModal, setShowPreviewModal] = useState(false);
    const [showResultsViewer, setShowResultsViewer] = useState(false);
    const [downloading, setDownloading] = useState(false);
    const [imageAspectRatio, setImageAspectRatio] = useState<'portrait' | 'landscape'>('portrait');
    const cardRef = useRef<HTMLDivElement>(null);
    const { user } = useAuth();

    const isAiGenerated = artwork.image.detectionReport?.detectedLabel === 'AI_GENERATED';
    const hasTamper = (artwork.image.editDetections?.length || 0) > 0;
    const hasClaims = (artwork.claims?.length || 0) > 0;
    const pendingClaims = artwork.claims?.filter(c => c.status === 'PENDING').length || 0;
    const hasProof = !!artwork.proofMetadata || !!artwork.embeddedProof;
    const aiScore = artwork.image.detectionReport?.aiProbability || 0;
    const canDownload = user && (artwork.currentOwnerId === user.id || artwork.originalUploaderId === user.id);
    const proofMetadata = artwork.proofMetadata as any;

    useEffect(() => {
        const img = new window.Image();
        img.onload = () => {
            const aspectRatio = img.width / img.height;
            setImageAspectRatio(aspectRatio > 1 ? 'landscape' : 'portrait');
        };
        img.src = artwork.image.url;
    }, [artwork.image.url]);

    const baseRotation = useMemo(() => {
        const hash = artwork.id.split('').reduce((acc, char) => acc + char.charCodeAt(0), 0);
        return (hash % 20 - 10) / 10;
    }, [artwork.id]);

    const x = useMotionValue(0);
    const y = useMotionValue(0);

    const rotateX = useSpring(useTransform(y, [-0.5, 0.5], [2, -2]), { stiffness: 300, damping: 30 });
    const rotateY = useSpring(useTransform(x, [-0.5, 0.5], [-2, 2]), { stiffness: 300, damping: 30 });
    const liftY = useSpring(useTransform(y, [-0.5, 0.5], [0, -8]), { stiffness: 200, damping: 25 });

    useEffect(() => {
        if (typeof window !== 'undefined') {
            const mediaQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
            setReducedMotion(mediaQuery.matches);
            
            const handleKeyDown = (e: KeyboardEvent) => {
                if (cardRef.current === document.activeElement || cardRef.current?.contains(document.activeElement)) {
                    if ((e.key === 'Enter' || e.key === ' ') && !showResultsViewer) {
                        e.preventDefault();
                        setShowResultsViewer(true);
                    }
                }
            };
            document.addEventListener('keydown', handleKeyDown);
            return () => document.removeEventListener('keydown', handleKeyDown);
        }
    }, [showResultsViewer]);

    const handleMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
        if (reducedMotion || !cardRef.current) return;

        const rect = cardRef.current.getBoundingClientRect();
        const centerX = rect.left + rect.width / 2;
        const centerY = rect.top + rect.height / 2;

        const distanceX = (e.clientX - centerX) / (rect.width / 2);
        const distanceY = (e.clientY - centerY) / (rect.height / 2);

        x.set(distanceX);
        y.set(distanceY);
    };

    const handleMouseLeave = () => {
        setIsHovered(false);
        x.set(0);
        y.set(0);
    };

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
        <>
            <motion.div
                ref={cardRef}
                onMouseMove={handleMouseMove}
                onMouseEnter={() => setIsHovered(true)}
                onMouseLeave={handleMouseLeave}
                onFocus={() => setIsHovered(true)}
                onBlur={handleMouseLeave}
                tabIndex={0}
                className="relative group focus:outline-none focus:ring-2 focus:ring-amber-400/50 focus:ring-offset-4 focus:ring-offset-transparent"
                style={{
                    perspective: '1200px',
                    transformStyle: 'preserve-3d',
                    transform: 'scale(1.03)',
                    transformOrigin: 'center center',
                }}
            >
                <div
                    className="absolute inset-0 pointer-events-none"
                    style={{
                        background: 'transparent',
                        filter: 'drop-shadow(2px 4px 8px rgba(0, 0, 0, 0.15)) drop-shadow(-1px 2px 4px rgba(0, 0, 0, 0.1)) drop-shadow(4px 8px 16px rgba(0, 0, 0, 0.2))',
                        transform: `rotate(${baseRotation}deg)`,
                        zIndex: 0,
                    }}
                />

                <motion.div
                    className="relative"
                    style={{
                        transformStyle: 'preserve-3d',
                        rotateX: reducedMotion ? 0 : rotateX,
                        rotateY: reducedMotion ? 0 : rotateY,
                        rotateZ: reducedMotion ? baseRotation : baseRotation,
                        y: reducedMotion ? 0 : liftY,
                        transformOrigin: 'center center',
                    }}
                    whileHover={reducedMotion ? {} : { 
                        scale: 1.03,
                        transition: { duration: 0.3, ease: 'easeOut' }
                    }}
                >
                    <div
                        className="relative"
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
                                className="relative"
                                style={{
                                    aspectRatio: frameAspectRatio,
                                    background: '#faf9f6',
                                    borderRadius: '2px',
                                    boxShadow: `
                                        inset 0 2px 4px rgba(0, 0, 0, 0.1),
                                        inset 0 -1px 2px rgba(255, 255, 255, 0.5),
                                        0 1px 0 rgba(0, 0, 0, 0.05)
                                    `,
                                    overflow: 'hidden',
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
                                        className="object-cover"
                                        loading="lazy"
                                        style={{
                                            filter: 'contrast(1.02) saturate(1.05)',
                                            clipPath: 'polygon(2% 2%, 98% 2%, 97% 98%, 3% 98%)',
                                        }}
                                    />
                                    <div
                                        className="absolute inset-0 pointer-events-none"
                                        style={{
                                            background: 'radial-gradient(ellipse at 2% 2%, transparent 0%, rgba(0,0,0,0.03) 40%, transparent 60%), radial-gradient(ellipse at 98% 98%, transparent 0%, rgba(0,0,0,0.03) 40%, transparent 60%)',
                                            mixBlendMode: 'multiply',
                                        }}
                                    />
                                </div>

                                <div className="absolute top-3 right-3 flex flex-col gap-2 z-30">
                                    {hasProof && (
                                        <div className="bg-green-600/95 backdrop-blur-sm text-white text-xs px-2.5 py-1.5 rounded-full flex items-center gap-1.5 shadow-lg border border-green-400/30">
                                            <Shield className="h-3.5 w-3.5" />
                                            <span className="font-medium">Verified</span>
                                        </div>
                                    )}
                                    {!isAiGenerated && (
                                        <div className="bg-green-600/95 backdrop-blur-sm text-white text-xs px-2.5 py-1.5 rounded-full flex items-center gap-1.5 shadow-lg border border-green-400/30">
                                            <CheckCircle2 className="h-3.5 w-3.5" />
                                            <span className="font-medium">Real</span>
                                        </div>
                                    )}
                                    {isAiGenerated && (
                                        <div className="bg-orange-500/95 backdrop-blur-sm text-white text-xs px-2.5 py-1.5 rounded-full flex items-center gap-1.5 shadow-lg border border-orange-400/30">
                                            <Sparkles className="h-3.5 w-3.5" />
                                            <span className="font-medium">AI</span>
                                        </div>
                                    )}
                                    {hasTamper && (
                                        <div className="bg-red-500/95 backdrop-blur-sm text-white text-xs px-2.5 py-1.5 rounded-full flex items-center gap-1.5 shadow-lg border border-red-400/30">
                                            <AlertTriangle className="h-3.5 w-3.5" />
                                            <span className="font-medium">Edited</span>
                                        </div>
                                    )}
                                </div>


                                <AnimatePresence>
                                    {isHovered && !showResultsViewer && (
                                        <motion.div
                                            initial={{ opacity: 0, y: 8, scale: 0.95 }}
                                            animate={{ 
                                                opacity: 1, 
                                                y: 0, 
                                                scale: 1,
                                                transition: {
                                                    duration: reducedMotion ? 0.15 : 0.3,
                                                    ease: [0.22, 1, 0.36, 1],
                                                }
                                            }}
                                            exit={{ 
                                                opacity: 0, 
                                                y: 8, 
                                                scale: 0.95,
                                                transition: {
                                                    duration: reducedMotion ? 0.1 : 0.2,
                                                    ease: [0.22, 1, 0.36, 1],
                                                }
                                            }}
                                            className="absolute bottom-3 left-1/2 -translate-x-1/2 z-[60] flex items-center gap-2"
                                            style={{
                                                pointerEvents: 'auto',
                                            }}
                                        >
                                            <motion.button
                                                whileHover={{ scale: 1.1 }}
                                                whileTap={{ scale: 0.95 }}
                                                onClick={(e) => {
                                                    e.stopPropagation();
                                                    setShowPreviewModal(true);
                                                }}
                                                className="bg-white/90 hover:bg-white backdrop-blur-sm rounded-full p-2 shadow-lg border border-white/50 transition-colors"
                                                style={{ pointerEvents: 'auto' }}
                                                aria-label="Preview artwork"
                                            >
                                                <Eye className="h-4 w-4 text-gray-800" />
                                            </motion.button>

                                            {canDownload && (
                                                <motion.button
                                                    whileHover={{ scale: 1.1 }}
                                                    whileTap={{ scale: 0.95 }}
                                                    onClick={(e) => {
                                                        e.stopPropagation();
                                                        handleDownload(e);
                                                    }}
                                                    disabled={downloading}
                                                    className="bg-white/90 hover:bg-white backdrop-blur-sm rounded-full p-2 shadow-lg border border-white/50 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                                                    style={{ pointerEvents: 'auto' }}
                                                    aria-label="Download artwork"
                                                >
                                                    <Download className="h-4 w-4 text-gray-800" />
                                                </motion.button>
                                            )}

                                            <motion.button
                                                whileHover={{ scale: 1.05 }}
                                                whileTap={{ scale: 0.95 }}
                                    onClick={(e) => {
                                        e.stopPropagation();
                                        setShowResultsViewer(true);
                                    }}
                                                className="bg-amber-700/95 hover:bg-amber-800 backdrop-blur-sm text-white text-xs px-3 py-1.5 rounded-lg shadow-lg border border-amber-600/50 transition-colors font-medium"
                                                style={{ 
                                                    pointerEvents: 'auto',
                                                    fontFamily: "'Georgia', 'Times New Roman', serif",
                                                }}
                                                aria-label="Show results"
                                            >
                                                Show Results
                                            </motion.button>
                                        </motion.div>
                                    )}
                                </AnimatePresence>
                            </div>
                        </div>
                    </div>
                </motion.div>
            </motion.div>

            <ViewProofModal
                artwork={artwork}
                isOpen={showProofModal}
                onClose={() => setShowProofModal(false)}
            />

            <PreviewModal
                artwork={artwork}
                isOpen={showPreviewModal}
                onClose={() => setShowPreviewModal(false)}
            />

            <ResultsViewer
                artwork={artwork}
                isOpen={showResultsViewer}
                onClose={() => setShowResultsViewer(false)}
                onViewFullProof={() => setShowProofModal(true)}
            />
        </>
    );
}
