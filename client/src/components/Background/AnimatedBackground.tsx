"use client";
import { useEffect, useRef } from "react";

export default function GooeyBackground() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    
    const ctx = canvas.getContext("2d", { alpha: true })!;
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";

    const MAX_WIDTH = 1920;
    const MAX_HEIGHT = 1080;
    
    let displayW = window.innerWidth;
    let displayH = window.innerHeight;
    
    let w = Math.min(displayW, MAX_WIDTH);
    let h = Math.min(displayH, MAX_HEIGHT);
    
    if (displayW > MAX_WIDTH || displayH > MAX_HEIGHT) {
      const aspect = displayW / displayH;
      if (w / h > aspect) {
        w = h * aspect;
      } else {
        h = w / aspect;
      }
    }
    
    canvas.width = w;
    canvas.height = h;

    const mouse = { x: w / 2, y: h / 2 };

    const tempCanvas = document.createElement("canvas");
    tempCanvas.width = w;
    tempCanvas.height = h;
    const tempCtx = tempCanvas.getContext("2d")!;
    tempCtx.imageSmoothingEnabled = true;
    tempCtx.imageSmoothingQuality = "high";

    const maskCanvas = document.createElement("canvas");
    maskCanvas.width = w;
    maskCanvas.height = h;
    const maskCtx = maskCanvas.getContext("2d")!;
    maskCtx.imageSmoothingEnabled = true;
    maskCtx.imageSmoothingQuality = "high";

    const blurPadding = 150;
    const paddedBlurCanvas = document.createElement("canvas");
    paddedBlurCanvas.width = w + blurPadding * 2;
    paddedBlurCanvas.height = h + blurPadding * 2;
    const paddedBlurCtx = paddedBlurCanvas.getContext("2d")!;

    const tempBlurCanvas = document.createElement("canvas");
    tempBlurCanvas.width = w + blurPadding * 2;
    tempBlurCanvas.height = h + blurPadding * 2;
    const tempBlurCtx = tempBlurCanvas.getContext("2d")!;

    const blurredMaskCanvas = document.createElement("canvas");
    blurredMaskCanvas.width = w;
    blurredMaskCanvas.height = h;
    const blurredMaskCtx = blurredMaskCanvas.getContext("2d")!;
    blurredMaskCtx.imageSmoothingEnabled = true;
    blurredMaskCtx.imageSmoothingQuality = "high";

    const revealImage = new Image();
    revealImage.src = "/images/star-ai-edited.png";
    let imageLoaded = false;
    revealImage.onload = () => {
      imageLoaded = true;
    };

    const BLOBS = 8; 
    let time = 0;

    const blobs = Array.from({ length: BLOBS }, () => ({
      x: Math.random() * w,
      y: Math.random() * h,
      r: 120 + Math.random() * 180,
      vx: (Math.random() - 0.5) * 0.8,
      vy: (Math.random() - 0.5) * 0.8,
      baseR: 120 + Math.random() * 180,
      phase: Math.random() * Math.PI * 2,
      noiseOffset: Math.random() * 1000,
    }));

    let animationFrameId: number;

    function noise(x: number, y: number, t: number): number {
      return Math.sin(x * 0.01 + t) * Math.cos(y * 0.01 + t * 0.7) * 0.5 + 0.5;
    }

    function draw() {
      if (!imageLoaded) {
        animationFrameId = requestAnimationFrame(draw);
        return;
      }

      time += 0.01;

      for (let i = 0; i < blobs.length; i++) {
        const b = blobs[i];
        
        const mouseDx = b.x - mouse.x;
        const mouseDy = b.y - mouse.y;
        const mouseDist = Math.hypot(mouseDx, mouseDy);
        const interactionRange = b.r * 5;

        if (mouseDist < interactionRange && mouseDist > 0) {
          const normalizedDist = mouseDist / interactionRange;
          const repulsionStrength = (1 - normalizedDist) * 2.5;
          const push = repulsionStrength * 0.8;
          
          b.vx += (mouseDx / mouseDist) * push;
          b.vy += (mouseDy / mouseDist) * push;
        }

        for (let j = i + 1; j < blobs.length; j++) {
          const other = blobs[j];
          const dx = b.x - other.x;
          const dy = b.y - other.y;
          const dist = Math.hypot(dx, dy);
          const minDist = (b.r + other.r) * 0.6;
          const maxDist = (b.r + other.r) * 1.5;

          if (dist > 0 && dist < maxDist) {
            const force = dist < minDist 
              ? (minDist - dist) * 0.15
              : (maxDist - dist) * 0.02;
            
            const fx = (dx / dist) * force;
            const fy = (dy / dist) * force;
            
            b.vx += fx;
            b.vy += fy;
            other.vx -= fx;
            other.vy -= fy;
          }
        }

        const n = noise(b.x, b.y, time + b.noiseOffset);
        const angle = n * Math.PI * 2;
        const floatStrength = 0.1;
        b.vx += Math.cos(angle) * floatStrength * 0.02;
        b.vy += Math.sin(angle) * floatStrength * 0.02;

        b.vx *= 0.98;
        b.vy *= 0.98;
        
        const maxVel = 6;
        const vel = Math.hypot(b.vx, b.vy);
        if (vel > maxVel) {
          b.vx = (b.vx / vel) * maxVel;
          b.vy = (b.vy / vel) * maxVel;
        }

        b.x += b.vx;
        b.y += b.vy;
        b.r = b.baseR;

        const wrapBuffer = 300;
        if (b.x < -wrapBuffer) b.x = w + wrapBuffer;
        if (b.x > w + wrapBuffer) b.x = -wrapBuffer;
        if (b.y < -wrapBuffer) b.y = h + wrapBuffer;
        if (b.y > h + wrapBuffer) b.y = -wrapBuffer;
      }

      ctx.clearRect(0, 0, w, h);

      maskCtx.clearRect(0, 0, w, h);
      maskCtx.globalCompositeOperation = "source-over";

      for (const b of blobs) {
        const gradient = maskCtx.createRadialGradient(b.x, b.y, b.r * 0.3, b.x, b.y, b.r * 1.2);
        gradient.addColorStop(0, "rgba(255, 255, 255, 1)");
        gradient.addColorStop(0.4, "rgba(255, 255, 255, 0.95)");
        gradient.addColorStop(0.7, "rgba(255, 255, 255, 0.7)");
        gradient.addColorStop(1, "rgba(255, 255, 255, 0)");
        
        maskCtx.fillStyle = gradient;
        maskCtx.beginPath();
        maskCtx.arc(b.x, b.y, b.r * 1.2, 0, Math.PI * 2);
        maskCtx.fill();
      }

      paddedBlurCtx.clearRect(0, 0, paddedBlurCanvas.width, paddedBlurCanvas.height);
      paddedBlurCtx.drawImage(maskCanvas, blurPadding, blurPadding);
      paddedBlurCtx.filter = "blur(60px)";
      tempBlurCtx.clearRect(0, 0, tempBlurCanvas.width, tempBlurCanvas.height);
      tempBlurCtx.drawImage(paddedBlurCanvas, 0, 0);
      paddedBlurCtx.filter = "none";
      
      blurredMaskCtx.clearRect(0, 0, w, h);
      blurredMaskCtx.drawImage(
        tempBlurCanvas,
        blurPadding, blurPadding, w, h,
        0, 0, w, h
      );

      const tileSize = 512;
      for (let y = 0; y < h; y += tileSize) {
        for (let x = 0; x < w; x += tileSize) {
          const tileW = Math.min(tileSize, w - x);
          const tileH = Math.min(tileSize, h - y);
          const maskImageData = blurredMaskCtx.getImageData(x, y, tileW, tileH);
          const maskData = maskImageData.data;
          
          for (let i = 3; i < maskData.length; i += 4) {
            const alpha = maskData[i];
            if (alpha > 0) {
              const normalized = alpha / 255;
              const boosted = Math.pow(normalized, 0.7) * 255;
              maskData[i] = Math.min(255, boosted * 1.3);
            }
          }
          blurredMaskCtx.putImageData(maskImageData, x, y);
        }
      }

      tempCtx.clearRect(0, 0, w, h);
      tempCtx.globalCompositeOperation = "source-over";
      tempCtx.drawImage(revealImage, 0, 0, w, h);

      tempCtx.globalCompositeOperation = "destination-in";
      tempCtx.drawImage(blurredMaskCanvas, 0, 0);
      
      ctx.globalCompositeOperation = "source-over";
      ctx.globalAlpha = 1.0;
      ctx.drawImage(tempCanvas, 0, 0);

      animationFrameId = requestAnimationFrame(draw);
    }

    draw();

    const handleMouse = (e: MouseEvent) => {
      const rect = canvas.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) return;
      
      const scaleX = w / rect.width;
      const scaleY = h / rect.height;
      
      const mouseX = (e.clientX - rect.left) * scaleX;
      const mouseY = (e.clientY - rect.top) * scaleY;
      
      if (!isNaN(mouseX) && !isNaN(mouseY) && isFinite(mouseX) && isFinite(mouseY)) {
        mouse.x = mouseX;
        mouse.y = mouseY;
      }
    };

    const handleMouseEnter = (e: MouseEvent) => {
      handleMouse(e);
    };

    const handleResize = () => {
      displayW = window.innerWidth;
      displayH = window.innerHeight;
      
      let newW = Math.min(displayW, MAX_WIDTH);
      let newH = Math.min(displayH, MAX_HEIGHT);
      
      if (displayW > MAX_WIDTH || displayH > MAX_HEIGHT) {
        const aspect = displayW / displayH;
        if (newW / newH > aspect) {
          newW = newH * aspect;
        } else {
          newH = newW / aspect;
        }
      }
      
      const scaleX = newW / w;
      const scaleY = newH / h;
      for (const b of blobs) {
        b.x *= scaleX;
        b.y *= scaleY;
      }
      
      w = newW;
      h = newH;
      canvas.width = w;
      canvas.height = h;
      
      tempCanvas.width = w;
      tempCanvas.height = h;
      maskCanvas.width = w;
      maskCanvas.height = h;
      paddedBlurCanvas.width = w + blurPadding * 2;
      paddedBlurCanvas.height = h + blurPadding * 2;
      tempBlurCanvas.width = w + blurPadding * 2;
      tempBlurCanvas.height = h + blurPadding * 2;
      blurredMaskCanvas.width = w;
      blurredMaskCanvas.height = h;
    };

    window.addEventListener("mousemove", handleMouse, { passive: true });
    window.addEventListener("resize", handleResize);
    document.addEventListener("mousemove", handleMouse, { passive: true });

    return () => {
      if (animationFrameId) {
        cancelAnimationFrame(animationFrameId);
      }
      window.removeEventListener("mousemove", handleMouse);
      document.removeEventListener("mousemove", handleMouse);
      window.removeEventListener("resize", handleResize);
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      style={{
        width: "100vw",
        height: "100vh",
        position: "fixed",
        inset: 0,
        zIndex: 2,
        pointerEvents: "none",
      }}
    />
  );
}
