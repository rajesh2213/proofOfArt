"use client";

import React, { useEffect, useRef, ReactNode } from "react";
import gsap from "gsap";
import {useLoaderContext} from "../../contexts/LoaderContext";

type Props = {
  children: ReactNode;
  initialDripComplete?: boolean;
  shouldLoop?: boolean;
  onUpdateEnd?: (v: number) => void;
  onSceneComplete?: () => void;
};

export default function ScrollScene({
  children,
  initialDripComplete = false,
  shouldLoop = true,
  onUpdateEnd,
  onSceneComplete,
}: Props) {
  const {isLoading} = useLoaderContext()
  const sceneRef = useRef<HTMLDivElement | null>(null);
  const layersRef = useRef<HTMLElement[]>([]);
  const shouldLoopRef = useRef(shouldLoop);

  const camZ = useRef(0);
  const velocity = useRef(0);

  const Z_RANGE = 3800;
  const PER_LAYER_Z = 260;
  const SIDE_OFFSET = 300;
  const SIDE_JITTER = 120;
  const Y_JITTER = 100;
  const SWAY = 60;
  const AUTO_RATE = 1.25;
  const SCROLL_BOOST = 0.42;
  const VELOCITY_DECAY = 0.92;

  const clamp = (v: number, a = 0, b = 1) => Math.max(a, Math.min(b, v));

  useEffect(() => {
    if(!isLoading || shouldLoop) {
      const ctx = gsap.context(() => {
        gsap.set(sceneRef.current, {
          opacity: 0,
          scale: 0.3,
          rotation: -5,
          y: 50,
        });

        if (shouldLoop) {
          gsap.to(sceneRef.current, {
            opacity: 1,
            scale: 1,
            rotation: 0,
            y: 0,
            duration: 4,
            delay: 0.2,
          });
        }
      })
      return () => ctx.revert();
    } 
  }, [isLoading, shouldLoop])

  useEffect(() => {
    shouldLoopRef.current = shouldLoop;
  }, [shouldLoop]);

  useEffect(() => {
    const root = sceneRef.current;
    if (!root) return;

    const layers = Array.from(root.querySelectorAll<HTMLElement>(".art-layer"));
    layersRef.current = layers;
    if (!layers.length) return;

    const L = layers.length;
    const LOOP_RANGE = PER_LAYER_Z * L; 

    const seeds: number[] = layers.map((_el, i) => i * 517.13 + (i % 7) * 31);
    const xJitters = seeds.map((s) => Math.sin(s) * SIDE_JITTER);
    const yJitters = seeds.map((s) => Math.cos(s) * Y_JITTER);

    layers.forEach((el) => {
      el.style.opacity = "0";
      el.style.visibility = "hidden";
      el.style.transformStyle = "preserve-3d";
      el.style.willChange = "transform, opacity";
    });

    requestAnimationFrame(() => {
      layers.forEach((el, i) => {
        const side = i % 2 === 0 ? -1 : 1;
        const baseZ = -Z_RANGE + i * PER_LAYER_Z;
        const baseY = Math.sin(seeds[i]) * (SWAY * 0.6) + yJitters[i];

        el.style.transform = `translate3d(${side * SIDE_OFFSET + xJitters[i]}px, ${baseY}px, ${baseZ}px) scale(0.12)`;
        el.style.visibility = "hidden";
      });
    });

    const doFadeIn = () => {
      layers.forEach((el, i) => {
        el.style.visibility = "visible";
        gsap.to(el, {
          opacity: 1,
          duration: 0.8,
          delay: i * 0.04,
          ease: "power2.out",
        });
      });
    };

    if (initialDripComplete) doFadeIn();
    else window.addEventListener("initialDripComplete", doFadeIn, { once: true });

    const onWheel = (e: WheelEvent) => {
      velocity.current += e.deltaY * SCROLL_BOOST;
    };
    window.addEventListener("wheel", onWheel, { passive: true });

    let lastTouchY = 0;
    const onTouchStart = (e: TouchEvent) => {
      lastTouchY = e.touches[0]?.clientY ?? 0;
    };
    const onTouchMove = (e: TouchEvent) => {
      const cur = e.touches[0]?.clientY ?? 0;
      const dy = lastTouchY - cur;
      velocity.current += dy * 1.05;
      lastTouchY = cur;
    };
    window.addEventListener("touchstart", onTouchStart, { passive: true });
    window.addEventListener("touchmove", onTouchMove, { passive: true });

    const tick = () => {
      if (!shouldLoopRef.current) return;
      
      camZ.current += AUTO_RATE;
      camZ.current += velocity.current * 0.06;
      velocity.current *= VELOCITY_DECAY;

      if (Math.abs(camZ.current) > 1e9) camZ.current = camZ.current % LOOP_RANGE;

      let cam = camZ.current % LOOP_RANGE;
      if (cam < 0) cam += LOOP_RANGE;

      layersRef.current.forEach((el, i) => {
        const side = i % 2 === 0 ? -1 : 1;
        const seed = seeds[i];

        const baseZ = i * PER_LAYER_Z;
        let travel = (cam + baseZ) % LOOP_RANGE;
        if (travel < 0) travel += LOOP_RANGE;

        const z = travel - Z_RANGE;
        const depthProgress = clamp((z + Z_RANGE) / LOOP_RANGE, 0, 1);
        const scale = 0.12 + depthProgress * 0.2;

        const NEAR_START = Z_RANGE * 0.62;
        const NEAR_END = Z_RANGE * 0.95;
        const distanceFromBack = z + Z_RANGE;
        let opacity = 0;
        if (distanceFromBack >= NEAR_START && distanceFromBack <= NEAR_END) {
          opacity = clamp((distanceFromBack - NEAR_START) / (NEAR_END - NEAR_START), 0, 1);
        } else if (distanceFromBack > NEAR_END) {
          opacity = 0.9;
        }

        const hovered = el.getAttribute("data-hovered") === "true" || el.classList.contains("is-hovered");
        if (hovered) opacity = 1;

        const y = Math.sin(seed + depthProgress * Math.PI * 4) * SWAY + yJitters[i];
        const x = side * SIDE_OFFSET + xJitters[i];

        el.style.transform = `translate3d(${x}px, ${y}px, ${z}px) scale(${scale})`;
        el.style.opacity = String(opacity);
        if (opacity > 0) {
          el.style.visibility = "visible";
        }
      });

      if (onUpdateEnd) {
        const docScrollable = Math.max(1, document.documentElement.scrollHeight - window.innerHeight);
        onUpdateEnd(docScrollable);
      }

      if (!shouldLoop && onSceneComplete) {
        const allPast = layersRef.current.every((_el, i) => {
          const baseZ = i * PER_LAYER_Z;
          let travel = (cam + baseZ) % LOOP_RANGE;
          if (travel < 0) travel += LOOP_RANGE;
          const z = travel - Z_RANGE;
          return z > 1200;
        });
        if (allPast) onSceneComplete();
      }
    };

    gsap.ticker.add(tick);

    return () => {
      gsap.ticker.remove(tick);
      window.removeEventListener("wheel", onWheel);
      window.removeEventListener("touchstart", onTouchStart);
      window.removeEventListener("touchmove", onTouchMove);
      window.removeEventListener("initialDripComplete", doFadeIn as EventListener);
    };
  }, [isLoading, initialDripComplete, shouldLoop, onUpdateEnd, onSceneComplete]);

  return (
    <div className="relative w-full h-screen overflow-visible">
      <div
        ref={sceneRef}
        className="fixed inset-0 pointer-events-none"
        style={{
          perspective: "2200px",
          transformStyle: "preserve-3d",
          perspectiveOrigin: "50% 50%",
          opacity: (isLoading && !shouldLoop) ? 0 : 1,
          visibility: (isLoading && !shouldLoop) ? 'hidden' : 'visible',
        }}
      >
        {children}
      </div>
      <div style={{ height: "100vh" }} />
    </div>
  );
}
