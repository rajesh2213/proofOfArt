"use client";

import { useEffect, useRef } from "react";
import { usePathname } from "next/navigation";
import { useLoaderContext } from "../contexts/LoaderContext";

export function usePageTransition(content?: React.ReactNode) {
  const pathname = usePathname();
  const { startLoader } = useLoaderContext();
  const previousPathname = useRef<string | null>(null);

  useEffect(() => {
    if (previousPathname.current === null) {
      previousPathname.current = pathname;
      return;
    }

    if (previousPathname.current !== pathname && content) {
      previousPathname.current = pathname;
      startLoader({
        content,
        zoomDelay: 3,
        zoomDuration: 3.5,
        fadeDelay: 6,
        fadeDuration: 0.8,
      });
    }
  }, [pathname, content, startLoader]);
}

