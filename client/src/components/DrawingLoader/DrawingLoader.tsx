"use client";

import { motion, useAnimation } from "framer-motion";
import { useEffect } from "react";
import Image from "next/image";
import CanvasReveal from "./CanvasReveal";
import { LoaderConfig } from "../../contexts/LoaderContext";

interface DrawingLoaderProps {
  children?: React.ReactNode;
  config?: LoaderConfig;
  onComplete?: () => void;
  onZoomComplete?: () => void;
  onPreWarm?: () => void;
}

export default function DrawingLoader({ 
  children, 
  config,
  onComplete,
  onZoomComplete,
  onPreWarm
}: DrawingLoaderProps) {
  const transformOriginX = "50.75%";
  const transformOriginY = "36%";

  const zoomDelay = (config?.zoomDelay ?? 3);
  const zoomDuration = (config?.zoomDuration ?? 3.5);
  const fadeDelay = (config?.fadeDelay ?? 6);
  const fadeDuration = (config?.fadeDuration ?? 0.8);
  const finalScale = config?.showLoader !== false ? 7.8 : 1;
  const entranceDuration = 0.6;

  const content = children || config?.content || null;
  const containerControls = useAnimation();
  const sceneControls = useAnimation();

  useEffect(() => {
    sceneControls.start({
      opacity: 1,
      scale: 1,
      transition: {
        duration: entranceDuration,
        ease: [0.25, 0.1, 0.25, 1],
      }
    });

    containerControls.start({
      opacity: 1,
      transition: {
        duration: entranceDuration,
        ease: [0.25, 0.1, 0.25, 1],
      }
    });

    const preWarmTime = fadeDelay * 0.9 * 1000;
    const preWarmTimer = setTimeout(() => {
      onPreWarm?.();
      config?.onPreWarm?.();
    }, preWarmTime);

    const zoomCompleteTime = (zoomDelay + zoomDuration) * 1000;
    const zoomCompleteTimer = setTimeout(() => {
      onZoomComplete?.();
      config?.onZoomComplete?.();
    }, zoomCompleteTime);

    const fadeOutTimer = setTimeout(() => {
      containerControls.start({
        opacity: 0,
        transition: {
          duration: fadeDuration,
          ease: [0.25, 0.1, 0.25, 1],
          onComplete: onComplete
        }
      });
    }, fadeDelay * 1000);

    return () => {
      clearTimeout(fadeOutTimer);
      clearTimeout(zoomCompleteTimer);
      clearTimeout(preWarmTimer);
    };
  }, [containerControls, sceneControls, fadeDelay, fadeDuration, entranceDuration, zoomDelay, zoomDuration, onComplete, onZoomComplete, onPreWarm, config]);

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={containerControls}
      className="fixed inset-0 z-[9999] flex items-center justify-center"
      style={{ 
        backgroundColor: "#f5f5f5", 
        backdropFilter: "none",
        pointerEvents: "none",
        willChange: "opacity",
        transform: "translateZ(0)",
        mixBlendMode: "normal",
      }}
    >
      <motion.div
        initial={{ opacity: 0, scale: 0.96 }}
        animate={sceneControls}
        className="relative"
        style={{
          transformOrigin: "center center",
          willChange: "transform, opacity",
          backfaceVisibility: "hidden",
          WebkitBackfaceVisibility: "hidden",
          perspective: 1000,
          transform: "translateZ(0)",
        }}
      >
        <motion.div
          initial={{ scale: 1 }}
          animate={{ scale: finalScale }}
          transition={{ 
            delay: zoomDelay, 
            duration: zoomDuration, 
            ease: [0.2, 0.0, 0.3, 1] 
          }}
          style={{
            transformOrigin: `${transformOriginX} ${transformOriginY}`,
            willChange: "transform",
            backfaceVisibility: "hidden",
            WebkitBackfaceVisibility: "hidden",
          }}
        >
          <Image
            src="/images/loader-leaf-horizontal.png"
            width={420}
            height={420}
            alt="Easel"
            priority
          />

          {content && (
            <div
              style={{
                position: "absolute",
                top: "25%",
                left: "28%",
                width: "45.5%",
                height: "26%",
                overflow: "hidden",
              }}
            >
              <CanvasReveal>
                {content}
              </CanvasReveal>
            </div>
          )}
        </motion.div>
      </motion.div>
    </motion.div>
  );
}
