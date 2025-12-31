"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import PaintDripSpriteSheet from "./PaintDripSpriteSheet";
import { useUI } from "../../contexts/UIContext";

export default function PersistentPaintDrip() {
  const pathname = usePathname();
  const { paintDripState } = useUI();
  const [isMounted, setIsMounted] = useState(false);

  useEffect(() => {
    setIsMounted(true);
  }, []);

  const shouldShow = 
    isMounted &&
    (pathname === '/' || pathname === '/upload-art') && 
    paintDripState >= 1;

  if (!shouldShow) return null;

  return <PaintDripSpriteSheet />;
}

