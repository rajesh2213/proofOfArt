/**
 * Build a lightweight Cloudinary delivery URL for gallery thumbs.
 * Leaves non-Cloudinary URLs unchanged.
 */
export function cloudinaryThumb(
  url: string,
  options: { width?: number; height?: number; crop?: string } = {}
): string {
  if (!url || !url.includes('/upload/')) {
    return url;
  }

  // Already transformed
  if (/\/upload\/(?:[^/]+,)*?(?:c_|w_|h_|f_auto)/.test(url)) {
    return url;
  }

  const { width = 480, height, crop = 'fill' } = options;
  const transforms = [
    `c_${crop}`,
    `w_${width}`,
    height ? `h_${height}` : null,
    'f_auto',
    'q_auto',
  ]
    .filter(Boolean)
    .join(',');

  return url.replace('/upload/', `/upload/${transforms}/`);
}
