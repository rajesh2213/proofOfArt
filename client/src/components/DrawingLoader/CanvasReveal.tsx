"use client";

import { motion } from "framer-motion";
import { useState, useEffect, useRef } from "react";
import SvgBrushMask from "./SvgBrushMask";

interface Props {
    children: React.ReactNode;
}

export default function CanvasReveal({ children }: Props) {
    const containerRef = useRef<HTMLDivElement>(null);
    const [scale, setScale] = useState(0.1);
    const [isReady, setIsReady] = useState(false);
    const [contentVisible, setContentVisible] = useState(false);
    const scaleCalculatedRef = useRef(false);
    const contentSize = { width: 1920, height: 1080 };

    useEffect(() => {
        const showContentTimer = setTimeout(() => {
            setContentVisible(true);
        }, 300);
        
        const calculateScale = () => {
            if (scaleCalculatedRef.current) {
                return;
            }

            if (containerRef.current && typeof window !== 'undefined') {
                const container = containerRef.current;
                const rect = container.getBoundingClientRect();
                let containerWidth = rect.width;
                let containerHeight = rect.height;

                const baseLeafSize = 420;
                const baseCanvasWidth = baseLeafSize * 0.455;
                const baseCanvasHeight = baseLeafSize * 0.26;

                if (containerWidth > 0 && containerHeight === 0) {
                    const canvasAspectRatio = 0.26 / 0.455;
                    containerHeight = containerWidth * canvasAspectRatio;
                    
                    if (containerRef.current) {
                        containerRef.current.style.height = `${containerHeight}px`;
                    }
                }

                if (baseCanvasWidth > 0 && baseCanvasHeight > 0) {
                    const scaleX = baseCanvasWidth / contentSize.width;
                    const scaleY = baseCanvasHeight / contentSize.height;
                    const finalScale = Math.max(scaleX, scaleY);

                    setScale(finalScale);
                    setIsReady(true);
                    scaleCalculatedRef.current = true;
                }
            }
        };

        const timeoutId1 = setTimeout(() => {
            calculateScale();
        }, 0);

        const timeoutId2 = setTimeout(() => {
            calculateScale();
        }, 100);

        const timeoutId3 = setTimeout(() => {
            calculateScale();
        }, 300);

        const timeoutId4 = setTimeout(() => {
            calculateScale();
        }, 600);

        const timeoutId5 = setTimeout(() => {
            calculateScale();
        }, 1000);

        if (typeof window !== 'undefined') {
            return () => {
                clearTimeout(showContentTimer);
                clearTimeout(timeoutId1);
                clearTimeout(timeoutId2);
                clearTimeout(timeoutId3);
                clearTimeout(timeoutId4);
                clearTimeout(timeoutId5);
            };
        }
    }, []);

    const contentStyle: React.CSSProperties = {
        width: `${contentSize.width}px`,
        height: `${contentSize.height}px`,
        position: "relative",
        willChange: "transform",
        opacity: contentVisible ? 1 : 0,
        visibility: contentVisible ? 'visible' : 'hidden',
        backgroundColor: '#fce3e7', 
        overflow: 'hidden',
    };
    
    const svgContainerStyle: React.CSSProperties = {
        position: "absolute",
        top: "50%",
        left: "50%",
        transform: `translate(-50%, -50%) translateZ(0) scale(${Math.max(scale, 0.1)})`,
        transformOrigin: "center center",
        width: `${contentSize.width}px`,
        height: `${contentSize.height}px`,
        opacity: isReady ? 1 : 0,
        pointerEvents: 'none',
        willChange: "transform",
        backfaceVisibility: "hidden",
        WebkitBackfaceVisibility: "hidden",
    };

    return (
        <div
            ref={containerRef}
            className="absolute inset-0"
            style={{
                pointerEvents: "none",
                position: "absolute",
                top: 0,
                left: 0,
                right: 0,
                bottom: 0,
                minHeight: '1px',
            }}
        >
            <div style={svgContainerStyle}>
                <SvgBrushMask>
                    <div style={contentStyle}>
                        <div style={{
                            width: '100%',
                            height: '100%',
                            minHeight: '100%',
                            position: 'relative',
                            overflow: 'hidden',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                        }}>
                            {children}
                        </div>
                    </div>
                </SvgBrushMask>
            </div>
        </div>
    );
}