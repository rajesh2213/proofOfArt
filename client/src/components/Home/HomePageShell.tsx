"use client";

import { useState, useEffect, useRef } from "react";
import { usePathname } from "next/navigation";
import { useLoaderContext } from "../../contexts/LoaderContext";
import HomePageClient from "./HomePageClient";
import { useUI } from "../../contexts/UIContext";

/** Lightweight easel preview — avoids mounting a second HomePageClient during the loader. */
function LoaderEaselPreview() {
  return (
    <div
      style={{
        width: "100%",
        height: "100%",
        background: "linear-gradient(160deg, #fce3e7 0%, #f5d0d8 100%)",
      }}
    />
  );
}

export default function HomePageShell() {
  const pathname = usePathname();
  const { startLoader, isLoading } = useLoaderContext();
  const [showSite, setShowSite] = useState(false);
  const loaderStartedRef = useRef(false);
  const previousPathnameRef = useRef<string | null>(null);
  const { setPaintDripState, setIsScrollSceneActive } = useUI();

  // Defer heavy sprite/image preload until idle (after first paint / loader start)
  useEffect(() => {
    if (pathname && pathname !== "/") return;

    let cancelled = false;
    const spriteSheetPaths = [
      "/spritesheets/paint_drip_spritesheets/sheet_1.webp",
      "/spritesheets/paint_drip_spritesheets/sheet_2.webp",
      "/spritesheets/paint_drip_spritesheets/sheet_3.webp",
    ];

    const preload = () => {
      if (cancelled || typeof window === "undefined") return;

      spriteSheetPaths.forEach((path) => {
        const spriteSheet = new window.Image();
        spriteSheet.decoding = "async";
        spriteSheet.src = path;
      });

      const img = new window.Image();
      img.decoding = "async";
      img.src = "/images/5177180.jpg";

      spriteSheetPaths.forEach((path) => {
        if (document.querySelector(`link[rel="preload"][href="${path}"]`)) return;
        const link = document.createElement("link");
        link.rel = "preload";
        link.as = "image";
        link.href = path;
        link.crossOrigin = "anonymous";
        document.head.appendChild(link);
      });
    };

    let idleId: number | null = null;
    let timeoutId: ReturnType<typeof setTimeout> | null = null;

    if ("requestIdleCallback" in window) {
      idleId = requestIdleCallback(preload, { timeout: 4000 }) as unknown as number;
    } else {
      timeoutId = setTimeout(preload, 1200);
    }

    return () => {
      cancelled = true;
      if (idleId != null && "cancelIdleCallback" in window) {
        cancelIdleCallback(idleId);
      }
      if (timeoutId) clearTimeout(timeoutId);
    };
  }, [pathname]);

  useEffect(() => {
    const previousPathname = previousPathnameRef.current;
    previousPathnameRef.current = pathname;

    if (pathname && pathname !== "/") {
      setShowSite(false);
      loaderStartedRef.current = false;
      return;
    }

    const isTransitioningToHome = pathname === "/" && previousPathname !== "/";
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
      content: <LoaderEaselPreview />,
      zoomDelay: 3,
      zoomDuration: 3.5,
      fadeDelay: 6,
      fadeDuration: 2,
      skipOnInitialLoad: false,
      onStart: () => {
        setPaintDripState(0);
        setShowSite(true);
      },
      onComplete: () => {},
    });
  }, [pathname, startLoader, isLoading, setPaintDripState]);

  const [isPreWarmed, setIsPreWarmed] = useState(false);
  const [zoomComplete, setZoomComplete] = useState(false);
  const startEntranceAnimationsRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    if (pathname === "/" || !pathname) {
      const preWarmTimer = setTimeout(() => {
        setIsPreWarmed(true);
      }, 5400);

      const backgroundChangeTimer = setTimeout(() => {
        setPaintDripState(1);
        setIsScrollSceneActive(true);
      }, 6000);

      const zoomCompleteTimer = setTimeout(() => {
        setZoomComplete(true);
        if (startEntranceAnimationsRef.current) {
          startEntranceAnimationsRef.current();
        }
      }, 6500);

      return () => {
        clearTimeout(preWarmTimer);
        clearTimeout(backgroundChangeTimer);
        clearTimeout(zoomCompleteTimer);
      };
    } else {
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
