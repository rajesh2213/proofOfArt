"use client";

import { AnimatePresence } from "framer-motion";
import { useLoaderContext } from "../../contexts/LoaderContext";
import DrawingLoader from "./DrawingLoader";

export default function GlobalLoader() {
  const { isLoading, loaderConfig } = useLoaderContext();

  return (
    <AnimatePresence mode="wait">
      {isLoading && loaderConfig && (
        <DrawingLoader 
          key="global-loader"
          config={loaderConfig}
          onZoomComplete={loaderConfig.onZoomComplete}
          onPreWarm={loaderConfig.onPreWarm}
        >
          {loaderConfig.content}
        </DrawingLoader>
      )}
    </AnimatePresence>
  );
}

