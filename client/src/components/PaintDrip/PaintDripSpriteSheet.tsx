"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import gsap from "gsap";
import ScrollTrigger from "gsap/ScrollTrigger";
import { useUI } from "../../contexts/UIContext";
import { useLoaderContext } from "../../contexts/LoaderContext";

gsap.registerPlugin(ScrollTrigger);

const SPRITESHEET = "/spritesheets/paint_drip_spritesheets/paint_drip_merged.webp";
const TOTAL_FRAMES = 180;
const FRAMES_PER_ROW = 10;
const FRAME_ROWS = 18; // 180 / 10
const LAST_ACTUAL_FRAME = 137;
const FPS = 30;
const START_FRAME = 0;
const PAUSE_AT_SECONDS = 1.2;

let globalMounted = false;

export default function PaintDripSpriteSheet() {
  const pathname = usePathname();
  const {
    paintDripState,
    isScrollSceneActive,
    parallaxEnd,
    setPaintDripState,
  } = useUI();
  
  const { isLoading: isLoaderLoading } = useLoaderContext();

  const hasThisInstanceClaim = useRef(false);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const wrapperRef = useRef<HTMLDivElement | null>(null);

  const [sheets, setSheets] = useState<HTMLImageElement[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [initialAnimationDone, setInitialAnimationDone] = useState(false);

  const ctxRef = useRef<CanvasRenderingContext2D | null>(null);
  const fwRef = useRef(0);
  const fhRef = useRef(0);

  const lastFrameRef = useRef(-1);
  const currentFrameRef = useRef(START_FRAME);

  const frameMetaRef = useRef<{ sheet: HTMLImageElement; sx: number; sy: number; }[]>([]);
  
  const canvasDimsRef = useRef<{ width: number; height: number; }>({ width: 0, height: 0 });

  const framePauseRef = useRef(Math.floor(PAUSE_AT_SECONDS * FPS));

  const initialDoneRef = useRef(false);
  const scrollTriggerRef = useRef<ScrollTrigger | null>(null);
  const postButtonAnimationStartedRef = useRef(false);
  const animationCompleteRef = useRef(false);

  const isInitialDrip = paintDripState === 1;
  const isPostButtonDrip = paintDripState === 2;
  const allowInitialRender = isInitialDrip && isScrollSceneActive;
  const allowPostButtonRender = isPostButtonDrip;
  const drawFrame = (frame: number) => {
    const ctx = ctxRef.current;
    const canvas = canvasRef.current;
    
    if (!ctx || !canvas || frameMetaRef.current.length === 0) {
      return;
    }

    frame = Math.max(START_FRAME, Math.min(frame, LAST_ACTUAL_FRAME));
    if (lastFrameRef.current === frame) {
      return;
    }
    lastFrameRef.current = frame;

    const meta = frameMetaRef.current[frame];
    if (!meta?.sheet || !fwRef.current || !fhRef.current) {
      return;
    }

    const sheet = meta.sheet;
    const sx = meta.sx;
    const sy = meta.sy;

    const cw = canvas.width;
    const ch = canvas.height;

    const scale = Math.max(cw / fwRef.current, ch / fhRef.current);
    const dw = fwRef.current * scale;
    const dh = fhRef.current * scale;
    const dx = (cw - dw) / 2;
    const dy = 0;

    ctx.globalCompositeOperation = "copy";
    ctx.drawImage(sheet, sx, sy, fwRef.current, fhRef.current, dx, dy, dw, dh);
    ctx.globalCompositeOperation = "source-over";
  };

  useEffect(() => {
    if (paintDripState === 3) {
      animationCompleteRef.current = true;
    }
  }, [paintDripState]);

  const prevPaintDripStateRef = useRef(paintDripState);
  useEffect(() => {
    const prevState = prevPaintDripStateRef.current;
    prevPaintDripStateRef.current = paintDripState;
    
    if (pathname === '/' && paintDripState === 0 && prevState !== 0) {
      initialDoneRef.current = false;
      setInitialAnimationDone(false);
      postButtonAnimationStartedRef.current = false;
      animationCompleteRef.current = false;
      currentFrameRef.current = START_FRAME;
      lastFrameRef.current = -1;
      
      if (scrollTriggerRef.current) {
        scrollTriggerRef.current.kill();
        scrollTriggerRef.current = null;
      }
    }
  }, [pathname, paintDripState, setInitialAnimationDone]);

  useEffect(() => {
    let mounted = true;

    (async () => {
      try {
        const img = new Image();
        img.decoding = "async";
        
        await new Promise<void>((resolve, reject) => {
          img.onload = () => resolve();
          img.onerror = () => reject(new Error('Failed to load spritesheet'));
          img.src = SPRITESHEET;
        });

        try {
          await img.decode();
        } catch {
        }
        
        if (!mounted || !img.naturalWidth || !img.naturalHeight) {
          return;
        }

        fwRef.current = img.naturalWidth / FRAMES_PER_ROW;
        fhRef.current = img.naturalHeight / FRAME_ROWS;

        const off = document.createElement("canvas");
        off.width = img.naturalWidth;
        off.height = img.naturalHeight;
        const offCtx = off.getContext("2d");
        if (offCtx) {
          offCtx.drawImage(img, 0, 0);
        }

        const meta: { sheet: HTMLImageElement; sx: number; sy: number; }[] = [];
        for (let f = 0; f < TOTAL_FRAMES; f++) {
          const col = f % FRAMES_PER_ROW;
          const row = Math.floor(f / FRAMES_PER_ROW);
          meta[f] = {
            sheet: img,
            sx: col * fwRef.current,
            sy: row * fhRef.current,
          };
        }

        frameMetaRef.current = meta;

        setSheets([img]);
        setIsLoading(false);

        if (canvasRef.current && ctxRef.current) {
          requestAnimationFrame(() => {
            if (paintDripState === 3) {
              animationCompleteRef.current = true;
              drawFrame(LAST_ACTUAL_FRAME);
            } else if (paintDripState === 0 || paintDripState === 1) {
              drawFrame(START_FRAME);
            }
          });
        }
      } catch {
        setIsLoading(false);
      }
    })();

    return () => { 
      mounted = false; 
    };
  }, [paintDripState]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const resize = () => {
      const w = window.innerWidth;
      const h = window.innerHeight;

      canvas.width = w;
      canvas.height = h;

      const ctx = canvas.getContext("2d", {
        alpha: true,
        desynchronized: true,
      });
      if (ctx) {
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = "high";
        ctxRef.current = ctx;
      }
    };

    resize();
    window.addEventListener("resize", resize);
    return () => {
      window.removeEventListener("resize", resize);
    };
  }, []);

  useEffect(() => {
    if (paintDripState === 0) {
      initialDoneRef.current = false;
      postButtonAnimationStartedRef.current = false;
      animationCompleteRef.current = false;
      lastFrameRef.current = -1;
      currentFrameRef.current = START_FRAME;
      setInitialAnimationDone(false);
      
      if (canvasRef.current && ctxRef.current && sheets.length > 0) {
        requestAnimationFrame(() => {
          requestAnimationFrame(() => {
            if (canvasRef.current && ctxRef.current && paintDripState === 0) {
              lastFrameRef.current = -1;
              drawFrame(START_FRAME);
            }
          });
        });
      }
    }
  }, [paintDripState, sheets.length]);

  useEffect(() => {
    if (paintDripState === 1) {
      initialDoneRef.current = false;
      postButtonAnimationStartedRef.current = false;
      animationCompleteRef.current = false;
      lastFrameRef.current = -1;
      currentFrameRef.current = START_FRAME;
      setInitialAnimationDone(false);
      
      if (canvasRef.current && ctxRef.current && sheets.length > 0) {
        requestAnimationFrame(() => {
          requestAnimationFrame(() => {
            if (canvasRef.current && ctxRef.current && paintDripState === 1) {
              lastFrameRef.current = -1;
              drawFrame(START_FRAME);
            }
          });
        });
      }
    }
  }, [paintDripState, sheets.length]);
  useEffect(() => {
    // Allow paint drip to start when paintDripState === 1 and isScrollSceneActive is true
    // even if isLoaderLoading is still true (loader is fading but not complete)
    // This ensures it starts immediately when background turns black/white (at 6s)
    if (isLoading || initialDoneRef.current || paintDripState !== 1) {
      return;
    }
    // Only block if loader is loading AND we don't have permission to render
    // If allowInitialRender is true, proceed even if loader is still fading
    if (isLoaderLoading && !allowInitialRender) {
      return;
    }
    const pauseFrame = framePauseRef.current;
    const durationFrames = pauseFrame - START_FRAME;
    const durationSeconds = PAUSE_AT_SECONDS;

    const tl = gsap.timeline({
      paused: true,
      onUpdate() {
        const progress = tl.progress();
        const frame = Math.min(
          Math.floor(START_FRAME + progress * durationFrames),
          pauseFrame
        );
        drawFrame(frame);
      },
      onComplete() {
        initialDoneRef.current = true;
        setInitialAnimationDone(true);
        drawFrame(pauseFrame);
      },
    });

    tl.to({}, { duration: durationSeconds });
    tl.play();

    return () => {
      tl.kill();
    };
  }, [isLoading, isLoaderLoading, allowInitialRender, setPaintDripState, paintDripState, isScrollSceneActive]);

  useEffect(() => {
    if (!allowPostButtonRender || isLoading || paintDripState !== 2) {
      postButtonAnimationStartedRef.current = false;
      return;
    }
    
    if (!canvasRef.current || !ctxRef.current) {
      return;
    }
    
    if (!initialAnimationDone) {
      initialDoneRef.current = true;
      setInitialAnimationDone(true);
      const pauseFrame = framePauseRef.current;
      drawFrame(pauseFrame);
    }
    
    if (postButtonAnimationStartedRef.current) return;
    postButtonAnimationStartedRef.current = true;

    if (scrollTriggerRef.current) scrollTriggerRef.current.kill();

    const pauseFrame = framePauseRef.current;
    const framesToAnimate = LAST_ACTUAL_FRAME - pauseFrame;
    const durationSeconds = framesToAnimate / FPS;
    drawFrame(pauseFrame);

    let timelineRef: gsap.core.Timeline | null = null;

    const tl = gsap.timeline({
      paused: false,
      onUpdate() {
        const progress = tl.progress();
        const frame = Math.floor(pauseFrame + progress * framesToAnimate);
        drawFrame(frame);
      },
      onComplete() {
        animationCompleteRef.current = true;
        drawFrame(LAST_ACTUAL_FRAME);
        setPaintDripState(3);
      },
    });

    timelineRef = tl;
    tl.to({}, { duration: durationSeconds });

    return () => {
      if (!animationCompleteRef.current && timelineRef) {
        timelineRef.kill();
      }
      if (scrollTriggerRef.current) {
        scrollTriggerRef.current.kill();
        scrollTriggerRef.current = null;
      }
    };
  }, [allowPostButtonRender, isLoading, initialAnimationDone, setPaintDripState]);

  useEffect(() => {
    if (isLoading || frameMetaRef.current.length === 0 || !fwRef.current || !fhRef.current) {
      return;
    }

    if (paintDripState === 1 && sheets.length > 0 && !initialDoneRef.current) {
      if (canvasRef.current && ctxRef.current) {
        requestAnimationFrame(() => {
          if (canvasRef.current && ctxRef.current && paintDripState === 1) {
            drawFrame(START_FRAME);
          }
        });
      }
      return;
    }
    
    if (paintDripState === 3 && sheets.length > 0) {
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          if (canvasRef.current && ctxRef.current) {
            drawFrame(LAST_ACTUAL_FRAME);
          }
        });
      });
      animationCompleteRef.current = true;
      return;
    }
    
    if (animationCompleteRef.current) {
      return;
    }
    
    if (initialDoneRef.current && !allowPostButtonRender && !isLoading && sheets.length > 0) {
      const pauseFrame = framePauseRef.current;
      requestAnimationFrame(() => {
        drawFrame(pauseFrame);
      });
    }
  }, [allowPostButtonRender, isLoading, sheets.length, paintDripState]);

  if (!globalMounted) {
    hasThisInstanceClaim.current = true;
    globalMounted = true;
  } else if (paintDripState === 3 && !hasThisInstanceClaim.current) {
    globalMounted = false;
    hasThisInstanceClaim.current = true;
    globalMounted = true;
  }

  useEffect(() => {
    return () => {
      if (hasThisInstanceClaim.current) {
        setTimeout(() => {
          globalMounted = false;
        }, 50);
      }
    };
  }, []);

  if (!hasThisInstanceClaim.current) {
    return null;
  }
  
  const opacity = isLoaderLoading ? 0 : 0.99;
  
  return (
    <div
      ref={wrapperRef}
      className={`fixed inset-0 z-10 pointer-events-none`}
      style={{ 
        opacity: opacity,
        visibility: isLoaderLoading ? 'hidden' : 'visible',
        willChange: 'opacity',
        backfaceVisibility: 'hidden',
        WebkitBackfaceVisibility: 'hidden',
        transform: 'translate3d(0, 0, 0)',
      }}
    >
      <canvas
        ref={canvasRef}
        id="paint-drip-canvas"
        style={{ 
          width: "100vw", 
          height: "100vh", 
          display: "block",
          willChange: 'contents',
          backfaceVisibility: 'hidden',
          WebkitBackfaceVisibility: 'hidden',
        }}
      />

    </div>
  );
}
