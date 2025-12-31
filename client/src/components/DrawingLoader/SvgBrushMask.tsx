"use client";

import { motion } from "framer-motion";
import React, { useEffect, useLayoutEffect, useState } from "react";

const BRUSH_BANDS = [
    { id: 1, y: 0, height: 216, baseDelay: 200 },
    { id: 2, y: 216, height: 216, baseDelay: 800 },
    { id: 3, y: 432, height: 216, baseDelay: 1400 },
    { id: 4, y: 648, height: 216, baseDelay: 2000 },
    { id: 5, y: 864, height: 216, baseDelay: 2600 },
];

const generateBrushStrokes = (band: typeof BRUSH_BANDS[0]) => {
    const strokes = [];
    const numStrokes = 8;
    const seed = band.id * 100;
    
    const random = (offset: number) => {
        const x = Math.sin((seed + offset) * 12.9898) * 43758.5453;
        return x - Math.floor(x);
    };
    
    for (let i = 0; i < numStrokes; i++) {
        const strokeSeed = seed + i * 17;
        const animationType = Math.floor(random(i * 5) * 6);
        let direction: 'left-to-right' | 'right-to-left' | 'diagonal-lr' | 'diagonal-rl' | 'curved' | 'wavy';
        let angle = 0;
        let curveAmount = 0;
        let waveFrequency = 0;
        let waveAmplitude = 0;
        
        switch (animationType) {
            case 0:
                direction = 'left-to-right';
                break;
            case 1:
                direction = 'right-to-left';
                break;
            case 2:
                direction = 'diagonal-lr';
                angle = -15 + random(i * 7) * 30;
                break;
            case 3:
                direction = 'diagonal-rl';
                angle = 15 - random(i * 9) * 30;
                break;
            case 4:
                direction = 'curved';
                curveAmount = 50 + random(i * 11) * 100;
                break;
            case 5:
                direction = 'wavy';
                waveFrequency = 2 + random(i * 13) * 3;
                waveAmplitude = 30 + random(i * 17) * 50;
                break;
            default:
                direction = 'left-to-right';
        }
        
        const strokeWidth = 3000 + random(i * 11) * 1000;
        const strokeSpacing = band.height / (numStrokes + 1);
        const baseY = band.y + strokeSpacing * (i + 1);
        const strokeHeight = band.height * (0.85 + random(i * 13) * 0.15);
        const yOffset = (random(i * 3) - 0.5) * band.height * 0.1;
        const centerY = baseY + yOffset;
        const sequentialDelay = i * 180;
        const randomDelay = random(i * 19) * 120;
        const delay = band.baseDelay + sequentialDelay + randomDelay;
        const duration = 1.4 + random(i * 23) * 0.7;
        const paintVariation = 0.4 + random(i * 29) * 0.4;
        
        let startX: number;
        if (direction === 'right-to-left' || direction === 'diagonal-rl') {
            startX = 1920;
        } else {
            startX = -strokeWidth;
        }
        
        strokes.push({
            id: `${band.id}-${i}`,
            direction,
            angle,
            curveAmount,
            waveFrequency,
            waveAmplitude,
            x: startX,
            y: centerY - strokeHeight / 2,
            width: strokeWidth,
            height: strokeHeight,
            delay,
            duration,
            seed: strokeSeed,
            variation: paintVariation,
        });
    }
    
    return strokes;
};

