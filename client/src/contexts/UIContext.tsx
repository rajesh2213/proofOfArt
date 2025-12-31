"use client";

import { createContext, useContext, useState } from "react";

type UIContextType = {
  isScrollSceneActive: boolean;
  setIsScrollSceneActive: (v: boolean) => void;
  paintDripState: 0 | 1 | 2 | 3;
  setPaintDripState: (v: 0 | 1 | 2 | 3) => void;
  parallaxEnd: number;
  setParallaxEnd: (v: number) => void;
  showContent: boolean;
  setShowContent: (v: boolean) => void;
  hideHeader: boolean;
  setHideHeader: (v: boolean) => void;
};

const UIContext = createContext<UIContextType | undefined>(undefined);

export const UIProvider = ({ children }: { children: React.ReactNode }) => {
  const [isScrollSceneActive, setIsScrollSceneActive] = useState(true);
  const [paintDripState, setPaintDripState] = useState<0 | 1 | 2 | 3>(0);

  const [parallaxEnd, setParallaxEnd] = useState(0);
  const [showContent, setShowContent] = useState(false);
  const [hideHeader, setHideHeader] = useState(false);

  return (
    <UIContext.Provider
      value={{
        isScrollSceneActive,
        setIsScrollSceneActive,
        paintDripState,
        setPaintDripState,
        parallaxEnd,
        setParallaxEnd,
        showContent,
        setShowContent,
        hideHeader,
        setHideHeader,
      }}
    >
      {children}
    </UIContext.Provider>
  );
};

export const useUI = () => {
  const ctx = useContext(UIContext);
  if (!ctx) throw new Error("useUI must be used within UIProvider");
  return ctx;
};
