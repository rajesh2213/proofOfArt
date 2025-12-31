"use client";

import { useEffect } from "react";
import gsap from "gsap";
import ScrollTrigger from "gsap/ScrollTrigger";

export default function useGsap() {
  useEffect(() => {
    if (typeof window !== "undefined") {
      gsap.registerPlugin(ScrollTrigger);
      (window as any).gsap = gsap;
      (window as any).ScrollTrigger = ScrollTrigger;
    }
  }, []);
}