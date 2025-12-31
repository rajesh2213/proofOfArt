"use client";

import { useEffect, useState, useRef } from "react";
import { usePathname, useRouter } from "next/navigation";
import { AnimatePresence, motion } from "framer-motion";
import { useLoaderContext } from "../../contexts/LoaderContext";
import DrawingLoader from "./DrawingLoader";
import { preloadTransitionAssets, preloadRouteAssets } from "../../utils/assetPreloader";

interface PageTransitionWrapperProps {
  children: React.ReactNode;
}

const isAuthPage = (path: string | null): boolean => {
  return path === "/login" || path === "/register";
};

export default function PageTransitionWrapper({ children }: PageTransitionWrapperProps) {
  const pathname = usePathname();
  const router = useRouter();
  const { isLoading, loaderConfig, startLoader, stopLoader } = useLoaderContext();
  const [showContent, setShowContent] = useState(false);
  const [currentContent, setCurrentContent] = useState<React.ReactNode>(children);
  const previousPathname = useRef<string | null>(null);
  const hasCheckedInitialMount = useRef(false);
  const [isAuthTransition, setIsAuthTransition] = useState(false);
  const [slideDirection, setSlideDirection] = useState<"left" | "right">("right");
  const loaderRef = useRef<HTMLDivElement>(null);
  const preloadPromiseRef = useRef<Promise<void> | null>(null);
  
  useEffect(() => {
    if (typeof window !== 'undefined') {
      preloadTransitionAssets();
    }
  }, []);

  useEffect(() => {
    if (typeof window !== 'undefined') {
      const routesToPrefetch = ['/gallery', '/upload-art', '/login', '/register'];
      routesToPrefetch.forEach(route => {
        if (route !== pathname) {
          router.prefetch(route);
        }
      });
    }
  }, [pathname, router]);

  useEffect(() => {
    if (!hasCheckedInitialMount.current) {
      hasCheckedInitialMount.current = true;
      const storedPreviousPath = typeof window !== 'undefined' 
        ? sessionStorage.getItem('previousPathname') 
        : null;
      
      if (storedPreviousPath && storedPreviousPath !== pathname) {
        const isAuthPageTransition = isAuthPage(storedPreviousPath) && isAuthPage(pathname);
        
        previousPathname.current = storedPreviousPath;
        
        if (isAuthPageTransition) {
          setIsAuthTransition(true);
          setSlideDirection(storedPreviousPath === "/login" ? "right" : "left");
          setCurrentContent(children);
          setShowContent(true);
        } else {
          setCurrentContent(children);
          setIsAuthTransition(false);
          
          preloadRouteAssets(pathname).catch(() => {
          });
          
          if (!isLoading) {
            startLoader({
              content: children,
              onStart: () => {
                setShowContent(false);
              },
              onComplete: () => {
                setShowContent(true);
              },
            });
          }
        }
      } else {
        previousPathname.current = pathname;
        setIsAuthTransition(false);
      }
      
      if (typeof window !== 'undefined') {
        sessionStorage.setItem('previousPathname', pathname);
      }
      return;
    }

    if (previousPathname.current !== pathname) {
      const isAuthPageTransition = isAuthPage(previousPathname.current) && isAuthPage(pathname);
      
      if (isAuthPageTransition) {
        setIsAuthTransition(true);
        setSlideDirection(previousPathname.current === "/login" ? "right" : "left");
        setCurrentContent(children);
        setShowContent(true);
      } else {
        setCurrentContent(children);
        setIsAuthTransition(false);
        
        preloadRouteAssets(pathname).catch(() => {
        });
        
        if (!isLoading) {
          startLoader({
            content: children,
            onStart: () => {
              setShowContent(false);
            },
            onComplete: () => {
              setShowContent(true);
            },
          });
        }
      }
      
      previousPathname.current = pathname;
      
      if (typeof window !== 'undefined') {
        sessionStorage.setItem('previousPathname', pathname);
      }
    }
  }, [pathname, children, startLoader, isLoading]);

  useEffect(() => {
    if (isAuthTransition) {
      setShowContent(true);
    } else if (isLoading) {
      const fadeDelay = (loaderConfig?.fadeDelay ?? 6) * 1000;
      setTimeout(() => {
        setShowContent(true);
      }, fadeDelay);
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
        <div style={{ 
          position: "fixed",
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          width: "100vw",
          height: "100vh",
          overflow: "hidden",
          zIndex: 0,
          backgroundColor: "transparent"
        }}>
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
                willChange: "transform"
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
 