const generateBrushPath = (
    x: number,
    y: number,
    width: number,
    height: number,
    variation: number,
    seed: number,
    angle: number = 0
): string[] => {
    const paths: string[] = [];
    const numLayers = 3;
    
    const seededRandom = (seed: number, t: number) => {
        const x = Math.sin(seed * 12.9898 + t * 78.233) * 43758.5453;
        return x - Math.floor(x);
    };
    
    const taper = (t: number) => {
        const taperAmount = 0.4;
        if (t < 0.15) {
            return t / 0.15 * taperAmount + (1 - taperAmount);
        } else if (t > 0.85) {
            return (1 - t) / 0.15 * taperAmount + (1 - taperAmount);
        }
        return 1;
    };
    
    const rotatePoint = (px: number, py: number, cx: number, cy: number, angleDeg: number) => {
        const angleRad = (angleDeg * Math.PI) / 180;
        const cos = Math.cos(angleRad);
        const sin = Math.sin(angleRad);
        const dx = px - cx;
        const dy = py - cy;
        return {
            x: cx + dx * cos - dy * sin,
            y: cy + dx * sin + dy * cos,
        };
    };
    
    const centerX = x + width / 2;
    const centerY = y + height / 2;
    
    for (let layer = 0; layer < numLayers; layer++) {
        const layerOffset = (layer - (numLayers - 1) / 2) * height * 0.08;
        const layerHeight = height * (0.9 + layer * 0.05);
        const layerVariation = variation * (1 + layer * 0.15);
        
        const points: number[] = [];
        const numPoints = 50;
        
        for (let i = 0; i <= numPoints; i++) {
            const t = i / numPoints;
            const baseX = x + width * t;
            const taperFactor = taper(t);
            const currentHeight = layerHeight * taperFactor;
            
            const bristleNoise = Math.sin(t * Math.PI * 12 + seed + layer * 2) * layerVariation * currentHeight * 0.3;
            const paintBleed = Math.sin(t * Math.PI * 24 + seed * 1.5) * layerVariation * currentHeight * 0.2;
            const textureNoise = Math.sin(t * Math.PI * 48 + seed * 3) * layerVariation * currentHeight * 0.15;
            const randomBristle = (seededRandom(seed + layer * 100, t) - 0.5) * layerVariation * currentHeight * 0.3;
            const paintEdge = Math.abs(Math.sin(t * Math.PI * 6)) * layerVariation * currentHeight * 0.1;
            
            const baseY = centerY - currentHeight / 2 + layerOffset + 
                         bristleNoise + paintBleed + textureNoise + randomBristle + paintEdge;
            
            const rotated = rotatePoint(baseX, baseY, centerX, centerY, angle);
            points.push(rotated.x, rotated.y);
        }
        
        for (let i = numPoints; i >= 0; i--) {
            const t = i / numPoints;
            const baseX = x + width * t;
            const taperFactor = taper(t);
            const currentHeight = layerHeight * taperFactor;
            
            const bristleNoise = Math.cos(t * Math.PI * 11 + seed * 1.3 + layer * 2.5) * layerVariation * currentHeight * 0.3;
            const paintBleed = Math.cos(t * Math.PI * 22 + seed * 2.1) * layerVariation * currentHeight * 0.2;
            const textureNoise = Math.cos(t * Math.PI * 44 + seed * 3.7) * layerVariation * currentHeight * 0.15;
            const randomBristle = (seededRandom(seed + layer * 100 + 300, t) - 0.5) * layerVariation * currentHeight * 0.3;
            
            const paintEdge = Math.abs(Math.cos(t * Math.PI * 5.5)) * layerVariation * currentHeight * 0.1;
            
            const baseY = centerY + currentHeight / 2 + layerOffset + 
                         bristleNoise + paintBleed + textureNoise + randomBristle + paintEdge;
            
            const rotated = rotatePoint(baseX, baseY, centerX, centerY, angle);
            points.push(rotated.x, rotated.y);
        }
        
        let path = `M ${points[0]} ${points[1]}`;
        
        for (let i = 2; i < points.length - 2; i += 2) {
            const px = points[i];
            const py = points[i + 1];
            const prevX = points[i - 2];
            const prevY = points[i - 1];
            const cpX = (prevX + px) / 2;
            const cpY = (prevY + py) / 2;
            
            if (i === 2) {
                path += ` L ${px} ${py}`;
            } else {
                path += ` Q ${prevX} ${prevY} ${cpX} ${cpY}`;
            }
        }
        
        const lastX = points[points.length - 2];
        const lastY = points[points.length - 1];
        path += ` L ${lastX} ${lastY} Z`;
        
        paths.push(path);
    }
    
    return paths;
};

interface SvgBrushMaskProps {
    children: React.ReactNode;
}

