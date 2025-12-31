'use client';

import React from 'react';
import Image from 'next/image';

interface GalleryLayoutProps {
    children: React.ReactNode;
}

export default function GalleryLayout({ children }: GalleryLayoutProps) {
    return (
        <div className="relative" style={{ width: '100%', height: '100%', position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }}>
            <Image
                src="/images/8522422.jpg"
                alt="Gallery Background"
                fill
                priority
                style={{
                    objectFit: 'cover',
                    objectPosition: 'center',
                    zIndex: 0,
                }}
            />
            <div 
                className="absolute inset-0 z-[1]"
                style={{
                    background: 'radial-gradient(ellipse at center, rgba(0, 0, 0, 0.1) 0%, rgba(0, 0, 0, 0.2) 50%, rgba(0, 0, 0, 0.7) 100%)',
                }}
            />
            <div className="relative z-10 flex items-center justify-center p-4" style={{ width: '100%', height: '100%', position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }}>
                {children}
            </div>
        </div>
    );
}


