// Motion tracking (patch matching) and edge detection for the rotoscope guide.
import { ctx2d, makeCanvas } from './canvas';

const TW = 360; // working width for tracking

function gray(img: CanvasImageSource, w: number, h: number): Float32Array {
  const c = makeCanvas(w, h);
  const x = ctx2d(c, { willReadFrequently: true });
  x.drawImage(img, 0, 0, w, h);
  const d = x.getImageData(0, 0, w, h).data;
  const g = new Float32Array(w * h);
  for (let i = 0, p = 0; i < g.length; i++, p += 4) g[i] = d[p] * 0.299 + d[p + 1] * 0.587 + d[p + 2] * 0.114;
  return g;
}

/** Track a point through a list of frames. Returns positions in document space. */
export async function trackPoint(
  getFrame: (i: number) => Promise<CanvasImageSource | null>,
  count: number,
  docW: number,
  docH: number,
  px: number,
  py: number,
  onProgress: (i: number) => void,
  cancelled: () => boolean,
): Promise<{ x: number; y: number }[]> {
  const s = Math.min(1, TW / docW);
  const w = Math.round(docW * s), h = Math.round(docH * s);
  const R = 9; // patch radius
  const S = 18; // search radius
  let x = px * s, y = py * s;
  const out = [{ x: px, y: py }];
  const f0 = await getFrame(0);
  if (!f0) return out;
  let prev = gray(f0, w, h);
  let tpl = patch(prev, w, h, x, y, R);
  for (let i = 1; i < count; i++) {
    if (cancelled()) break;
    const f = await getFrame(i);
    if (!f) { out.push(out[out.length - 1]); continue; }
    const g = gray(f, w, h);
    let best = Infinity, bx = x, by = y;
    for (let dy = -S; dy <= S; dy++) for (let dx = -S; dx <= S; dx++) {
      const cx = Math.round(x) + dx, cy = Math.round(y) + dy;
      if (cx - R < 0 || cy - R < 0 || cx + R >= w || cy + R >= h) continue;
      let sad = 0;
      for (let ty = -R, k = 0; ty <= R; ty++) {
        const row = (cy + ty) * w + cx;
        for (let tx = -R; tx <= R; tx++, k++) sad += Math.abs(g[row + tx] - tpl[k]);
        if (sad >= best) break;
      }
      if (sad < best) { best = sad; bx = cx; by = cy; }
    }
    x = bx; y = by;
    // blend template to follow slow appearance change without drifting too fast
    const np = patch(g, w, h, x, y, R);
    for (let k = 0; k < tpl.length; k++) tpl[k] = tpl[k] * 0.6 + np[k] * 0.4;
    prev = g;
    out.push({ x: x / s, y: y / s });
    onProgress(i);
    if (i % 4 === 0) await new Promise((r) => setTimeout(r, 0));
  }
  return out;
}

function patch(g: Float32Array, w: number, h: number, x: number, y: number, R: number) {
  const out = new Float32Array((2 * R + 1) ** 2);
  const cx = Math.round(x), cy = Math.round(y);
  for (let ty = -R, k = 0; ty <= R; ty++) for (let tx = -R; tx <= R; tx++, k++) {
    const xx = Math.min(w - 1, Math.max(0, cx + tx)), yy = Math.min(h - 1, Math.max(0, cy + ty));
    out[k] = g[yy * w + xx];
  }
  return out;
}

/** Sobel edges as a tinted transparent canvas (document size). */
export function edgeGuide(img: CanvasImageSource, w: number, h: number, threshold: number, color = '#22d3ee'): HTMLCanvasElement {
  const s = Math.min(1, 900 / Math.max(w, h));
  const ww = Math.round(w * s), hh = Math.round(h * s);
  const g = gray(img, ww, hh);
  const out = makeCanvas(ww, hh);
  const x = ctx2d(out);
  const id = x.createImageData(ww, hh);
  const n = parseInt(color.slice(1), 16);
  const r = (n >> 16) & 255, gg = (n >> 8) & 255, b = n & 255;
  for (let yy = 1; yy < hh - 1; yy++) for (let xx = 1; xx < ww - 1; xx++) {
    const i = yy * ww + xx;
    const gx = -g[i - ww - 1] - 2 * g[i - 1] - g[i + ww - 1] + g[i - ww + 1] + 2 * g[i + 1] + g[i + ww + 1];
    const gy = -g[i - ww - 1] - 2 * g[i - ww] - g[i - ww + 1] + g[i + ww - 1] + 2 * g[i + ww] + g[i + ww + 1];
    const m = Math.hypot(gx, gy);
    if (m < threshold) continue;
    const p = i * 4;
    id.data[p] = r; id.data[p + 1] = gg; id.data[p + 2] = b;
    id.data[p + 3] = Math.min(255, (m - threshold) * 2 + 80);
  }
  x.putImageData(id, 0, 0);
  return out;
}
