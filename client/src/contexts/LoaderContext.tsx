'use client';

import React, { createContext, useContext, useEffect, useState, useCallback, useRef } from 'react';

export type LoaderConfig = {
  zoomDelay?: number;
  zoomDuration?: number;
  fadeDelay?: number;
  fadeDuration?: number;
  content?: React.ReactNode;
  onStart?: () => void;
  onComplete?: () => void;
  onZoomComplete?: () => void;
  onPreWarm?: () => void;
  showLoader?: boolean;
  skipOnInitialLoad?: boolean;
};

type LoaderContextType = {
  isLoading: boolean;
  loaderConfig: LoaderConfig | null;
  startLoader: (config?: LoaderConfig) => void;
  stopLoader: () => void;
  setLoaderConfig: (config: LoaderConfig | null) => void;
};

/** Full home-intro defaults (~6.8s). Non-home routes should skip or pass short overrides. */
export const HOME_LOADER_DEFAULTS: Required<
  Pick<LoaderConfig, 'zoomDelay' | 'zoomDuration' | 'fadeDelay' | 'fadeDuration' | 'showLoader' | 'skipOnInitialLoad'>
> = {
  zoomDelay: 3,
  zoomDuration: 3.5,
  fadeDelay: 6,
  fadeDuration: 0.8,
  showLoader: true,
  skipOnInitialLoad: false,
};

/** Short transition for rare routes that still want a loader (not gallery/auth). */
export const SHORT_LOADER_DEFAULTS: Required<
  Pick<LoaderConfig, 'zoomDelay' | 'zoomDuration' | 'fadeDelay' | 'fadeDuration' | 'showLoader' | 'skipOnInitialLoad'>
> = {
  zoomDelay: 0.15,
  zoomDuration: 0.35,
  fadeDelay: 0.45,
  fadeDuration: 0.25,
  showLoader: true,
  skipOnInitialLoad: false,
};

const LoaderContext = createContext<LoaderContextType | undefined>(undefined);

export const LoaderProvider = ({ children }: { children: React.ReactNode }) => {
  const [isLoading, setIsLoading] = useState(false);
  const [loaderConfig, setLoaderConfig] = useState<LoaderConfig | null>(null);
  const isInitialMount = useRef(true);
  const completeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const startLoader = useCallback((config: LoaderConfig = {}) => {
    const finalConfig: LoaderConfig = {
      ...HOME_LOADER_DEFAULTS,
      ...config,
    };

    if (finalConfig.skipOnInitialLoad && isInitialMount.current) {
      isInitialMount.current = false;
      return;
    }

    if (completeTimerRef.current) {
      clearTimeout(completeTimerRef.current);
      completeTimerRef.current = null;
    }

    setLoaderConfig(finalConfig);
    setIsLoading(true);
    finalConfig.onStart?.();

    const totalDuration = (finalConfig.fadeDelay || 6) + (finalConfig.fadeDuration || 0.8);

    completeTimerRef.current = setTimeout(() => {
      setIsLoading(false);
      finalConfig.onComplete?.();
      setTimeout(() => {
        setLoaderConfig(null);
      }, 100);
      completeTimerRef.current = null;
    }, (totalDuration + 0.1) * 1000);
  }, []);

  const stopLoader = useCallback(() => {
    if (completeTimerRef.current) {
      clearTimeout(completeTimerRef.current);
      completeTimerRef.current = null;
    }
    setIsLoading(false);
    setTimeout(() => {
      setLoaderConfig(null);
    }, 100);
  }, []);

  useEffect(() => {
    isInitialMount.current = false;
    return () => {
      if (completeTimerRef.current) {
        clearTimeout(completeTimerRef.current);
      }
    };
  }, []);

  return (
    <LoaderContext.Provider value={{
      isLoading,
      loaderConfig,
      startLoader,
      stopLoader,
      setLoaderConfig
    }}>
      {children}
    </LoaderContext.Provider>
  );
};

export const useLoaderContext = () => {
  const context = useContext(LoaderContext);
  if (context === undefined) {
    throw new Error('useLoaderContext must be used within a LoaderProvider');
  }
  return context;
};
