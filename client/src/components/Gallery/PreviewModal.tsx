'use client';

import React, { useEffect } from 'react';
import Image from 'next/image';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Download, Eye, Shield } from 'lucide-react';
import { Artwork } from '../../lib/api/art';
import { downloadArtwork } from '../../lib/api/art';
import { useUI } from '../../contexts/UIContext';

interface PreviewModalProps {
    artwork: Artwork;
    isOpen: boolean;
    onClose: () => void;
}

export default function PreviewModal({ artwork, isOpen, onClose }: PreviewModalProps) {
    const [downloading, setDownloading] = React.useState(false);
    const [showMask, setShowMask] = React.useState(false);
    const [reducedMotion, setReducedMotion] = React.useState(false);
    const [imageAspectRatio, setImageAspectRatio] = React.useState<'portrait' | 'landscape'>('portrait');
    const { setHideHeader } = useUI();

    const hasMask = artwork.image.editDetections && artwork.image.editDetections.length > 0;
    const maskUrl = hasMask ? artwork.image.editDetections?.[0]?.maskUrl : null;
    const proofMetadata = artwork.proofMetadata as any;

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
        if (downloading) return;

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
                        initial={{ opacity: 0, scale: 0.95 }}
                        animate={{ opacity: 1, scale: 1 }}
                        exit={{ opacity: 0, scale: 0.95 }}
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
                                aria-label="Close preview"
                            >
                                <X className="h-5 w-5" />
                            </button>

                            <div
                                className="relative mx-auto"
                                style={{
                                    maxWidth: 'min(75vw, 700px)',
                                    maxHeight: 'calc(90vh - 160px)',
                                    width: '100%',
                                }}
                            >
                                <div
                                    className="relative w-full"
                                    style={{
                                        padding: '16px',
                                        background: `
                                            linear-gradient(135deg, #8b6f47 0%, #6b5230 50%, #8b6f47 100%),
                                            url('/assets/textures/wood-frame.svg')
                                        `,
                                        backgroundSize: 'auto, 100px 100px',
                                        backgroundBlendMode: 'multiply, normal',
                                        borderRadius: '12px',
                                        boxShadow: `
                                            inset 0 2px 4px rgba(255, 255, 255, 0.1),
                                            inset 0 -2px 4px rgba(0, 0, 0, 0.2),
                                            0 20px 60px rgba(0, 0, 0, 0.5)
                                        `,
                                    }}
                                >
                                    <div
                                        className="relative"
                                        style={{
                                            padding: '20px',
                                            background: 'linear-gradient(135deg, #f5f3ef 0%, #e8e5e0 100%)',
                                            borderRadius: '6px',
                                            boxShadow: 'inset 0 1px 2px rgba(255, 255, 255, 0.8), inset 0 -1px 2px rgba(0, 0, 0, 0.1)',
                                        }}
                                    >
                                        <div
                                            className="relative overflow-hidden w-full"
                                            style={{
                                                aspectRatio: frameAspectRatio,
                                                background: '#faf9f6',
                                                borderRadius: '4px',
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

                                <div className="mt-4 flex flex-col sm:flex-row gap-4 items-start sm:items-center justify-between px-2">
                                    <div className="flex gap-3">
                                        <button
                                            onClick={handleDownload}
                                            disabled={downloading}
                                            className="flex items-center gap-2 px-5 py-2.5 bg-amber-700 hover:bg-amber-800 disabled:opacity-50 disabled:cursor-not-allowed rounded-lg text-sm font-medium transition-colors text-white shadow-lg"
                                        >
                                            <Download className="h-4 w-4" />
                                            {downloading ? 'Downloading...' : 'Download'}
                                        </button>

                                        {hasMask && (
                                            <button
                                                onClick={() => setShowMask(!showMask)}
                                                className={`flex items-center gap-2 px-5 py-2.5 rounded-lg text-sm font-medium transition-colors shadow-lg ${
                                                    showMask
                                                        ? 'bg-blue-600 hover:bg-blue-700 text-white'
                                                        : 'bg-gray-700 hover:bg-gray-800 text-white'
                                                }`}
                                            >
                                                <Eye className="h-4 w-4" />
                                                {showMask ? 'Hide Mask' : 'Show Mask'}
                                            </button>
                                        )}
                                    </div>
                                        
                                    {proofMetadata && (
                                        <div className="text-sm text-white/90 bg-black/30 backdrop-blur-sm px-4 py-2 rounded-lg border border-white/10">
                                            <div className="flex items-center gap-2 mb-1">
                                                <Shield className="h-4 w-4 text-green-400" />
                                                <span className="font-medium">Verified Proof</span>
                                            </div>
                                            <div className="text-xs text-white/70">
                                                Signed by {proofMetadata.signedBy || 'system'} • {new Date(proofMetadata.signedAt || proofMetadata.timestamp).toLocaleDateString()}
                                            </div>
                                        </div>
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
