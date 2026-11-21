"use client";

import { useEffect, useState, useRef } from "react";
import { usePathname, useRouter } from "next/navigation";
import { AnimatePresence, motion } from "framer-motion";
import { useLoaderContext, SHORT_LOADER_DEFAULTS } from "../../contexts/LoaderContext";
import DrawingLoader from "./DrawingLoader";
import { preloadTransitionAssets, preloadRouteAssets } from "../../utils/assetPreloader";

interface PageTransitionWrapperProps {
  children: React.ReactNode;
}

const isAuthPage = (path: string | null): boolean => {
  return path === "/login" || path === "/register";
};

/** Skip heavy DrawingLoader on gallery/auth/upload/detail — home uses HomePageShell's own loader. */
const shouldSkipDrawingLoader = (path: string | null): boolean => {
  if (!path) return true;
  if (path === "/") return true;
  if (isAuthPage(path)) return true;
  if (
    path.startsWith("/gallery") ||
    path.startsWith("/upload") ||
    path.startsWith("/artwork") ||
    path.startsWith("/claims")
  ) {
    return true;
  }
  return false;
};

export default function PageTransitionWrapper({ children }: PageTransitionWrapperProps) {
  const pathname = usePathname();
  const router = useRouter();
  const { isLoading, loaderConfig, startLoader, stopLoader } = useLoaderContext();
  const [showContent, setShowContent] = useState(true);
  const [currentContent, setCurrentContent] = useState<React.ReactNode>(children);
  const previousPathname = useRef<string | null>(null);
  const hasCheckedInitialMount = useRef(false);
  const [isAuthTransition, setIsAuthTransition] = useState(false);
  const [slideDirection, setSlideDirection] = useState<"left" | "right">("right");

  useEffect(() => {
    if (typeof window !== "undefined" && pathname === "/") {
      const schedule =
        "requestIdleCallback" in window
          ? (cb: () => void) => requestIdleCallback(cb, { timeout: 2500 })
          : (cb: () => void) => window.setTimeout(cb, 800);
      schedule(() => {
        preloadTransitionAssets().catch(() => {});
      });
    }
  }, [pathname]);

  useEffect(() => {
    if (typeof window !== "undefined") {
      const routesToPrefetch = ["/gallery", "/upload-art", "/login", "/register"];
      routesToPrefetch.forEach((route) => {
        if (route !== pathname) {
          router.prefetch(route);
        }
      });
    }
  }, [pathname, router]);

  const beginRouteTransition = (nextPath: string, nextChildren: React.ReactNode) => {
    const prev = previousPathname.current;
    const isAuthPageTransition = isAuthPage(prev) && isAuthPage(nextPath);

    if (isAuthPageTransition) {
      setIsAuthTransition(true);
      setSlideDirection(prev === "/login" ? "right" : "left");
      setCurrentContent(nextChildren);
      setShowContent(true);
      return;
    }

    setIsAuthTransition(false);
    setCurrentContent(nextChildren);

    if (shouldSkipDrawingLoader(nextPath)) {
      setShowContent(true);
      preloadRouteAssets(nextPath).catch(() => {});
      return;
    }

    preloadRouteAssets(nextPath).catch(() => {});

    if (!isLoading) {
      startLoader({
        ...SHORT_LOADER_DEFAULTS,
        content: nextChildren,
        onStart: () => {
          setShowContent(false);
        },
        onComplete: () => {
          setShowContent(true);
        },
      });
    }
  };

  useEffect(() => {
    if (!hasCheckedInitialMount.current) {
      hasCheckedInitialMount.current = true;
      const storedPreviousPath =
        typeof window !== "undefined" ? sessionStorage.getItem("previousPathname") : null;

      if (storedPreviousPath && storedPreviousPath !== pathname) {
        previousPathname.current = storedPreviousPath;
        beginRouteTransition(pathname, children);
      } else {
        previousPathname.current = pathname;
        setIsAuthTransition(false);
        setCurrentContent(children);
        setShowContent(true);
      }

      if (typeof window !== "undefined") {
        sessionStorage.setItem("previousPathname", pathname);
      }
      return;
    }

    if (previousPathname.current !== pathname) {
      beginRouteTransition(pathname, children);
      previousPathname.current = pathname;

      if (typeof window !== "undefined") {
        sessionStorage.setItem("previousPathname", pathname);
      }
    } else {
      setCurrentContent(children);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentional: drive on pathname changes
  }, [pathname, children, startLoader, isLoading]);

  useEffect(() => {
    if (isAuthTransition) {
      setShowContent(true);
    } else if (isLoading) {
      const fadeDelay = (loaderConfig?.fadeDelay ?? 0.45) * 1000;
      const t = setTimeout(() => {
        setShowContent(true);
      }, fadeDelay);
      return () => clearTimeout(t);
    } else {
      setShowContent(true);
    }
  }, [isLoading, loaderConfig, isAuthTransition]);

  const slideVariants = {
    enter: (direction: "left" | "right") => ({
      x: direction === "right" ? "100%" : "-100%",
      opacity: 0,
    }),
    center: {
      x: 0,
      opacity: 1,
    },
    exit: (direction: "left" | "right") => ({
      x: direction === "right" ? "-100%" : "100%",
      opacity: 0,
    }),
  };

  return (
    <>
      <AnimatePresence mode="wait">
        {isLoading && loaderConfig && !isAuthTransition && (
          <DrawingLoader
            key="page-transition-loader"
            config={loaderConfig}
            onComplete={() => {
              stopLoader();
            }}
          >
            {loaderConfig.content || currentContent}
          </DrawingLoader>
        )}
      </AnimatePresence>

      {isAuthTransition ? (
        <div
          style={{
            position: "fixed",
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            width: "100vw",
            height: "100vh",
            overflow: "hidden",
            zIndex: 0,
            backgroundColor: "transparent",
          }}
        >
          <AnimatePresence custom={slideDirection}>
            <motion.div
              key={pathname}
              custom={slideDirection}
              variants={slideVariants}
              initial="enter"
              animate="center"
              exit="exit"
              transition={{
                x: { type: "spring", stiffness: 300, damping: 30 },
                opacity: { duration: 0.2 },
              }}
              style={{
                width: "100%",
                height: "100%",
                position: "absolute",
                top: 0,
                left: 0,
                right: 0,
                bottom: 0,
                willChange: "transform",
              }}
            >
              {currentContent}
            </motion.div>
          </AnimatePresence>
        </div>
      ) : (
        <div
          style={{
            opacity: showContent ? 1 : 0,
            transition: "opacity 0.3s ease-in-out",
            willChange: showContent ? "auto" : "opacity",
          }}
        >
          {currentContent}
        </div>
      )}
    </>
  );
}
