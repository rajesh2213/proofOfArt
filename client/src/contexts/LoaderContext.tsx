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

const LoaderContext = createContext<LoaderContextType | undefined>(undefined);

export const LoaderProvider = ({ children }: { children: React.ReactNode }) => {
  const [isLoading, setIsLoading] = useState(false);
  const [loaderConfig, setLoaderConfig] = useState<LoaderConfig | null>(null);
  const isInitialMount = useRef(true);

  const startLoader = useCallback((config: LoaderConfig = {}) => {
    const finalConfig: LoaderConfig = {
      zoomDelay: 3,
      zoomDuration: 3.5,
      fadeDelay: 6,
      fadeDuration: 0.8,
      showLoader: true,
      skipOnInitialLoad: false,
      ...config,
    };

    if (finalConfig.skipOnInitialLoad && isInitialMount.current) {
      isInitialMount.current = false;
      return;
    }

    setLoaderConfig(finalConfig);
    setIsLoading(true);
    finalConfig.onStart?.();

    const totalDuration = (finalConfig.fadeDelay || 6) + (finalConfig.fadeDuration || 0.8);

    setTimeout(() => {
      setIsLoading(false);
      finalConfig.onComplete?.();
      setTimeout(() => {
        setLoaderConfig(null);
      }, 100);
    }, (totalDuration + 0.1) * 1000);
  }, []);

  const stopLoader = useCallback(() => {
    setIsLoading(false);
    setTimeout(() => {
      setLoaderConfig(null);
    }, 100);
  }, []);

  useEffect(() => {
    isInitialMount.current = false;
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