export default function SvgBrushMask({ children }: SvgBrushMaskProps) {
    const contentSize = { width: 1920, height: 1080 };
    const [isAnimating, setIsAnimating] = useState(false);
    const [maskReady, setMaskReady] = useState(false);

    useLayoutEffect(() => {
        setMaskReady(true);
    }, []);

    useEffect(() => {
        const t = setTimeout(() => setIsAnimating(true), 100);
        return () => clearTimeout(t);
    }, []);

    const allBrushStrokes = BRUSH_BANDS.flatMap(band => generateBrushStrokes(band));
    
    const getBrushVariants = (stroke: ReturnType<typeof generateBrushStrokes>[0]) => {
        let startX: number = stroke.x;
        let endX: number;
        let startY: number = stroke.y;
        let endY: number = stroke.y;
        let rotate: number = 0;
        
        const angleRad = (stroke.angle * Math.PI) / 180;
        const canvasWidth = 1920;
        const travelDistance = canvasWidth + stroke.width;
        
        switch (stroke.direction) {
            case 'left-to-right':
                endX = canvasWidth - stroke.width * 0.3;
                break;
            case 'right-to-left':
                endX = -stroke.width * 0.7;
                break;
            case 'diagonal-lr':
                startX = -stroke.width;
                endX = canvasWidth - stroke.width * 0.3;
                startY = stroke.y - Math.sin(angleRad) * travelDistance * 0.15;
                endY = stroke.y + Math.sin(angleRad) * travelDistance * 0.15;
                break;
            case 'diagonal-rl':
                startX = canvasWidth;
                endX = -stroke.width * 0.7;
                startY = stroke.y - Math.sin(angleRad) * travelDistance * 0.15;
                endY = stroke.y + Math.sin(angleRad) * travelDistance * 0.15;
                break;
            case 'curved':
                startX = -stroke.width;
                endX = canvasWidth - stroke.width * 0.3;
                startY = stroke.y;
                endY = stroke.y + stroke.curveAmount * 0.3;
                rotate = stroke.curveAmount * 0.1;
                break;
            case 'wavy':
                startX = -stroke.width;
                endX = canvasWidth - stroke.width * 0.3;
                startY = stroke.y;
                endY = stroke.y + stroke.waveAmplitude * 0.5;
                break;
            default:
                endX = canvasWidth - stroke.width * 0.3;
        }
        
        if (stroke.direction === 'wavy') {
            const midY = (startY + endY) / 2;
            return {
                hidden: { 
                    x: startX,
                    y: startY,
                    opacity: 0.9,
                }, 
                reveal: {
                    x: endX,
                    y: [startY, midY + stroke.waveAmplitude, midY - stroke.waveAmplitude, midY + stroke.waveAmplitude * 0.5, endY],
                    opacity: 1,
                    transition: {
                        delay: stroke.delay / 1000,
                        duration: stroke.duration,
                        ease: [0.25, 0.1, 0.25, 1],
                        y: {
                            times: [0, 0.25, 0.5, 0.75, 1],
                            ease: "easeInOut",
                        },
                    },
                },
            };
        }
        
        return {
            hidden: { 
                x: startX,
                y: startY,
                rotate: -rotate,
                opacity: 0.9,
            }, 
            reveal: {
                x: endX,
                y: endY,
                rotate: rotate,
                opacity: 1,
                transition: {
                    delay: stroke.delay / 1000,
                    duration: stroke.duration,
                    ease: stroke.direction === 'curved' 
                        ? [0.4, 0.0, 0.2, 1]
                        : [0.25, 0.1, 0.25, 1],
                },
            },
        };
    };

    return (
        <svg
            width={contentSize.width}
            height={contentSize.height}
            viewBox={`0 0 ${contentSize.width} ${contentSize.height}`}
            style={{ display: 'block' }}
        >
            <mask id="cumulativeBrushMask">
                <rect x="0" y="0" width={contentSize.width} height={contentSize.height} fill="black" />
                
                {allBrushStrokes.map((stroke) => {
                    const variants = getBrushVariants(stroke);
                    const strokeCompleteTime = (stroke.delay / 1000) + stroke.duration;
                    const paintLayers = generateBrushPath(
                        stroke.x,
                        stroke.y,
                        stroke.width,
                        stroke.height,
                        stroke.variation,
                        stroke.seed,
                        stroke.angle
                    );
                    
                    return (
                        <g key={stroke.id}>
                            {paintLayers.map((path, layerIndex) => {
                                const opacity = layerIndex === 0 ? 1 : 0.85 - layerIndex * 0.15;
                                const expansionDelay = strokeCompleteTime - (stroke.duration * 0.2);
                                const expansionScale = 1.12 + layerIndex * 0.04;
                                
                                const expandedVariants = {
                                    hidden: variants.hidden,
                                    reveal: {
                                        ...variants.reveal,
                                        scale: [
                                            1,
                                            1,
                                            expansionScale,
                                        ],
                                        transition: {
                                            ...variants.reveal.transition,
                                            scale: {
                                                times: [0, 0.8, 1],
                                                delay: expansionDelay,
                                                duration: 0.5,
                                                ease: [0.15, 0.0, 0.25, 1],
                                            },
                                        },
                                    },
                                };
                                
                                return (
                                    <motion.path
                                        key={`${stroke.id}-layer-${layerIndex}`}
                                        d={path}
                                        fill="white"
                                        variants={expandedVariants}
                                        initial="hidden"
                                        animate={isAnimating ? "reveal" : "hidden"}
                                        style={{
                                            mixBlendMode: 'normal',
                                            transformOrigin: 'center',
                                            opacity: opacity,
                                        }}
                                    />
                                );
                            })}
                        </g>
                    );
                })}
            </mask>

            <g mask="url(#cumulativeBrushMask)">
                <foreignObject 
                    x="0" 
                    y="0" 
                    width={contentSize.width} 
                    height={contentSize.height}
                    style={{
                        opacity: maskReady ? 1 : 0,
                        visibility: maskReady ? 'visible' : 'hidden',
                    }}
                >
                    {children}
                </foreignObject>
            </g>
        </svg>
    );
}