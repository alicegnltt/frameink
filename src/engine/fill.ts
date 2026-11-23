// Flood fill with tolerance and gap closing.
// Returns a mask canvas (filled pixels in the fill color) and its bounds, or null.
import { makeCanvas, ctx2d } from './canvas';
import type { Rect } from './canvas';

export function floodFill(
  src: ImageData,
  sx: number,
  sy: number,
  color: string,
  tolerance: number, // 0..100
  gap: number, // px
): { canvas: HTMLCanvasElement; rect: Rect } | null {
  const { width: w, height: h, data } = src;
  sx = Math.floor(sx); sy = Math.floor(sy);
  if (sx < 0 || sy < 0 || sx >= w || sy >= h) return null;
  const n = w * h;
  const i0 = (sy * w + sx) * 4;
  const sr = data[i0], sg = data[i0 + 1], sb = data[i0 + 2], sa = data[i0 + 3];
  const tol = (tolerance / 100) * 255 * 2;
  const similar = new Uint8Array(n);
  for (let i = 0, p = 0; i < n; i++, p += 4) {
    const a = data[p + 3];
    // compare premultiplied-ish so transparent pixels of any color match each other
    const dr = (data[p] * a - sr * sa) / 255;
    const dg = (data[p + 1] * a - sg * sa) / 255;
    const db = (data[p + 2] * a - sb * sa) / 255;
    const da = a - sa;
    const d = Math.max(Math.abs(dr), Math.abs(dg), Math.abs(db), Math.abs(da) * 1.0);
    similar[i] = d <= tol + 1 ? 1 : 0;
  }
  // Barrier = not similar. Gap closing: grow the barrier by `gap` px.
  let passable = similar;
  if (gap > 0) {
    const dist = distanceToBarrier(similar, w, h, gap + 1);
    passable = new Uint8Array(n);
    for (let i = 0; i < n; i++) passable[i] = similar[i] && dist[i] > gap ? 1 : 0;
    if (!passable[sy * w + sx]) passable = similar; // seed is inside the grown barrier: fall back
  }
  const filled = new Uint8Array(n);
  const stack = new Int32Array(n);
  let sp = 0;
  stack[sp++] = sy * w + sx;
  filled[sy * w + sx] = 1;
  let count = 0;
  while (sp) {
    const i = stack[--sp];
    count++;
    const x = i % w;
    if (x > 0 && passable[i - 1] && !filled[i - 1]) { filled[i - 1] = 1; stack[sp++] = i - 1; }
    if (x < w - 1 && passable[i + 1] && !filled[i + 1]) { filled[i + 1] = 1; stack[sp++] = i + 1; }
    if (i >= w && passable[i - w] && !filled[i - w]) { filled[i - w] = 1; stack[sp++] = i - w; }
    if (i < n - w && passable[i + w] && !filled[i + w]) { filled[i + w] = 1; stack[sp++] = i + w; }
  }
  if (!count) return null;
  // Grow back by gap+2 so the fill tucks under line edges; can enter barrier pixels but not leave them.
  const grow = gap + 2;
  let frontier: number[] = [];
  for (let i = 0; i < n; i++) if (filled[i]) {
    const x = i % w;
    if ((x > 0 && !filled[i - 1]) || (x < w - 1 && !filled[i + 1]) || (i >= w && !filled[i - w]) || (i < n - w && !filled[i + w])) frontier.push(i);
  }
  for (let g = 0; g < grow && frontier.length; g++) {
    const next: number[] = [];
    for (const i of frontier) {
      if (!similar[i] && g > 0) continue; // barrier pixel: do not spread from it
      const x = i % w;
      const nb = [x > 0 ? i - 1 : -1, x < w - 1 ? i + 1 : -1, i >= w ? i - w : -1, i < n - w ? i + w : -1];
      for (const j of nb) if (j >= 0 && !filled[j]) { filled[j] = 1; next.push(j); }
    }
    frontier = next;
  }
  let minX = w, minY = h, maxX = -1, maxY = -1;
  for (let i = 0; i < n; i++) if (filled[i]) {
    const x = i % w, y = (i / w) | 0;
    if (x < minX) minX = x; if (x > maxX) maxX = x;
    if (y < minY) minY = y; if (y > maxY) maxY = y;
  }
  if (maxX < 0) return null;
  const rect = { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 };
  const c = makeCanvas(rect.w, rect.h);
  const x = ctx2d(c);
  const img = x.createImageData(rect.w, rect.h);
  const n2 = parseInt(color.slice(1), 16);
  const cr = (n2 >> 16) & 255, cg = (n2 >> 8) & 255, cb = n2 & 255;
  for (let yy = 0; yy < rect.h; yy++) {
    for (let xx = 0; xx < rect.w; xx++) {
      if (!filled[(yy + minY) * w + xx + minX]) continue;
      const p = (yy * rect.w + xx) * 4;
      img.data[p] = cr; img.data[p + 1] = cg; img.data[p + 2] = cb; img.data[p + 3] = 255;
    }
  }
  x.putImageData(img, 0, 0);
  return { canvas: c, rect };
}

/** Chebyshev-ish distance (two-pass chamfer) from each passable pixel to the nearest barrier, capped. */
function distanceToBarrier(passable: Uint8Array, w: number, h: number, cap: number): Uint8Array {
  const d = new Uint8Array(w * h);
  for (let i = 0; i < d.length; i++) d[i] = passable[i] ? cap : 0;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = y * w + x;
    if (!d[i]) continue;
    let m = d[i];
    if (x > 0) m = Math.min(m, d[i - 1] + 1);
    if (y > 0) {
      m = Math.min(m, d[i - w] + 1);
      if (x > 0) m = Math.min(m, d[i - w - 1] + 1);
      if (x < w - 1) m = Math.min(m, d[i - w + 1] + 1);
    }
    d[i] = m;
  }
  for (let y = h - 1; y >= 0; y--) for (let x = w - 1; x >= 0; x--) {
    const i = y * w + x;
    if (!d[i]) continue;
    let m = d[i];
    if (x < w - 1) m = Math.min(m, d[i + 1] + 1);
    if (y < h - 1) {
      m = Math.min(m, d[i + w] + 1);
      if (x < w - 1) m = Math.min(m, d[i + w + 1] + 1);
      if (x > 0) m = Math.min(m, d[i + w - 1] + 1);
    }
    d[i] = m;
  }
  return d;
}
