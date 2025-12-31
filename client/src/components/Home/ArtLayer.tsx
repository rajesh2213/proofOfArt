"use client";

import { useState, useRef, useEffect } from "react";
import { createPortal } from "react-dom";

type Props = {
  img: string;
  name: string;
  author: string;
  depth: number;
};

const getPopupSide = (rect: DOMRect, boxWidth: number): "left" | "right" => {
  const imgCenterX = rect.left + rect.width / 2;
  const viewportCenterX = window.innerWidth / 2;

  const spaceOnRight = window.innerWidth - (rect.right + 16 + boxWidth);
  const spaceOnLeft = rect.left - 16 - boxWidth;

  if (imgCenterX < viewportCenterX) {
    if (spaceOnRight >= boxWidth) {
      return "right";
    }
    if (spaceOnLeft >= boxWidth) {
      return "left";
    }
    return spaceOnRight > spaceOnLeft ? "right" : "left";
  } else {
    if (spaceOnLeft >= boxWidth) {
      return "left";
    }
    if (spaceOnRight >= boxWidth) {
      return "right";
    }
    return spaceOnLeft > spaceOnRight ? "left" : "right";
  }
};

export default function ArtLayer({ img, name, author }: Props) {
  const [hover, setHover] = useState(false);
  const [popupSide, setPopupSide] = useState<"left" | "right">("left");
  const imgContainerRef = useRef<HTMLDivElement | null>(null);
  const layerRef = useRef<HTMLDivElement | null>(null);

  const [boxCoords, setBoxCoords] = useState<{ left: number; top: number } | null>(
    null
  );
  
  useEffect(() => {
    const initCoords = () => {
      if (imgContainerRef.current) {
        const rect = imgContainerRef.current.getBoundingClientRect();
        const side = getPopupSide(rect, BOX_WIDTH);
        const top = rect.top + rect.height / 2 - BOX_HEIGHT / 2;
        let left: number;
        if (side === "right") {
          left = rect.right + 16;
        } else {
          left = rect.left - BOX_WIDTH - 16;
        }
        setBoxCoords({
          left: Math.max(8, Math.min(left, window.innerWidth - BOX_WIDTH - 8)),
          top: Math.max(8, Math.min(top, window.innerHeight - BOX_HEIGHT - 8)),
        });
      }
    };
    
    const timer = setTimeout(initCoords, 200);
    return () => clearTimeout(timer);
  }, []);

  const BOX_WIDTH = 240;
  const BOX_HEIGHT = 80;
  const BOX_PADDING = 14;

  const updatePopupPosition = () => {
    const el = imgContainerRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();

    const side = getPopupSide(rect, BOX_WIDTH);
    setPopupSide(side);

    const top = rect.top + rect.height / 2 - BOX_HEIGHT / 2;

    let left: number;
    if (side === "right") {
      left = rect.right + 16;
    } else {
      left = rect.left - BOX_WIDTH - 16;
    }

    setBoxCoords({
      left: Math.max(8, Math.min(left, window.innerWidth - BOX_WIDTH - 8)),
      top: Math.max(8, Math.min(top, window.innerHeight - BOX_HEIGHT - 8)),
    });
  };

  useEffect(() => {
    const timer = setTimeout(() => {
      updatePopupPosition();
    }, 100);
    
    window.addEventListener("resize", updatePopupPosition);
    window.addEventListener("scroll", updatePopupPosition, { passive: true });
    return () => {
      clearTimeout(timer);
      window.removeEventListener("resize", updatePopupPosition);
      window.removeEventListener("scroll", updatePopupPosition);
    };
  }, []);

  useEffect(() => {
    updatePopupPosition();
  }, [hover]);

  useEffect(() => {
    if (layerRef.current) {
      if (hover) {
        layerRef.current.setAttribute('data-hovered', 'true');
        layerRef.current.classList.add('is-hovered');
      } else {
        layerRef.current.removeAttribute('data-hovered');
        layerRef.current.classList.remove('is-hovered');
      }
    }
  }, [hover]);

  return (
    <>
      <div
        ref={layerRef}
        className="art-layer absolute"
        style={{
          top: 0,
          left: 0,
          width: "100%",
          height: "100%",
          transformStyle: "preserve-3d",
          willChange: "transform, opacity",
          backfaceVisibility: "hidden",
          pointerEvents: "none",
          opacity: 0,
          visibility: "hidden",
        }}
      >
        <div
          ref={imgContainerRef}
          className="absolute top-1/2 left-1/2 pointer-events-auto"
          style={{
            transform: "translate(-50%, -50%)",
            width: "clamp(300px, 40vw, 600px)",
            maxHeight: "600px",
            transformStyle: "preserve-3d",
          }}
          onMouseEnter={() => {
            setHover(true);
            if (layerRef.current) {
              layerRef.current.setAttribute('data-hovered', 'true');
              layerRef.current.classList.add('is-hovered');
            }
          }}
          onMouseLeave={() => {
            setHover(false);
            if (layerRef.current) {
              layerRef.current.removeAttribute('data-hovered');
              layerRef.current.classList.remove('is-hovered');
            }
          }}
        >
          <img
            src={img}
            alt={name}
            decoding="sync"
            className="w-full h-auto rounded-2xl shadow-2xl"
            style={{
              transform: "translateZ(0)",
              filter: hover ? "brightness(1.06)" : "brightness(1)",
              transition: "filter 0.25s ease",
              display: "block",
            }}
            onError={(e) => {
              (e.target as HTMLImageElement).style.display = "none";
            }}
          />
        </div>
      </div>

      {typeof window !== 'undefined' && boxCoords && createPortal(
        <div
          aria-hidden={!hover}
          style={{
            position: "fixed",
            left: `${boxCoords.left}px`,
            top: `${boxCoords.top}px`,
            width: `${BOX_WIDTH}px`,
            height: `${BOX_HEIGHT}px`,
            pointerEvents: "none",
            zIndex: 1000000,
            transform: hover
              ? "translateZ(0) scaleY(1)"
              : "translateZ(0) scaleY(0)",
            transformOrigin: "center center",
            opacity: hover ? 1 : 0,
            transition:
              "opacity 0.3s ease, transform 0.3s cubic-bezier(.2,.9,.2,1)",
          }}
        >
          <div
            style={{
              padding: `${BOX_PADDING}px ${BOX_PADDING + 4}px`,
              background: "rgba(15, 15, 15, 0.50)",
              backdropFilter: "blur(12px)",
              border: "2px solid rgb(255, 255, 255)",
              borderRadius: "4px",
              color: "#fff",
              height: "100%",
              display: "flex",
              flexDirection: "column",
              justifyContent: "center",
              alignItems: "center",
              textAlign: "center",
              boxSizing: "border-box",
              overflow: "hidden",
              position: "relative",
              boxShadow: "0 4px 20px rgba(0,0,0,0.3), inset 0 1px 0 rgba(255,255,255,0.1)",
            }}
          >
            <div
              style={{
                position: "absolute",
                left: `${BOX_PADDING + 4}px`,
                right: `${BOX_PADDING + 4}px`,
                top: "50%",
                transform: "translateY(-50%)",
                height: "1px",
                background: "rgba(255,255,255,0.2)",
                pointerEvents: "none",
              }}
            />
            <p
              style={{
                fontSize: "1.1rem",
                margin: 0,
                paddingBottom: "8px",
                fontWeight: 600,
                letterSpacing: "0.01em",
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
                lineHeight: "1.4",
                width: "100%",
              }}
            >
              {name}
            </p>
            <p
              style={{
                fontSize: "0.75rem",
                margin: 0,
                fontWeight: 400,
                letterSpacing: "0.02em",
                opacity: 0.85,
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
                lineHeight: "1.4",
                width: "100%",
              }}
            >
              {author}
            </p>
          </div>
        </div>,
        document.body
      )}
    </>
  );
}
