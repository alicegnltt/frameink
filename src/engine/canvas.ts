export function makeCanvas(w: number, h: number): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(w));
  c.height = Math.max(1, Math.round(h));
  return c;
}

export function ctx2d(c: HTMLCanvasElement, opts?: CanvasRenderingContext2DSettings) {
  return c.getContext('2d', opts) as CanvasRenderingContext2D;
}

export function toBlob(c: HTMLCanvasElement, type = 'image/png', q?: number): Promise<Blob> {
  return new Promise((res, rej) =>
    c.toBlob((b) => (b ? res(b) : rej(new Error('toBlob failed'))), type, q),
  );
}

export async function blobToCanvas(b: Blob, w?: number, h?: number): Promise<HTMLCanvasElement> {
  const bmp = await loadBitmap(b);
  const c = makeCanvas(w ?? bmp.width, h ?? bmp.height);
  ctx2d(c).drawImage(bmp as CanvasImageSource, 0, 0, c.width, c.height);
  if ('close' in bmp) (bmp as ImageBitmap).close();
  return c;
}

export async function loadBitmap(b: Blob): Promise<ImageBitmap | HTMLImageElement> {
  if (typeof createImageBitmap === 'function') {
    try {
      return await createImageBitmap(b);
    } catch {}
  }
  const url = URL.createObjectURL(b);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    return img;
  } finally {
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
}

export function release(c: HTMLCanvasElement) {
  // Safari counts canvas memory until the canvas is shrunk.
  c.width = 1;
  c.height = 1;
}

export function isCanvasEmpty(c: HTMLCanvasElement): boolean {
  const d = ctx2d(c).getImageData(0, 0, c.width, c.height).data;
  for (let i = 3; i < d.length; i += 16) if (d[i]) return false;
  return true;
}

export interface Rect { x: number; y: number; w: number; h: number }

export function clampRect(r: Rect, w: number, h: number): Rect | null {
  const x0 = Math.max(0, Math.floor(r.x));
  const y0 = Math.max(0, Math.floor(r.y));
  const x1 = Math.min(w, Math.ceil(r.x + r.w));
  const y1 = Math.min(h, Math.ceil(r.y + r.h));
  if (x1 <= x0 || y1 <= y0) return null;
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

export function unionRect(a: Rect | null, b: Rect | null): Rect | null {
  if (!a) return b;
  if (!b) return a;
  const x = Math.min(a.x, b.x), y = Math.min(a.y, b.y);
  return { x, y, w: Math.max(a.x + a.w, b.x + b.w) - x, h: Math.max(a.y + a.h, b.y + b.h) - y };
}
