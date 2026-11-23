// Stroke rendering: dabs are stamped into a full-opacity stroke canvas, which is
// composited onto the layer with the stroke opacity when the stroke ends. This keeps
// overlapping dabs from darkening and makes the eraser preview exact.
import type { Rect } from './canvas';
import { ctx2d, unionRect } from './canvas';

export type BrushKind = 'pen' | 'pencil' | 'brush' | 'eraser';

export interface StrokeStyle {
  kind: BrushKind;
  color: string;
  size: number;
  opacity: number;
  smoothing: number;
  pressureSize: boolean;
  pressureOpacity: boolean;
}

let softSprite: { color: string; c: HTMLCanvasElement } | null = null;
function getSoftSprite(color: string) {
  if (softSprite && softSprite.color === color) return softSprite.c;
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const x = ctx2d(c);
  const g = x.createRadialGradient(64, 64, 0, 64, 64, 64);
  g.addColorStop(0, color);
  g.addColorStop(0.5, color);
  g.addColorStop(1, hexAlpha(color, 0));
  x.fillStyle = g;
  x.fillRect(0, 0, 128, 128);
  softSprite = { color, c };
  return c;
}

export function hexAlpha(hex: string, a: number) {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}

export class Stroke {
  private x = 0; private y = 0; private p = 0.5;
  private lastX = 0; private lastY = 0; private lastP = 0.5; private lastW = 0;
  private started = false;
  private carry = 0;
  rect: Rect | null = null;
  points = 0;
  private ctx: CanvasRenderingContext2D;
  constructor(public style: StrokeStyle, public canvas: HTMLCanvasElement) {
    this.ctx = ctx2d(canvas);
  }

  private width(p: number) {
    const s = this.style;
    if (!s.pressureSize) return s.size;
    const k = s.kind === 'brush' ? 0.05 : 0.2;
    return Math.max(0.6, s.size * (k + (1 - k) * Math.pow(p, s.kind === 'brush' ? 1.4 : 1.1)));
  }

  add(x: number, y: number, pressure: number, final = false) {
    const s = this.style;
    if (!this.started) {
      this.started = true;
      this.x = this.lastX = x; this.y = this.lastY = y; this.p = this.lastP = pressure;
      this.lastW = this.width(pressure);
      this.dab(x, y, this.lastW, pressure);
      this.points++;
      return;
    }
    const f = final ? 1 : 1 - Math.min(0.92, s.smoothing * 0.95);
    this.x += (x - this.x) * f;
    this.y += (y - this.y) * f;
    this.p += (pressure - this.p) * Math.min(1, f * 1.5);
    this.segment(this.x, this.y, this.p);
    this.points++;
  }

  finish(x: number, y: number, pressure: number) {
    if (this.started) this.add(x, y, pressure, true);
  }

  private segment(x: number, y: number, p: number) {
    const dx = x - this.lastX, dy = y - this.lastY;
    const dist = Math.hypot(dx, dy);
    const w1 = this.width(p);
    const spacingK = this.style.kind === 'brush' ? 0.15 : this.style.kind === 'pencil' ? 0.3 : 0.1;
    let t = this.carry;
    while (true) {
      const w = this.lastW + (w1 - this.lastW) * Math.min(1, t / Math.max(dist, 0.0001));
      const step = Math.max(0.4, w * spacingK);
      if (t + step > dist) { this.carry = t - dist; break; }
      t += step;
      const k = t / dist;
      this.dab(this.lastX + dx * k, this.lastY + dy * k, w, this.lastP + (p - this.lastP) * k);
    }
    if (dist === 0) this.carry = 0;
    this.lastX = x; this.lastY = y; this.lastP = p; this.lastW = w1;
  }

  private dab(x: number, y: number, w: number, p: number) {
    const s = this.style;
    const r = w / 2;
    const x0 = this.ctx;
    if (s.kind === 'brush') {
      x0.globalAlpha = (s.pressureOpacity ? Math.max(0.05, p) : 1) * 0.35;
      x0.drawImage(getSoftSprite(s.color), x - r * 1.3, y - r * 1.3, r * 2.6, r * 2.6);
    } else if (s.kind === 'pencil') {
      x0.globalAlpha = (s.pressureOpacity ? 0.2 + 0.8 * p : 1) * (0.55 + Math.random() * 0.45);
      x0.fillStyle = s.color;
      x0.beginPath();
      x0.arc(x + (Math.random() - 0.5) * r * 0.3, y + (Math.random() - 0.5) * r * 0.3, Math.max(0.35, r), 0, Math.PI * 2);
      x0.fill();
    } else {
      x0.globalAlpha = s.kind === 'pen' && s.pressureOpacity ? 0.3 + 0.7 * p : 1;
      x0.fillStyle = s.kind === 'eraser' ? '#000' : s.color;
      x0.beginPath();
      x0.arc(x, y, Math.max(0.35, r), 0, Math.PI * 2);
      x0.fill();
    }
    x0.globalAlpha = 1;
    const pad = r * 1.4 + 2;
    this.rect = unionRect(this.rect, { x: x - pad, y: y - pad, w: pad * 2, h: pad * 2 });
  }
}

export type ShapeKind = 'line' | 'rect' | 'ellipse';

export function drawShape(canvas: HTMLCanvasElement, kind: ShapeKind, ax: number, ay: number, bx: number, by: number, color: string, size: number, prev: Rect | null): Rect {
  const x = ctx2d(canvas);
  if (prev) x.clearRect(prev.x, prev.y, prev.w, prev.h);
  x.strokeStyle = color;
  x.lineWidth = size;
  x.lineCap = 'round';
  x.lineJoin = 'round';
  x.beginPath();
  if (kind === 'line') { x.moveTo(ax, ay); x.lineTo(bx, by); }
  else if (kind === 'rect') x.rect(Math.min(ax, bx), Math.min(ay, by), Math.abs(bx - ax), Math.abs(by - ay));
  else x.ellipse((ax + bx) / 2, (ay + by) / 2, Math.abs(bx - ax) / 2, Math.abs(by - ay) / 2, 0, 0, Math.PI * 2);
  x.stroke();
  const pad = size + 2;
  return { x: Math.min(ax, bx) - pad, y: Math.min(ay, by) - pad, w: Math.abs(bx - ax) + pad * 2, h: Math.abs(by - ay) + pad * 2 };
}
