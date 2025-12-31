
interface PreloadCache {
  images: Map<string, HTMLImageElement>;
  imageBitmaps: Map<string, ImageBitmap>;
}

const cache: PreloadCache = {
  images: new Map(),
  imageBitmaps: new Map(),
};

export async function preloadImage(src: string, useImageBitmap: boolean = false): Promise<HTMLImageElement | ImageBitmap> {
  if (useImageBitmap && cache.imageBitmaps.has(src)) {
    return cache.imageBitmaps.get(src)!;
  }
  if (!useImageBitmap && cache.images.has(src)) {
    return cache.images.get(src)!;
  }

  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    
    img.onload = async () => {
      try {
        await img.decode();
        
        if (useImageBitmap) {
          const bitmap = await createImageBitmap(img);
          cache.imageBitmaps.set(src, bitmap);
          resolve(bitmap);
        } else {
          cache.images.set(src, img);
          resolve(img);
        }
      } catch (error) {
        if (useImageBitmap) {
          try {
            const bitmap = await createImageBitmap(img);
            cache.imageBitmaps.set(src, bitmap);
            resolve(bitmap);
          } catch {
            cache.images.set(src, img);
            resolve(img);
          }
        } else {
          cache.images.set(src, img);
          resolve(img);
        }
      }
    };
    
    img.onerror = () => {
      reject(new Error(`Failed to load image: ${src}`));
    };
    
    img.src = src;
  });
}

export async function preloadImages(
  sources: string[],
  useImageBitmap: boolean = false
): Promise<(HTMLImageElement | ImageBitmap)[]> {
  return Promise.all(sources.map(src => preloadImage(src, useImageBitmap)));
}

export async function preloadTransitionAssets(): Promise<void> {
  const transitionAssets = [
    "/images/loader-leaf-horizontal.png",
    "/spritesheets/paint_drip_spritesheets/sheet_1.webp",
    "/spritesheets/paint_drip_spritesheets/sheet_2.webp",
    "/spritesheets/paint_drip_spritesheets/sheet_3.webp",
  ];

  if (typeof window !== 'undefined') {
    const schedulePreload = (callback: () => void) => {
      if ('requestIdleCallback' in window) {
        requestIdleCallback(callback, { timeout: 2000 });
      } else {
        setTimeout(callback, 0);
      }
    };

    schedulePreload(() => {
      preloadImages(transitionAssets, false).catch(() => {
      });
    });
  }
}

export async function preloadRouteAssets(route: string): Promise<void> {
  const routeAssets: Record<string, string[]> = {
    '/': [
      "/images/5177180.jpg",
    ],
    '/gallery': [],
    '/upload-art': [],
    '/login': [],
    '/register': [],
  };

  const assets = routeAssets[route] || [];
  if (assets.length > 0) {
    await preloadImages(assets, false).catch(() => {
    });
  }
}


export function getCachedImage(src: string): HTMLImageElement | null {
  return cache.images.get(src) || null;
}

export function getCachedImageBitmap(src: string): ImageBitmap | null {
  return cache.imageBitmaps.get(src) || null;
}


export function clearCache(): void {
  cache.images.clear();
  cache.imageBitmaps.forEach(bitmap => {
    try {
      bitmap.close();
    } catch (e) {
    }
  });
  cache.imageBitmaps.clear();
}

