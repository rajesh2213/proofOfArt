"use client";

import React, { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import Image from "next/image";
import gsap from "gsap";
import useGsap from "../../hooks/useGsap";
import { useUI } from "../../contexts/UIContext";
import UploadDialog from "../UploadDialog";
import ScannerOverlay from "../ScannerOverlay";
import { useJobStatus } from "../../hooks/useJobStatus";

export default function UploadArtPageClient(): JSX.Element {
  const { paintDripState, setPaintDripState } = useUI();
  const [uploadComplete, setUploadComplete] = useState<{status: boolean, imageUrl: string | null, inference: any, imageId: string | null}>({status: false, imageUrl: null, inference: null, imageId: null});
  const [showMask, setShowMask] = useState(false);
  const [showPaintBlobs, setShowPaintBlobs] = useState(false);

  const uploadDialogRef = useRef<HTMLDivElement | null>(null);
  const dialogRef = useRef<HTMLDivElement | null>(null);

  const svgRef = useRef<SVGSVGElement | null>(null);
  const blobPathRef = useRef<SVGPathElement | null>(null);
  const glossRef = useRef<SVGCircleElement | null>(null);

  const mainTimelineRef = useRef<gsap.core.Timeline | null>(null);
  const dripsRef = useRef<SVGEllipseElement[]>([]);

  const [backgroundBlack, setBackgroundBlack] = useState(false);
  const [isExpanding, setIsExpanding] = useState(false);

  const shouldPoll = !!uploadComplete.imageId && uploadComplete.status && !uploadComplete.inference;
  const { status: jobStatus, progress: jobProgress, isPolling } = useJobStatus({
    imageId: uploadComplete.imageId,
    enabled: shouldPoll,
    onComplete: (data) => {
      if (data.result) {
        setUploadComplete(prev => ({
          ...prev,
          inference: {
            predictions: {
              is_ai_generated: data.result?.detectedLabel === 'AI_GENERATED',
              confidence: data.result?.aiProbability || 0
            },
            tampering: data.tampering || {
              detected: false,
              edited_pixels: 0,
              edited_area_ratio: 0.0,
              mask_base64: null
            }
          }
        }));
      }
    }
  });

  useGsap();

  useEffect(() => {
    if (paintDripState !== 3 && paintDripState !== 1) {
      setPaintDripState(3);
    }
  }, [paintDripState, setPaintDripState]);

  useEffect(() => {
    let fadeIn: gsap.core.Tween | null = null;
    let timeoutId: NodeJS.Timeout | null = null;
    let retryCount = 0;
    const maxRetries = 10;

    const animateDialog = () => {
      if (!uploadDialogRef.current) {
        if (retryCount < maxRetries) {
          retryCount++;
          timeoutId = setTimeout(animateDialog, 100);
        }
        return;
      }

      const currentOpacity = gsap.getProperty(uploadDialogRef.current, "opacity") as number;
      if (currentOpacity && currentOpacity > 0) {
        return; 
      }

      gsap.set(uploadDialogRef.current, { opacity: 0, y: "-10%", scale: 1 });

      fadeIn = gsap.to(uploadDialogRef.current, {
        opacity: 1,
        y: "0%",
        duration: 1.05,
        ease: "power2.out",
      });
    };

    animateDialog();

    return () => {
      if (timeoutId) {
        clearTimeout(timeoutId);
      }
      if (fadeIn) {
        fadeIn.kill();
      }
      if (uploadDialogRef.current) {
        gsap.killTweensOf(uploadDialogRef.current);
      }
    };
  }, []); 

  const roundedRectPath = (x: number, y: number, w: number, h: number, r: number) => {
    const rx = Math.min(r, w / 2);
    const ry = Math.min(r, h / 2);
    return [
      `M ${x + rx} ${y}`,
      `L ${x + w - rx} ${y}`,
      `Q ${x + w} ${y} ${x + w} ${y + ry}`,
      `L ${x + w} ${y + h - ry}`,
      `Q ${x + w} ${y + h} ${x + w - rx} ${y + h}`,
      `L ${x + rx} ${y + h}`,
      `Q ${x} ${y + h} ${x} ${y + h - ry}`,
      `L ${x} ${y + ry}`,
      `Q ${x} ${y} ${x + rx} ${y}`,
      `Z`,
    ].join(" ");
  };

  const samplePointsFromRoundedRect = (rect: DOMRect, radius: number, samples = 64) => {
    const d = roundedRectPath(rect.left, rect.top, rect.width, rect.height, radius);
    const tempSvg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    const tempPath = document.createElementNS("http://www.w3.org/2000/svg", "path");
    tempPath.setAttribute("d", d);
    tempSvg.appendChild(tempPath);
    const total = (tempPath as any).getTotalLength ? (tempPath as any).getTotalLength() : 0;
    const pts: { x: number; y: number }[] = [];
    for (let i = 0; i < samples; i++) {
      const pt = (tempPath as any).getPointAtLength((i / samples) * total);
      pts.push({ x: pt.x, y: pt.y });
    }
    return pts;
  };

  const smoothClosedPathFromPoints = (pts: { x: number; y: number }[]) => {
    if (!pts.length) return "";
    const cr2bezier = (points: { x: number; y: number }[]) => {
      const beziers: { c1x: number; c1y: number; c2x: number; c2y: number; x: number; y: number }[] = [];
      const len = points.length;
      for (let i = 0; i < len; i++) {
        const p0 = points[(i - 1 + len) % len];
        const p1 = points[i];
        const p2 = points[(i + 1) % len];
        const p3 = points[(i + 2) % len];

        const c1x = p1.x + (p2.x - p0.x) / 6;
        const c1y = p1.y + (p2.y - p0.y) / 6;
        const c2x = p2.x - (p3.x - p1.x) / 6;
        const c2y = p2.y - (p3.y - p1.y) / 6;

        beziers.push({ c1x, c1y, c2x, c2y, x: p2.x, y: p2.y });
      }
      return beziers;
    };

    const bez = cr2bezier(pts);
    const start = pts[0];
    let s = `M ${start.x} ${start.y} `;
    for (let i = 0; i < bez.length; i++) {
      const b = bez[i];
      s += `C ${b.c1x} ${b.c1y} ${b.c2x} ${b.c2y} ${b.x} ${b.y} `;
    }
    s += "Z";
    return s;
  };

  const handleUploadClick = (onAnimationComplete: () => void) => {
    if (!dialogRef.current || !svgRef.current || !blobPathRef.current) return;

    setIsExpanding(true);

    if (mainTimelineRef.current) {
      mainTimelineRef.current.kill();
      mainTimelineRef.current = null;
    }

    const dialogRect = dialogRef.current.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;

    const cornerRadius = 16; 
    const samples = 56; 
    const sampled = samplePointsFromRoundedRect(dialogRect, cornerRadius, samples);

    const initialPath = smoothClosedPathFromPoints(sampled);
    const pathEl = blobPathRef.current!;
    pathEl.setAttribute("d", initialPath);
    pathEl.style.display = "block";
    pathEl.style.fill = "#000"; 

    const gloss = glossRef.current!;
    const glossR = Math.max(24, Math.min(dialogRect.width, dialogRect.height) * 0.42);
    gloss.setAttribute("cx", String(dialogRect.left + dialogRect.width * 0.2));
    gloss.setAttribute("cy", String(dialogRect.top + dialogRect.height * 0.18));
    gloss.setAttribute("r", String(glossR));
    gloss.style.opacity = "0.14";
    gloss.style.display = "block";

    const paintDripCanvas = document.getElementById("paint-drip-canvas");
    const paintDripWrapper = paintDripCanvas?.parentElement;
    setTimeout(() => {
      if (paintDripCanvas) {
        paintDripCanvas.style.opacity = "0";
        paintDripCanvas.style.pointerEvents = "none";
      }
      if (paintDripWrapper) {
        paintDripWrapper.style.opacity = "0";
        paintDripWrapper.style.pointerEvents = "none";
      }
    }, 3000);

    const animPoints: { x: number; y: number; ox: number; oy: number }[] = sampled.map((p) => ({
      x: p.x,
      y: p.y,
      ox: 0,
      oy: 0,
    }));

    const rebuildPath = () => {
      const pts = animPoints.map((p) => ({ x: p.x + p.ox, y: p.y + p.oy }));
      const d = smoothClosedPathFromPoints(pts);
      pathEl.setAttribute("d", d);
    };

    const tl = gsap.timeline({
      onComplete: () => {
        setBackgroundBlack(true);
        setTimeout(() => {
          setShowPaintBlobs(true);
        }, 500);
        setTimeout(() => onAnimationComplete(), 90);
      },
    });
    mainTimelineRef.current = tl;

    const centerX = dialogRect.left + dialogRect.width / 2;
    const centerY = dialogRect.top + dialogRect.height / 2;

    animPoints.forEach((pt) => {
      const dx = pt.x - centerX;
      const dy = pt.y - centerY;
      const dist = Math.sqrt(dx * dx + dy * dy);
      const nx = dx / (dist || 1);
      const ny = dy / (dist || 1);

      const bottomBias = Math.max(0, (pt.y - (dialogRect.top + dialogRect.height * 0.55)) / dialogRect.height);

      const baseMag = 18 + Math.random() * 26;
      const mag = baseMag * (0.6 + bottomBias * 2.2);

      pt.ox = 0;
      pt.oy = 0;

      tl.to(
        pt,
        {
          ox: nx * mag,
          oy: ny * mag + bottomBias * (20 + Math.random() * 36), 
          duration: 0.9 + Math.random() * 0.45,
          ease: "power3.out",
          onUpdate: rebuildPath,
        },
        0
      );
    });

    const maxDx = Math.max(centerX, vw - centerX) + 400;
    const maxDy = Math.max(centerY, vh - centerY) + 400;
    const coverRadius = Math.sqrt(maxDx * maxDx + maxDy * maxDy) * 1.15;

    const avgDist =
      animPoints.reduce((acc, p) => {
        const dx = p.x - centerX;
        const dy = p.y - centerY;
        return acc + Math.sqrt(dx * dx + dy * dy);
      }, 0) / animPoints.length;

    const expandMultiplier = coverRadius / Math.max(1, avgDist);

    animPoints.forEach((pt, idx) => {
      const dx = pt.x - centerX;
      const dy = pt.y - centerY;
      const angle = Math.atan2(dy, dx);
      const dist = Math.sqrt(dx * dx + dy * dy);
      
      const smudgeAngle = angle + (Math.random() - 0.5) * 0.8;
      const smudgeDist = dist * (expandMultiplier - 1) * (0.5 + Math.random() * 0.7);
      const smudgeX = Math.cos(smudgeAngle) * smudgeDist;
      const smudgeY = Math.sin(smudgeAngle) * smudgeDist;
      
      const extraSmudge = Math.random() > 0.7 ? (Math.random() * 60 - 30) : 0;
      const tx = smudgeX + (Math.random() - 0.5) * extraSmudge;
      const ty = smudgeY + (Math.random() - 0.5) * extraSmudge + (dy > 0 ? Math.random() * 40 : 0);

      tl.to(
        pt,
        {
          ox: "+=" + tx,
          oy: "+=" + ty,
          duration: 1.6 + Math.random() * 0.4,
          ease: "power2.out",
          onUpdate: rebuildPath,
        },
        0.5 + Math.random() * 0.3
      );
    });

    tl.to(
      pathEl,
      {
        duration: 1.5,
        ease: "power2.out",
        onStart: () => {
          pathEl.style.filter = "blur(12px)";
        },
        onUpdate: () => {
          const blurVal = 12 + Math.sin(Date.now() * 0.001) * 2;
          pathEl.style.filter = `blur(${blurVal}px)`;
        },
        onComplete: () => {
          pathEl.style.filter = "blur(6px)";
        },
      },
      0.5
    );

    tl.to(
      gloss,
      {
        duration: 1.6,
        attr: {
          cx: centerX - coverRadius * 0.08,
          cy: centerY - coverRadius * 0.18,
          r: coverRadius * 0.45,
        },
        ease: "sine.out",
      },
      0.1
    );
    tl.to(
      gloss,
      {
        duration: 1.0,
        style: { opacity: 0.06 },
        ease: "power2.out",
      },
      1.5
    );

    const bottomSamples = animPoints
      .map((p, i) => ({ p, idx: i }))
      .filter(({ p }) => p.y > dialogRect.top + dialogRect.height * 0.55);

    let sampleXs: number[] = [];
    if (bottomSamples.length >= 6) {
      sampleXs = bottomSamples.map(({ p }) => p.x);
    } else {
      const count = 7;
      for (let i = 0; i < count; i++) {
        sampleXs.push(dialogRect.left + (i / (count - 1)) * dialogRect.width);
      }
    }

    const DRIP_COUNT = 12;
    const drips: SVGEllipseElement[] = [];
    for (let i = 0; i < DRIP_COUNT; i++) {
      const cx = sampleXs[i % sampleXs.length] + (Math.random() - 0.5) * dialogRect.width * 0.08;
      const cy = dialogRect.top + dialogRect.height + 4 + Math.random() * 12;
      const rx = 8 + Math.random() * 14;
      const ry = 12 + Math.random() * 35;

      const drip = document.createElementNS("http://www.w3.org/2000/svg", "ellipse") as SVGEllipseElement;
      drip.setAttribute("cx", String(cx));
      drip.setAttribute("cy", String(cy));
      drip.setAttribute("rx", String(rx));
      drip.setAttribute("ry", String(ry));
      drip.setAttribute("fill", "#000");
      drip.setAttribute("opacity", "0");
      const rot = (Math.random() - 0.5) * 15;
      drip.setAttribute("transform", `rotate(${rot}, ${cx}, ${cy})`);
      drip.setAttribute("filter", "url(#softBlur)");

      svgRef.current!.appendChild(drip);
      drips.push(drip);
    }

    dripsRef.current = drips;

    drips.forEach((d, i) => {
      const delay = 0.35 + i * 0.05 + Math.random() * 0.15;
      const fallTo = vh + 180 + Math.random() * 160;
      const stretchBy = 25 + Math.random() * 55;
      const wobble = (Math.random() - 0.5) * 100;
      const smudgeX = (Math.random() - 0.5) * 40;

      tl.to(
        d,
        {
          duration: 0.18,
          attr: { opacity: 0.95 + Math.random() * 0.05 },
          ease: "power1.in",
        },
        delay
      );

      tl.to(
        d,
        {
          duration: 1.6 + Math.random() * 0.8,
          attr: {
            ry: "+=" + stretchBy,
            cy: fallTo,
            cx: "+=" + (wobble + smudgeX),
            rx: "+=" + (Math.random() * 8 - 2),
          },
          ease: "power2.in",
          onUpdate: () => {
            const currentOpacity = parseFloat(d.getAttribute("opacity") || "1");
            d.setAttribute("opacity", String(Math.max(0.7, currentOpacity - Math.random() * 0.1)));
          }
        },
        delay + 0.08
      );

      tl.to(
        d,
        {
          duration: 0.5,
          attr: { 
            opacity: 0,
            rx: "+=" + (Math.random() * 15),
          },
          ease: "power1.out",
        },
        delay + 1.3
      );
    });
  };

  useEffect(() => {
    return () => {
      const tl = mainTimelineRef.current;
      if (tl) tl.kill();
      mainTimelineRef.current = null;

      dripsRef.current.forEach((d) => {
        try {
          d.remove();
        } catch {
          /* ignore */
        }
      });
      dripsRef.current = [];
    };
  }, []);

  const prevStatusRef = useRef(uploadComplete.status);

  useEffect(() => {
    if (!uploadDialogRef.current) return;

    const dialogElement = uploadDialogRef.current;
    const wasComplete = prevStatusRef.current;
    const isComplete = uploadComplete.status;
    
    if (isComplete && !wasComplete) {
      gsap.to(dialogElement, {
        duration: 0.8,
        ease: 'power3.out',
        left: '20px',
        top: 0,
        x: 0,
        y: 0,
        width: '360px',
        height: '100vh',
        paddingTop: '80px',
      });
      
      gsap.set(dialogElement, {
        alignItems: 'flex-start',
        justifyContent: 'flex-start',
      });
    } else if (!isComplete && wasComplete) {
      gsap.to(dialogElement, {
        duration: 0.8,
        ease: 'power3.out',
        left: '50%',
        top: '50%',
        x: '-50%',
        y: '-30%',
        width: '100%',
        height: 'auto',
        paddingTop: '0',
        immediateRender: false,
        onComplete: () => {
          gsap.set(dialogElement, {
            clearProps: "all",
            opacity: 1,
          });
          if (dialogElement && !uploadComplete.status) {
            requestAnimationFrame(() => {
              if (dialogElement && !uploadComplete.status) {
                dialogElement.style.display = 'flex';
                dialogElement.style.alignItems = 'center';
                dialogElement.style.justifyContent = 'center';
                dialogElement.style.width = '100%';
                dialogElement.style.opacity = '1';
                dialogElement.style.pointerEvents = 'none';
                dialogElement.style.zIndex = '40';
                const child = dialogElement.querySelector('div[style*="pointer-events"]') as HTMLElement;
                if (child) {
                  child.style.pointerEvents = 'auto';
                }
              }
            });
          }
        }
      });
      
      setShowPaintBlobs(false);
      setBackgroundBlack(false);
      
      const paintDripCanvas = document.getElementById("paint-drip-canvas");
      const paintDripWrapper = paintDripCanvas?.parentElement;
      if (paintDripCanvas) {
        paintDripCanvas.style.opacity = "1";
        paintDripCanvas.style.pointerEvents = "auto";
      }
      if (paintDripWrapper) {
        paintDripWrapper.style.opacity = "1";
        paintDripWrapper.style.pointerEvents = "auto";
      }
      
      if (blobPathRef.current) {
        blobPathRef.current.style.display = "none";
      }
      if (glossRef.current) {
        glossRef.current.style.display = "none";
      }
      dripsRef.current.forEach(drip => {
        if (drip && drip.parentNode) {
          drip.parentNode.removeChild(drip);
        }
      });
      dripsRef.current = [];
      
      if (mainTimelineRef.current) {
        mainTimelineRef.current.kill();
        mainTimelineRef.current = null;
      }
      
      setIsExpanding(false);
      
      if (paintDripState !== 3) {
        setPaintDripState(3);
      }
    }
    
    prevStatusRef.current = uploadComplete.status;
  }, [uploadComplete.status, paintDripState, setPaintDripState]);

  return (
    <div
      className="relative transition-colors duration-300"
      style={{
        zIndex: 1,
        width: "100%",
        minHeight: "100vh",
        position: "relative",
      }}
    >
      <div style={{ height: paintDripState === 2 ? "300vh" : "100vh" }} />

      <div
        style={{
          position: "fixed",
          inset: 0,
          width: "100vw",
          height: "100vh",
          zIndex: -1,
          overflow: "hidden",
          backgroundColor: backgroundBlack ? "#000" : "#fce3e7",
          transition: "background-color 1s ease-in-out",
        }}
      >
        <Image
          src="/images/5177180.jpg"
          alt="Background"
          fill
          priority
          style={{
            objectFit: "cover",
            opacity: backgroundBlack ? 0 : 1,
            transition: "opacity 1s ease-in-out",
            pointerEvents: "none",
          }}
        />
      </div>

      {typeof window !== "undefined" && !uploadComplete.status &&
        createPortal(
          <svg
            ref={svgRef}
            className="fixed pointer-events-none"
            width="100vw"
            height="100vh"
            style={{
              left: 0,
              top: 0,
              width: "100vw",
              height: "100vh",
              zIndex: 30,
              display: "block",
            }}
            xmlns="http://www.w3.org/2000/svg"
            preserveAspectRatio="none"
          >
            <defs>
              <filter id="softBlur" x="-20%" y="-20%" width="140%" height="140%">
                <feGaussianBlur stdDeviation="3" result="blur" />
                <feMerge>
                  <feMergeNode in="blur" />
                  <feMergeNode in="SourceGraphic" />
                </feMerge>
              </filter>

              <radialGradient id="glossGrad" cx="25%" cy="25%" r="60%">
                <stop offset="0%" stopColor="#fff" stopOpacity="0.6" />
                <stop offset="50%" stopColor="#fff" stopOpacity="0.12" />
                <stop offset="100%" stopColor="#fff" stopOpacity="0" />
              </radialGradient>
            </defs>

            <circle ref={glossRef} cx="0" cy="0" r="0" fill="url(#glossGrad)" style={{ display: "none", mixBlendMode: "overlay" }} opacity="0.12" />

            <path
              ref={blobPathRef}
              d=""
              fill="#000"
              style={{ display: "none", filter: "url(#softBlur)", opacity: 0.98 }}
            />
          </svg>,
          document.body
        )}

      {typeof window !== "undefined" &&
        createPortal(
          <div
            className={`fixed ${uploadComplete.status ? 'top-0 h-full' : 'inset-0 flex items-center justify-center'}`}
            ref={uploadDialogRef}
            style={{ 
              zIndex: uploadComplete.status ? 400 : 40,
              width: uploadComplete.status ? "360px" : "100%", 
              left: uploadComplete.status ? "20px" : "auto",
              opacity: 1,
              transition: uploadComplete.status ? "width 0.8s ease-out, left 0.8s ease-out" : "none",
              paddingTop: uploadComplete.status ? "80px" : "0",
              pointerEvents: uploadComplete.status ? "auto" : "none"
            }}
          >
            <div style={{ pointerEvents: "auto" }}>
              <UploadDialog 
                onUploadClick={handleUploadClick} 
                dialogRef={dialogRef} 
                onUploadComplete={(data) => {
                  setUploadComplete({
                    status: data.status, 
                    imageUrl: data.imageUrl, 
                    inference: data.inference,
                    imageId: data.imageId || null
                  });
                }} 
              />
            </div>
          </div>,
          document.body
        )}

      {typeof window !== "undefined" && uploadComplete.status && uploadComplete.imageUrl &&
        createPortal(
          <div 
            className="fixed inset-0 flex items-center justify-center" 
            style={{ 
              zIndex: 300, 
              paddingLeft: "400px", 
              paddingTop: "80px", 
              paddingBottom: "80px",
              opacity: 0,
              animation: "fadeIn 0.5s ease-in forwards",
              pointerEvents: "auto"
            }}
          >
          <div 
            className="flex flex-col overflow-y-auto"
            style={{
              width: "90%",
              maxWidth: "1400px",
              height: "auto",
              minHeight: "calc(100vh - 160px)",
              maxHeight: "calc(100vh - 160px)",
              backgroundColor: "rgba(255, 255, 255, 0.95)",
              borderRadius: "16px",
              boxShadow: "0 25px 80px rgba(0, 0, 0, 0.2), 0 0 0 1px rgba(0, 0, 0, 0.1)"
            }}
          >
            {/* Image Section - Top Center */}
            <div className="flex-shrink-0 flex items-center justify-center py-8 px-12" style={{ backgroundColor: "rgba(255, 255, 255, 0.95)" }}>
              <div 
                className="relative"
                style={{ 
                  opacity: 0,
                  transform: "translateY(-20px)",
                  animation: "slideDown 0.6s ease-out 0.2s forwards",
                  maxWidth: "100%",
                  maxHeight: "40vh"
                }}
              >
                <div className="relative rounded-xl overflow-hidden" style={{
                  boxShadow: "0 20px 60px rgba(0, 0, 0, 0.15), 0 0 0 1px rgba(0, 0, 0, 0.1)"
                }}>
                  <div className="relative">
                    <img
                      src={uploadComplete.imageUrl}
                      alt="Uploaded artwork"
                      className="w-full h-auto object-contain block"
                      style={{ 
                        maxHeight: "40vh",
                        maxWidth: "100%",
                        display: "block",
                        width: "auto",
                        height: "auto"
                      }}
                    />
                            
                    {uploadComplete.imageId && !uploadComplete.inference && (
                      <ScannerOverlay 
                        active={jobStatus !== "complete" && jobStatus !== "failed"}
                        progress={jobProgress}
                        className="rounded-xl"
                      />
                    )}
                            
                    {uploadComplete.inference?.tampering?.detected &&
                     uploadComplete.inference?.tampering?.mask_base64 && (
                      <div 
                        className="absolute inset-0 pointer-events-none transition-opacity duration-300"
                        style={{
                          opacity: showMask ? 0.6 : 0,
                          backgroundImage: `url(${uploadComplete.inference.tampering.mask_base64})`,
                          backgroundSize: "cover",
                          backgroundPosition: "center",
                          mixBlendMode: "screen",
                          filter: "brightness(1.2) contrast(1.1)",
                          zIndex: 5
                        }}
                      />
                    )}
                  </div>
                          
                  {uploadComplete.inference?.tampering?.detected &&
                   uploadComplete.inference?.tampering?.mask_base64 && (
                    <button
                      onClick={() => setShowMask(!showMask)}
                      className="absolute top-4 right-4 px-4 py-2 rounded-lg font-semibold text-sm transition-all duration-200 transform hover:scale-105"
                      style={{
                        background: showMask 
                          ? "rgba(239, 68, 68, 0.9)" 
                          : "rgba(255, 255, 255, 0.15)",
                        color: "white",
                        border: "2px solid rgba(255, 255, 255, 0.3)",
                        backdropFilter: "blur(10px)",
                        boxShadow: "0 4px 20px rgba(0, 0, 0, 0.5), inset 0 1px 1px rgba(255, 255, 255, 0.2)",
                        fontFamily: "var(--font-mono), 'Courier New', Courier, monospace",
                        letterSpacing: "0.05em",
                        zIndex: 10
                      }}
                    >
                      {showMask ? "Hide Mask" : "Show Mask"}
                    </button>
                  )}
                </div>
              </div>
            </div>

            {/* Results Section - Directly below image, no nested container */}
            <div className="flex-shrink-0 px-12 pb-16 pt-8" style={{ backgroundColor: "rgba(250, 248, 255, 0.98)" }}>
              {uploadComplete.inference && (
                <div 
                  className="max-w-5xl mx-auto"
                  style={{ 
                    opacity: 0,
                    transform: "translateY(20px)",
                    animation: "slideUp 0.6s ease-out 0.4s forwards"
                  }}
                >
                  {/* Section Title - Clean typography with subtle divider */}
                  <div className="mb-8 pb-6 border-b border-black/10">
                    <h3 
                      className="font-bold text-2xl text-black tracking-wider text-left" 
                      style={{ 
                        letterSpacing: "0.1em",
                        fontFamily: "var(--font-mono), 'Courier New', Courier, monospace"
                      }}
                    >
                      ANALYSIS RESULTS
                    </h3>
                  </div>

                  {/* Results Cards - Bright white/pink theme */}
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    {/* Generation Type Card */}
                    <div 
                      className="p-6 rounded-xl border-2"
                      style={{
                        background: "rgba(255, 255, 255, 0.5)",
                        backdropFilter: "blur(8px)",
                        borderColor: "rgba(0, 0, 0, 0.2)",
                        boxShadow: "inset 0 1px 1px rgba(255, 255, 255, 0.3), 0 2px 8px rgba(0, 0, 0, 0.1)"
                      }}
                    >
                      <div className="flex items-center gap-3 mb-4">
                        <div 
                          className="w-3 h-3 rounded-full"
                          style={{
                            background: uploadComplete.inference.predictions?.is_ai_generated 
                              ? "linear-gradient(135deg, #ef4444, #dc2626)" 
                              : "linear-gradient(135deg, #10b981, #059669)",
                            boxShadow: `0 0 20px ${uploadComplete.inference.predictions?.is_ai_generated ? 'rgba(239, 68, 68, 0.5)' : 'rgba(16, 185, 129, 0.5)'}`
                          }}
                        />
                        <h4 className="font-semibold text-black text-lg tracking-wide">Generation Type</h4>
                      </div>
                      <p className="text-black/80 text-sm mb-2 font-medium">
                        {uploadComplete.inference.predictions?.is_ai_generated 
                          ? "AI-Generated" 
                          : "Human-Created"}
                      </p>
                      <div className="mt-3">
                        {uploadComplete.inference.predictions?.is_ai_generated ? (
                          <>
                            <div className="flex justify-between text-xs text-black/60 mb-1">
                              <span>Confidence (AI-Generated)</span>
                              <span>{(uploadComplete.inference.predictions?.confidence * 100 || 0).toFixed(1)}%</span>
                            </div>
                            <div className="w-full h-2 bg-black/10 rounded-full overflow-hidden">
                              <div 
                                className="h-full transition-all duration-500"
                                style={{
                                  width: `${(uploadComplete.inference.predictions?.confidence * 100 || 0)}%`,
                                  background: "linear-gradient(90deg, #ef4444, #dc2626)",
                                  boxShadow: "0 0 10px rgba(239, 68, 68, 0.6)"
                                }}
                              />
                            </div>
                          </>
                        ) : (
                          <>
                            <div className="flex justify-between text-xs text-black/60 mb-1">
                              <span>Confidence (Human-Created)</span>
                              <span>{((1 - (uploadComplete.inference.predictions?.confidence || 0)) * 100).toFixed(1)}%</span>
                            </div>
                            <div className="w-full h-2 bg-black/10 rounded-full overflow-hidden">
                              <div 
                                className="h-full transition-all duration-500"
                                style={{
                                  width: `${((1 - (uploadComplete.inference.predictions?.confidence || 0)) * 100)}%`,
                                  background: "linear-gradient(90deg, #10b981, #059669)",
                                  boxShadow: "0 0 10px rgba(16, 185, 129, 0.6)"
                                }}
                              />
                            </div>
                          </>
                        )}
                      </div>
                    </div>

                    {/* Tampering Card */}
                    <div 
                      className="p-6 rounded-xl border-2"
                      style={{
                        background: uploadComplete.inference.tampering?.detected 
                          ? "rgba(245, 158, 11, 0.15)" 
                          : "rgba(255, 255, 255, 0.5)",
                        backdropFilter: "blur(8px)",
                        borderColor: uploadComplete.inference.tampering?.detected 
                          ? "rgba(245, 158, 11, 0.4)" 
                          : "rgba(0, 0, 0, 0.2)",
                        boxShadow: uploadComplete.inference.tampering?.detected
                          ? "inset 0 1px 1px rgba(255, 255, 255, 0.3), 0 2px 8px rgba(245, 158, 11, 0.3)"
                          : "inset 0 1px 1px rgba(255, 255, 255, 0.3), 0 2px 8px rgba(0, 0, 0, 0.1)"
                      }}
                    >
                      <div className="flex items-center gap-3 mb-4">
                        <div 
                          className="w-3 h-3 rounded-full"
                          style={{
                            background: uploadComplete.inference.tampering?.detected 
                              ? "linear-gradient(135deg, #f59e0b, #d97706)" 
                              : "linear-gradient(135deg, #10b981, #059669)",
                            boxShadow: `0 0 20px ${uploadComplete.inference.tampering?.detected ? 'rgba(245, 158, 11, 0.5)' : 'rgba(16, 185, 129, 0.5)'}`
                          }}
                        />
                        <h4 className="font-semibold text-black text-lg tracking-wide">Tampering</h4>
                      </div>
                      {uploadComplete.inference.tampering?.detected ? (
                        <>
                          <div className="mb-3">
                            <p className="text-black font-semibold text-sm mb-1">
                              ⚠️ Image has been edited
                            </p>
                            <p className="text-black/70 text-xs">
                              Tampering detected in this image
                            </p>
                          </div>
                          <div className="space-y-2 pt-3 border-t border-black/10">
                            <div className="flex justify-between items-center text-xs">
                              <span className="text-black/70">Edited Area:</span>
                              <span className="text-black font-semibold">
                                {(uploadComplete.inference.tampering.edited_area_ratio * 100 || 0).toFixed(2)}%
                              </span>
                            </div>
                            <div className="w-full h-2 bg-black/10 rounded-full overflow-hidden">
                              <div 
                                className="h-full transition-all duration-500"
                                style={{
                                  width: `${(uploadComplete.inference.tampering.edited_area_ratio * 100 || 0)}%`,
                                  background: "linear-gradient(90deg, #f59e0b, #d97706)",
                                  boxShadow: "0 0 10px rgba(245, 158, 11, 0.6)"
                                }}
                              />
                            </div>
                            <div className="flex justify-between items-center text-xs pt-1">
                              <span className="text-black/70">Edited Pixels:</span>
                              <span className="text-black font-semibold">
                                {uploadComplete.inference.tampering.edited_pixels?.toLocaleString() || 0}
                              </span>
                            </div>
                          </div>
                        </>
                      ) : (
                        <p className="text-black/80 text-sm">
                          ✓ No tampering detected
                        </p>
                      )}
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>,
        document.body
      )}

              {typeof window !== "undefined" && showPaintBlobs && uploadComplete.status &&
        createPortal(
          <div 
            className="fixed inset-0 pointer-events-none"
            style={{ zIndex: 25 }}
          >
            {[
              { w: 350, h: 380, l: 10, t: 15, d: 18, delay: 0, color: 'rgba(255, 255, 255, 0.15)' },
              { w: 280, h: 320, l: 75, t: 20, d: 22, delay: 2, color: 'rgba(200, 200, 255, 0.12)' },
              { w: 420, h: 400, l: 50, t: 60, d: 25, delay: 1, color: 'rgba(255, 200, 200, 0.13)' },
              { w: 300, h: 350, l: 20, t: 80, d: 20, delay: 3, color: 'rgba(200, 255, 200, 0.12)' },
              { w: 380, h: 360, l: 80, t: 40, d: 24, delay: 1.5, color: 'rgba(255, 255, 200, 0.13)' },
              { w: 320, h: 340, l: 45, t: 5, d: 19, delay: 2.5, color: 'rgba(255, 200, 255, 0.12)' }
            ].map((blob, i) => (
              <div
                key={i}
                className="absolute rounded-full"
                style={{
                  width: `${blob.w}px`,
                  height: `${blob.h}px`,
                  left: `${blob.l}%`,
                  top: `${blob.t}%`,
                  background: `radial-gradient(circle, ${blob.color} 0%, rgba(0, 0, 0, 0) 70%)`,
                  filter: 'blur(50px)',
                  opacity: 0.6,
                  animation: `paintBlob${i} ${blob.d}s ease-in-out infinite`,
                  animationDelay: `${blob.delay}s`
                }}
              />
            ))}
          </div>,
          document.body
        )}

      <style dangerouslySetInnerHTML={{__html: `
        @keyframes fadeIn {
          from { opacity: 0; }
          to { opacity: 1; }
        }
        @keyframes slideDown {
          from {
            opacity: 0;
            transform: translateY(-20px);
          }
          to {
            opacity: 1;
            transform: translateY(0);
          }
        }
        @keyframes slideUp {
          from {
            opacity: 0;
            transform: translateY(20px);
          }
          to {
            opacity: 1;
            transform: translateY(0);
          }
        }
        @keyframes paintBlob0 {
          0%, 100% { transform: translate(0, 0) scale(1); }
          33% { transform: translate(30px, -40px) scale(1.2); }
          66% { transform: translate(-20px, 30px) scale(0.9); }
        }
        @keyframes paintBlob1 {
          0%, 100% { transform: translate(0, 0) scale(1); }
          25% { transform: translate(-40px, 20px) scale(1.1); }
          50% { transform: translate(25px, -30px) scale(0.8); }
          75% { transform: translate(15px, 25px) scale(1.15); }
        }
        @keyframes paintBlob2 {
          0%, 100% { transform: translate(0, 0) scale(1); }
          40% { transform: translate(35px, 25px) scale(1.3); }
          80% { transform: translate(-25px, -35px) scale(0.85); }
        }
        @keyframes paintBlob3 {
          0%, 100% { transform: translate(0, 0) scale(1); }
          30% { transform: translate(-30px, -20px) scale(1.1); }
          60% { transform: translate(40px, 30px) scale(0.9); }
        }
        @keyframes paintBlob4 {
          0%, 100% { transform: translate(0, 0) scale(1); }
          50% { transform: translate(20px, -25px) scale(1.25); }
        }
        @keyframes paintBlob5 {
          0%, 100% { transform: translate(0, 0) scale(1); }
          33% { transform: translate(-35px, 40px) scale(0.95); }
          66% { transform: translate(30px, -20px) scale(1.2); }
        }
      `}} />
    </div>
  );
}
