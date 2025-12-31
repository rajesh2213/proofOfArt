"use client";

import { useEffect, useCallback, useRef } from "react";
import Image from "next/image";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import gsap from "gsap";
import { useRouter, usePathname } from "next/navigation";
import ArtLayer from './ArtLayer';
import ScrollScene from "../SpatialScroll/ScrollScene";
import useGsap from "../../hooks/useGsap";
import { artworks } from './artworks';
import { useUI } from "../../contexts/UIContext";

export default function HomePageClient({ 
  isInLoader = false, 
  delayAnimations = false, 
  isVisible = true,
  startEntranceAnimationsRef,
  zoomComplete = false
}: { 
  isInLoader?: boolean; 
  delayAnimations?: boolean; 
  isVisible?: boolean;
  startEntranceAnimationsRef?: React.MutableRefObject<(() => void) | null>;
  zoomComplete?: boolean;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const titleRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const scrollSceneRef = useRef<HTMLDivElement>(null);
  const homeContentRef = useRef<HTMLDivElement>(null);
  const navigationBlockedRef = useRef<boolean>(false);
  const lastResetTimeRef = useRef<number>(0);
  const hasAnimatedRef = useRef<boolean>(false);

  const { 
    isScrollSceneActive, 
    setIsScrollSceneActive, 
    parallaxEnd,
    setParallaxEnd,
    paintDripState,
    setPaintDripState,
    showContent,
    setShowContent,
  } = useUI();

  useEffect(() => {
    if (paintDripState === 1) {
      navigationBlockedRef.current = true;
      lastResetTimeRef.current = Date.now();
    }
    if (isInLoader) navigationBlockedRef.current = true;
    if (paintDripState === 3) {
      navigationBlockedRef.current = false;
      return;
    }
    if (paintDripState !== 1 && !isInLoader) {
      const timeSinceReset = Date.now() - lastResetTimeRef.current;
      if (timeSinceReset < 10000) {
        const unblockTimer = setTimeout(() => { navigationBlockedRef.current = false; }, 10000 - timeSinceReset);
        return () => clearTimeout(unblockTimer);
      } else { navigationBlockedRef.current = false; }
    }
  }, [paintDripState, isInLoader]);

  const initialDripComplete = paintDripState >= 2;
  const sceneComplete = paintDripState >= 3;

  useGsap();

  useEffect(() => {
    if (paintDripState === 3 && pathname === '/' && !isInLoader) {
      if (typeof window !== 'undefined' && window.location.pathname === '/') {
        router.push('/upload-art');
        return;
      }
    }
    if (navigationBlockedRef.current) return;
    if (paintDripState === 1) return;
  }, [paintDripState, router, pathname, isInLoader]);

  const parallaxEndRef = useRef<number>(0);
  const handleUpdateParallaxEnd = useCallback((endPosition: number) => {
    if (endPosition > 0) {
      const diff = Math.abs(endPosition - parallaxEndRef.current);
      if (parallaxEndRef.current === 0 || (parallaxEndRef.current < 500 && diff > 50) || (parallaxEndRef.current >= 500 && endPosition > parallaxEndRef.current + 100)) {
        parallaxEndRef.current = endPosition;
        setParallaxEnd(endPosition);
      }
    }
  }, [setParallaxEnd]);

  const handleSceneComplete = useCallback(() => { setPaintDripState(3); }, [setPaintDripState]);

  useEffect(() => {
    if (parallaxEnd > 0) {
      const timeout = setTimeout(() => {
        if (typeof window !== 'undefined' && ScrollTrigger) ScrollTrigger.refresh(true);
      }, 150);
      return () => clearTimeout(timeout);
    }
  }, [parallaxEnd]);

  useEffect(() => {
    if (!isInLoader && isVisible && paintDripState >= 1) {
      setShowContent(true);
    } else if (!isVisible || isInLoader) {
      setShowContent(false);
      if (!isVisible) {
        hasAnimatedRef.current = false; 
      }
    }
  }, [isInLoader, isVisible, setShowContent, paintDripState]);

  useEffect(() => {
    if (!isInLoader && isVisible && titleRef.current && buttonRef.current) {
      gsap.set(titleRef.current, { opacity: 0, y: 60, visibility: 'hidden' });
      gsap.set(buttonRef.current, { opacity: 0, visibility: 'hidden' });
      gsap.set(".separator-line", { opacity: 0, scaleX: 0 });
    }
  }, [isInLoader, isVisible]);

  const startEntranceAnimations = useCallback(() => {
    if (!isInLoader && isVisible && showContent && paintDripState === 1 && isScrollSceneActive && !hasAnimatedRef.current) {
      if (titleRef.current && buttonRef.current) {
        hasAnimatedRef.current = true;
        
        const ctx = gsap.context(() => {
          gsap.set([titleRef.current, buttonRef.current], { visibility: 'visible' });
          
          gsap.to(titleRef.current, 
            { 
              y: 0, 
              opacity: 1, 
              duration: 1.4, 
              delay: 0.2,
              ease: "power3.out",
              force3D: true
            }
          );

          gsap.to(".separator-line",
              { 
                scaleX: 1, 
                opacity: 0.5, 
                duration: 1.2, 
                delay: 0.6,
                ease: "power2.out",
                force3D: true
              }
          );

          gsap.to(buttonRef.current,
              { 
                opacity: 1, 
                duration: 1, 
                delay: 0.8,
                force3D: true
              }
          );
        });
        
        return () => ctx.revert();
      }
    }
  }, [isInLoader, isVisible, showContent, paintDripState, isScrollSceneActive]);

  useEffect(() => {
    if (startEntranceAnimationsRef) {
      startEntranceAnimationsRef.current = startEntranceAnimations;
    }
  }, [startEntranceAnimations, startEntranceAnimationsRef]);

  useEffect(() => {
    if (zoomComplete) {
      const timeoutId = setTimeout(() => {
        startEntranceAnimations();
      }, 50);
      return () => clearTimeout(timeoutId);
    }
  }, [zoomComplete, startEntranceAnimations]);

  useEffect(() => {
    const needsScrolling = paintDripState === 2;
    if (!isScrollSceneActive && !needsScrolling) {
      let style = document.getElementById('hide-scrollbar-style') as HTMLStyleElement;
      if (!style) {
        style = document.createElement('style');
        style.id = 'hide-scrollbar-style';
        document.head.appendChild(style);
      }
      style.textContent = `
          * { scrollbar-width: none !important; -ms-overflow-style: none !important; }
          *::-webkit-scrollbar { display: none !important; width: 0 !important; height: 0 !important; background: transparent !important; }
          html:not(#x), body:not(#y), html:not(#x) body:not(#y) { overflow: hidden !important; }
        `;
    } else {
      const style = document.getElementById('hide-scrollbar-style');
      if (style) style.remove();
      document.documentElement.style.overflowY = 'auto';
      document.body.style.overflowY = 'auto';
    }
    return () => { const style = document.getElementById('hide-scrollbar-style'); if (style) style.remove(); };
  }, [isScrollSceneActive, paintDripState]);

  const handleUploadButtonClick = useCallback(() => {
    setPaintDripState(2);
    router.prefetch('/upload-art');
    
    if (scrollSceneRef.current) {
      gsap.to(scrollSceneRef.current, { opacity: 0, duration: 2, delay: 4.3, ease: "power2.out", onComplete: () => { setIsScrollSceneActive(false); } });
    }
    if (homeContentRef.current) {
      gsap.to(homeContentRef.current, { opacity: 0, duration: 1.5, ease: "power2.out", onComplete: () => { setShowContent(false); } });
    }
  }, [setPaintDripState, setIsScrollSceneActive, router, setShowContent]);

  return (
    <div
      className="relative transition-colors duration-300"
      style={{
        zIndex: 1,
        width: isInLoader ? '1920px' : '100%',
        height: isInLoader ? '1080px' : 'auto',
        minHeight: isInLoader ? '1080px' : '100vh',
        position: isInLoader ? 'absolute' : 'relative',
        top: isInLoader ? 0 : 'auto',
        left: isInLoader ? 0 : 'auto',
        background: '#0a0a0a' 
      }}
    >
      <style dangerouslySetInnerHTML={{__html: `
        @import url('https://fonts.googleapis.com/css2?family=Cinzel:wght@400;600&family=Inter:wght@300;400&display=swap');
      `}} />

      {!isInLoader && ( <div style={{ height: paintDripState === 2 ? '300vh' : '100vh' }} /> )}

      {!sceneComplete && !isInLoader && (
        <div 
          ref={scrollSceneRef} 
          style={{ 
            position: 'absolute', 
            top: 0, 
            left: 0, 
            width: '100%', 
            height: '100%', 
            opacity: isScrollSceneActive ? 1 : 0,
            visibility: isScrollSceneActive ? 'visible' : 'hidden',
            zIndex: 1, 
            pointerEvents: 'none',
            transition: 'opacity 0.3s ease-out, visibility 0.3s ease-out'
          }} 
        >
          <ScrollScene 
            onUpdateEnd={handleUpdateParallaxEnd} 
            onSceneComplete={handleSceneComplete} 
            initialDripComplete={initialDripComplete} 
            shouldLoop={isScrollSceneActive}
          >
            {artworks.map((a, i) => ( <ArtLayer key={i} img={a.img} name={a.name} author={a.author} depth={i} /> ))}
          </ScrollScene>
        </div>
      )}

      <div style={{ position: isInLoader ? 'absolute' : 'fixed', inset: 0, zIndex: -1, overflow: 'hidden' }}>
        <Image 
          src="/images/5177180.jpg" 
          alt="Background" 
          fill 
          priority 
          decoding="sync"
          style={{ 
            objectFit: "cover", 
            objectPosition: "center", 
            filter: isInLoader ? 'none' : 'grayscale(100%) brightness(0.7) contrast(1.2)',
            transition: 'filter 1.5s ease-out' 
          }} 
        />
        {!isInLoader && <div className="absolute inset-0 bg-black/40" />}
      </div>

      {!isInLoader && showContent && (
        <div className="fixed inset-0 flex flex-col items-center justify-center w-full px-4" ref={homeContentRef} style={{ pointerEvents: 'none', zIndex: 10 }}>
          
          <div 
            ref={titleRef} 
            className="flex flex-col items-center justify-center text-center"
            style={{ 
              opacity: 0, 
              transform: 'translateY(60px)',
              visibility: 'hidden'
            }}
          >
            
            <h1 className="relative leading-none" style={{ mixBlendMode: 'difference', color: 'white' }}>
              <span className="block text-6xl md:text-8xl lg:text-9xl font-normal tracking-tight" style={{ fontFamily: '"Cinzel", serif' }}>
                DIGITAL
              </span>
              <span className="block text-6xl md:text-8xl lg:text-9xl font-normal tracking-tight" style={{ fontFamily: '"Cinzel", serif' }}>
                AUTHENTICITY
              </span>
            </h1>

            <div className="separator-line w-24 h-[1px] bg-white/50 my-10" style={{ opacity: 0, transform: 'scaleX(0)' }} />

            <p className="max-w-md text-sm md:text-base font-light text-white/90 leading-relaxed tracking-wide font-sans">
              Verifying creativity in the age of artificial intelligence.
            </p>
          </div>

          <div className="mt-16" style={{ pointerEvents: 'auto' }}>
            
            <style jsx global>{`
              @keyframes blink-cursor {
                0%, 100% { opacity: 1; }
                50% { opacity: 0; }
              }
              .blinking-bracket {
                animation: blink-cursor 1.2s step-end infinite;
              }
            `}</style>
            
            <button
              ref={buttonRef}
              onClick={handleUploadButtonClick}
              className="group relative h-16 px-10 flex items-center justify-center text-white transition-all duration-300 overflow-hidden"
              style={{
                cursor: 'pointer',
                minWidth: '250px',
                opacity: 0,
                visibility: 'hidden' 
              }}
              onMouseEnter={(e) => {
                gsap.to(e.currentTarget.querySelectorAll('.frame-line-h'), { scaleX: 1, duration: 0.3, stagger: 0.05 });
                gsap.to(e.currentTarget.querySelectorAll('.frame-line-v'), { scaleY: 1, duration: 0.3, stagger: 0.05 });

                const flashElement = e.currentTarget.querySelector('.scanner-flash');
                if (flashElement) {
                  gsap.set(flashElement, { x: '-150%', opacity: 1 });
                  gsap.to(flashElement, {
                    x: '150%',
                    duration: 0.7,
                    ease: "power1.inOut",
                    onComplete: () => {
                      gsap.to(flashElement, { opacity: 0, duration: 0.3 });
                    }
                  });
                }
                e.currentTarget.querySelector('.blinking-left')?.classList.remove('blinking-bracket');
                e.currentTarget.querySelector('.blinking-right')?.classList.remove('blinking-bracket');
              }}
              onMouseLeave={(e) => {
                gsap.to(e.currentTarget.querySelectorAll('.frame-line-h'), { scaleX: 0, duration: 0.2 });
                gsap.to(e.currentTarget.querySelectorAll('.frame-line-v'), { scaleY: 0, duration: 0.2 });
                
                e.currentTarget.querySelector('.blinking-left')?.classList.add('blinking-bracket');
                e.currentTarget.querySelector('.blinking-right')?.classList.add('blinking-bracket');
              }}
            >
              <span className="frame-line-h absolute top-0 left-0 w-full h-[1px] bg-white transform scale-x-0 origin-left" />
              <span className="frame-line-h absolute bottom-0 right-0 w-full h-[1px] bg-white transform scale-x-0 origin-right" />
              <span className="frame-line-v absolute top-0 left-0 h-full w-[1px] bg-white transform scale-y-0 origin-top" />
              <span className="frame-line-v absolute bottom-0 right-0 h-full w-[1px] bg-white transform scale-y-0 origin-bottom" />


              <span 
                className="scanner-flash absolute inset-0 w-full h-full opacity-0" 
                style={{
                  background: 'linear-gradient(90deg, transparent 0%, rgba(255, 255, 255, 0.5) 50%, transparent 100%)',
                  pointerEvents: 'none',
                }}
              />

              <span className="relative z-10 flex items-center gap-1.5">
                <span className="blinking-bracket blinking-left text-xl font-light leading-none -mt-1" style={{ color: 'white' }}>
                    [
                </span>

                <span className="text-base tracking-[0.3em] uppercase font-sans font-medium group-hover:text-white/80 transition-colors duration-200">
                  Initialize Upload
                </span>
                
                <span className="blinking-bracket blinking-right text-xl font-light leading-none -mt-1" style={{ color: 'white' }}>
                    ]
                </span>
              </span>

            </button>
          </div>

        </div>
      )}
    </div>
  );
}