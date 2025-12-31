"use client";

import { useState, useEffect, useRef } from "react";
import { usePathname } from "next/navigation";
import { useLoaderContext } from "../../contexts/LoaderContext";
import HomePageClient from "./HomePageClient";
import { useUI } from "../../contexts/UIContext";

export default function HomePageShell() {
  const pathname = usePathname();
  const { startLoader, isLoading } = useLoaderContext();
  const [showSite, setShowSite] = useState(false);
  const preloadVideoRef = useRef<HTMLImageElement | null>(null);
  const preloadImageRef = useRef<HTMLImageElement | null>(null);
  const loaderStartedRef = useRef(false);
  const previousPathnameRef = useRef<string | null>(null);
  const { setPaintDripState, setIsScrollSceneActive, paintDripState, isScrollSceneActive } = useUI();


  useEffect(() => {
    const spriteSheetPaths = [
      "/spritesheets/paint_drip_spritesheets/sheet_1.webp",
      "/spritesheets/paint_drip_spritesheets/sheet_2.webp",
      "/spritesheets/paint_drip_spritesheets/sheet_3.webp",
    ];

    const loadedSheets: HTMLImageElement[] = [];

    spriteSheetPaths.forEach((path, index) => {
      const spriteSheet = new window.Image();
      spriteSheet.crossOrigin = "anonymous";
      spriteSheet.loading = "eager";

      spriteSheet.onload = () => {
        loadedSheets[index] = spriteSheet;
        if (index === 0) {
          preloadVideoRef.current = spriteSheet as any;
        }
      };

      spriteSheet.src = path;

      if (spriteSheet.complete && spriteSheet.naturalWidth > 0) {
        loadedSheets[index] = spriteSheet;
        if (index === 0) {
          preloadVideoRef.current = spriteSheet as any;
        }
      }
    });

    if (typeof document !== 'undefined') {
      spriteSheetPaths.forEach(path => {
        const link = document.createElement('link');
        link.rel = 'preload';
        link.as = 'image';
        link.href = path;
        link.crossOrigin = "anonymous";
        document.head.appendChild(link);
      });
    }

    const img = new window.Image();
    img.src = "/images/5177180.jpg";
    img.loading = "eager";
    preloadImageRef.current = img;
  }, []);

  useEffect(() => {
    const previousPathname = previousPathnameRef.current;
    previousPathnameRef.current = pathname;
    
    if (pathname && pathname !== '/') {
      setShowSite(false);
      loaderStartedRef.current = false;
      return;
    }
      
    const isTransitioningToHome = pathname === '/' && previousPathname !== '/';
    if (isTransitioningToHome) {
      loaderStartedRef.current = false;
    }
    
    if (isLoading) {
      setShowSite(true);
      return;
    }
    
    if (loaderStartedRef.current) return;
    
    loaderStartedRef.current = true;
    
    startLoader({
      content: <HomePageClient key="homepage-loader" isInLoader={true} />,
      zoomDelay: 3,
      zoomDuration: 3.5,
      fadeDelay: 6,
      fadeDuration: 2,
      skipOnInitialLoad: false,
      onStart: () => {
        setPaintDripState(0);
        setShowSite(true);
      },
      onComplete: () => {
      },
    });
  }, [pathname, startLoader, isLoading, setPaintDripState]);

  const [shouldShowMain, setShouldShowMain] = useState(false);
  const [isPreWarmed, setIsPreWarmed] = useState(false);
  const [zoomComplete, setZoomComplete] = useState(false);
  const startEntranceAnimationsRef = useRef<(() => void) | null>(null);
  
  useEffect(() => {
    if (pathname === '/' || !pathname) {
      const preWarmTimer = setTimeout(() => {
        setIsPreWarmed(true);
      }, 5400); // fadeDelay * 0.9 * 1000
      
      const backgroundChangeTimer = setTimeout(() => {
        setPaintDripState(1);
        setIsScrollSceneActive(true);
      }, 6000); // fadeDelay * 1000
      
      const zoomCompleteTimer = setTimeout(() => {
        setZoomComplete(true);
        if (startEntranceAnimationsRef.current) {
          startEntranceAnimationsRef.current();
        }
      }, 6500); // (zoomDelay + zoomDuration) * 1000 
      
      return () => {
        clearTimeout(preWarmTimer);
        clearTimeout(backgroundChangeTimer);
        clearTimeout(zoomCompleteTimer);
      };
    } else {
      setShouldShowMain(false);
      setIsPreWarmed(false);
      setZoomComplete(false);
    }
  }, [pathname, setPaintDripState, setIsScrollSceneActive]);

  const isMainComponentVisible = showSite && isPreWarmed;
  const allowPointerEvents = zoomComplete;

  return (
    <>
      {showSite && (
        <div
          style={{
            position: "fixed",
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            minHeight: "100vh",
            zIndex: isMainComponentVisible ? 1 : -1,
            opacity: isMainComponentVisible ? 1 : 0,
            visibility: isMainComponentVisible ? "visible" : "hidden",
            pointerEvents: allowPointerEvents ? "auto" : "none",
            transition: "none",
            backgroundColor: "#fce3e7",
          }}
        >
          <HomePageClient 
            key="homepage-main" 
            isInLoader={false} 
            delayAnimations={false} 
            isVisible={isMainComponentVisible}
            startEntranceAnimationsRef={startEntranceAnimationsRef}
            zoomComplete={zoomComplete}
          />
        </div>
      )}
    </>
  );
}
