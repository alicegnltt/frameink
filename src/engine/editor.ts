// The editor controller: view transform, input (Pencil, mouse, touch), tools, rendering,
// animation helpers. React only renders chrome around it and reads `editor.ui`.
import type { FingerMode, OnionMode, ToolId } from '../types';
import { Doc } from './doc';
import { History, PixelPatch, compound } from './history';
import type { HistoryEntry } from './history';
import { Stroke, drawShape } from './brush';
import type { BrushKind, ShapeKind } from './brush';
import { floodFill } from './fill';
import { edgeGuide, trackPoint } from './track';
import { blobToCanvas, clampRect, ctx2d, isCanvasEmpty, makeCanvas, toBlob } from './canvas';
import type { Rect } from './canvas';
import { Store } from './store';

export interface BrushPrefs { size: number; opacity: number; smoothing: number; pressureSize: boolean; pressureOpacity: boolean }

export interface UIState {
  tool: ToolId;
  color: string;
  recent: string[];
  brushes: Record<BrushKind, BrushPrefs>;
  shapeSize: number;
  frame: number;
  layerId: string;
  onion: OnionMode;
  onionBefore: number;
  onionAfter: number;
  onionOpacity: number;
  onionTint: boolean;
  videoVisible: boolean;
  videoOpacity: number;
  edgeGuide: boolean;
  edgeThreshold: number;
  fingerMode: FingerMode;
  penSeen: boolean;
  playing: boolean;
  loop: boolean;
  speed: number;
  audio: boolean;
  fillTolerance: number;
  fillGap: number;
  fillAllLayers: boolean;
  hasSelection: boolean;
  hasClipboard: boolean;
  canUndo: boolean;
  canRedo: boolean;
  zoom: number;
  toast: { text: string; id: number; action?: { label: string; run: () => void } } | null;
  busy: { label: string; progress: number; cancel?: () => void } | null;
  trackFrames: number;
  docVersion: number;
}

type Pt = { x: number; y: number };
interface Floating {
  canvas: HTMLCanvasElement;
  cx: number; cy: number; sx: number; sy: number; rot: number;
  layerId: string; frameId: string;
  patch: PixelPatch;
  cellCanvas: HTMLCanvasElement;
  label: string;
}

type Action =
  | { kind: 'stroke'; id: number; stroke: Stroke; layerId: string; frameId: string; cell: HTMLCanvasElement; t0: number; touch: boolean; erase: boolean; opacity: number; pts: number }
  | { kind: 'shape'; id: number; shape: ShapeKind; a: Pt; b: Pt; rect: Rect | null; layerId: string; frameId: string; cell: HTMLCanvasElement; touch: boolean; t0: number }
  | { kind: 'lasso'; id: number; pts: Pt[]; touch: boolean; t0: number }
  | { kind: 'xform'; id: number; mode: 'move' | 'scale' | 'rotate'; start: Pt; f0: { cx: number; cy: number; sx: number; sy: number; rot: number } }
  | { kind: 'pan'; id: number; last: { x: number; y: number } }
  | { kind: 'pick'; id: number };

const PALETTE_DEFAULT = ['#111111', '#ffffff', '#e11d48', '#f97316', '#facc15', '#22c55e', '#0ea5e9', '#6366f1', '#a855f7', '#8b5a2b'];
export const PALETTE = PALETTE_DEFAULT;

function loadPrefs(): Partial<UIState> {
  try {
    const raw = localStorage.getItem('frameink-prefs');
    return raw ? JSON.parse(raw) : {};
  } catch { return {}; }
}

export class Editor {
  doc: Doc;
  history = new History();
  store: Store<UIState>;
  get ui() { return this.store.get(); }

  private canvas: HTMLCanvasElement | null = null;
  private host: HTMLElement | null = null;
  private dpr = 1;
  private vw = 0; private vh = 0;
  // view: screen = pan + R(rot) * zoom * doc
  private zoom = 1; private rot = 0; private panX = 0; private panY = 0;

  private strokeCanvas: HTMLCanvasElement;
  private tmpCanvas: HTMLCanvasElement;
  private onionCanvas: HTMLCanvasElement;
  private onionKey = '';
  private edgeCache = new Map<string, HTMLCanvasElement>();
  private floating: Floating | null = null;
  private clipboard: { canvas: HTMLCanvasElement; cx: number; cy: number; sx: number; sy: number; rot: number } | null = null;

  private action: Action | null = null;
  private pointers = new Map<number, { x: number; y: number; type: string }>();
  private gesture: { d: number; a: number; cx: number; cy: number; zoom: number; rot: number; panX: number; panY: number; sx: number; sy: number } | null = null;
  private tap: { t: number; max: number; moved: boolean; sx: number; sy: number } | null = null;
  private hover: Pt | null = null; // screen
  private spaceDown = false;
  private needsRender = true;
  private raf = 0;
  private playT0 = 0; private playF0 = 0;
  private audioEl: HTMLVideoElement | null = null;
  private audioUrl: string | null = null;
  private audioStop = 0;
  private trackPreview: Pt[] | null = null;
  private unsub: (() => void)[] = [];
  private thumbTimers = new Map<string, number>();
  private tracking = false;
  private toastTimer = 0;

  constructor(doc: Doc) {
    this.doc = doc;
    const p = loadPrefs();
    const brush = (size: number, smoothing = 0.35): BrushPrefs => ({ size, opacity: 1, smoothing, pressureSize: true, pressureOpacity: false });
    this.store = new Store<UIState>({
      tool: 'pen',
      color: '#111111',
      recent: [],
      brushes: { pen: brush(6), pencil: { ...brush(3, 0.2), pressureOpacity: true }, brush: { ...brush(24, 0.4), opacity: 0.9 }, eraser: { ...brush(24, 0.2), pressureSize: false } },
      shapeSize: 4,
      frame: 0,
      layerId: doc.layers[doc.layers.length - 1].id,
      onion: 'before',
      onionBefore: 2,
      onionAfter: 1,
      onionOpacity: 0.35,
      onionTint: true,
      videoVisible: true,
      videoOpacity: 0.6,
      edgeGuide: false,
      edgeThreshold: 60,
      fingerMode: 'auto',
      penSeen: false,
      playing: false,
      loop: true,
      speed: 1,
      audio: false,
      fillTolerance: 20,
      fillGap: 3,
      fillAllLayers: true,
      hasSelection: false,
      hasClipboard: false,
      canUndo: false,
      canRedo: false,
      zoom: 1,
      toast: null,
      busy: null,
      trackFrames: 0,
      docVersion: 0,
      ...p,
    } as UIState);
    if (!doc.layers.find((l) => l.id === this.ui.layerId)) this.store.set({ layerId: doc.layers[doc.layers.length - 1].id });
    this.store.set({ frame: 0, playing: false, hasSelection: false, toast: null, busy: null });
    this.strokeCanvas = makeCanvas(doc.w, doc.h);
    this.tmpCanvas = makeCanvas(doc.w, doc.h);
    this.onionCanvas = makeCanvas(doc.w, doc.h);
    this.history.onChange = () => this.store.set({ canUndo: this.history.canUndo, canRedo: this.history.canRedo });
    this.unsub.push(doc.subscribe(() => this.requestRender()));
    this.unsub.push(this.store.subscribe(() => { this.requestRender(); this.savePrefs(); }));
    this.pinFrame();
  }

  private prefsTimer = 0;
  private savePrefs() {
    clearTimeout(this.prefsTimer);
    this.prefsTimer = window.setTimeout(() => {
      const s = this.ui;
      const keep = { color: s.color, recent: s.recent, brushes: s.brushes, shapeSize: s.shapeSize, onion: s.onion, onionBefore: s.onionBefore, onionAfter: s.onionAfter, onionOpacity: s.onionOpacity, onionTint: s.onionTint, videoOpacity: s.videoOpacity, fingerMode: s.fingerMode, penSeen: s.penSeen, loop: s.loop, speed: s.speed, fillTolerance: s.fillTolerance, fillGap: s.fillGap, fillAllLayers: s.fillAllLayers, edgeThreshold: s.edgeThreshold };
      try { localStorage.setItem('frameink-prefs', JSON.stringify(keep)); } catch {}
    }, 400);
  }

  // ------------------------------------------------------------------ lifecycle
  attach(canvas: HTMLCanvasElement, host: HTMLElement) {
    this.canvas = canvas;
    this.host = host;
    const ro = new ResizeObserver(() => this.resize());
    ro.observe(host);
    this.resize();
    this.fit();
    const opts = { passive: false } as AddEventListenerOptions;
    const down = (e: PointerEvent) => this.onDown(e);
    const move = (e: PointerEvent) => this.onMove(e);
    const up = (e: PointerEvent) => this.onUp(e);
    const leave = () => { this.hover = null; this.requestRender(); };
    const wheel = (e: WheelEvent) => this.onWheel(e);
    const ctx = (e: Event) => e.preventDefault();
    const gst = (e: Event) => e.preventDefault();
    canvas.addEventListener('pointerdown', down, opts);
    canvas.addEventListener('pointermove', move, opts);
    canvas.addEventListener('pointerup', up, opts);
    canvas.addEventListener('pointercancel', up, opts);
    canvas.addEventListener('pointerleave', leave);
    canvas.addEventListener('wheel', wheel, opts);
    canvas.addEventListener('contextmenu', ctx);
    canvas.addEventListener('touchstart', gst, opts); // stops iOS magnifier/selection
    document.addEventListener('gesturestart', gst, opts);
    const kd = (e: KeyboardEvent) => this.onKey(e, true);
    const ku = (e: KeyboardEvent) => this.onKey(e, false);
    window.addEventListener('keydown', kd);
    window.addEventListener('keyup', ku);
    this.unsub.push(() => {
      ro.disconnect();
      canvas.removeEventListener('pointerdown', down);
      canvas.removeEventListener('pointermove', move);
      canvas.removeEventListener('pointerup', up);
      canvas.removeEventListener('pointercancel', up);
      canvas.removeEventListener('pointerleave', leave);
      canvas.removeEventListener('wheel', wheel);
      canvas.removeEventListener('contextmenu', ctx);
      canvas.removeEventListener('touchstart', gst);
      document.removeEventListener('gesturestart', gst);
      window.removeEventListener('keydown', kd);
      window.removeEventListener('keyup', ku);
    });
    const loop = () => {
      this.raf = requestAnimationFrame(loop);
      this.tick();
    };
    this.raf = requestAnimationFrame(loop);
  }

  destroy() {
    cancelAnimationFrame(this.raf);
    this.commitFloating();
    this.stop();
    this.unsub.forEach((u) => u());
    this.unsub = [];
    if (this.audioUrl) URL.revokeObjectURL(this.audioUrl);
    this.doc.save();
  }

  private resize() {
    if (!this.canvas || !this.host) return;
    const r = this.host.getBoundingClientRect();
    const oldW = this.vw, oldH = this.vh;
    this.dpr = Math.min(window.devicePixelRatio || 1, 3);
    this.vw = r.width; this.vh = r.height;
    this.canvas.width = Math.round(r.width * this.dpr);
    this.canvas.height = Math.round(r.height * this.dpr);
    this.canvas.style.width = r.width + 'px';
    this.canvas.style.height = r.height + 'px';
    if (oldW) { this.panX += (this.vw - oldW) / 2; this.panY += (this.vh - oldH) / 2; }
    this.requestRender();
  }

  fit() {
    const m = this.vw < 600 ? 12 : 32;
    const z = Math.min((this.vw - m * 2) / this.doc.w, (this.vh - m * 2) / this.doc.h);
    this.zoom = Math.max(0.02, z);
    this.rot = 0;
    this.panX = (this.vw - this.doc.w * this.zoom) / 2;
    this.panY = (this.vh - this.doc.h * this.zoom) / 2;
    this.store.set({ zoom: this.zoom });
    this.requestRender();
  }
  zoomBy(f: number, sx = this.vw / 2, sy = this.vh / 2) {
    const d = this.toDoc(sx, sy);
    this.zoom = Math.min(64, Math.max(0.05, this.zoom * f));
    const s = this.toScreenRaw(d.x, d.y);
    this.panX += sx - s.x; this.panY += sy - s.y;
    this.store.set({ zoom: this.zoom });
    this.requestRender();
  }
  actualSize() { this.zoomBy(1 / this.zoom); }

  requestRender() { this.needsRender = true; }

  // ------------------------------------------------------------------ coordinates
  private toDoc(sx: number, sy: number): Pt {
    const x = sx - this.panX, y = sy - this.panY;
    const c = Math.cos(-this.rot), s = Math.sin(-this.rot);
    return { x: (x * c - y * s) / this.zoom, y: (x * s + y * c) / this.zoom };
  }
  private toScreenRaw(dx: number, dy: number): Pt {
    const c = Math.cos(this.rot), s = Math.sin(this.rot);
    const x = dx * this.zoom, y = dy * this.zoom;
    return { x: x * c - y * s + this.panX, y: x * s + y * c + this.panY };
  }
  private local(e: { clientX: number; clientY: number }) {
    const r = this.canvas!.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }

  // ------------------------------------------------------------------ helpers
  get frame() { return this.doc.frames[this.ui.frame]; }
  get drawFrame() { return this.doc.frames[this.doc.drawingIndex(this.ui.frame)]; }
  get layer() { return this.doc.layers.find((l) => l.id === this.ui.layerId) ?? this.doc.layers[0]; }

  toast(text: string, action?: { label: string; run: () => void }) {
    clearTimeout(this.toastTimer);
    this.store.set({ toast: { text, id: Date.now(), action } });
    this.toastTimer = window.setTimeout(() => this.store.set({ toast: null }), action ? 5000 : 2600);
  }

  private bump() {
    this.store.set((s) => ({ docVersion: s.docVersion + 1 }));
    this.onionKey = '';
  }

  private thumbSoon(frameId: string) {
    clearTimeout(this.thumbTimers.get(frameId));
    this.thumbTimers.set(frameId, window.setTimeout(() => {
      this.doc.updateThumb(frameId);
      // frames holding this drawing share its thumbnail content
      const i = this.doc.frameIndex(frameId);
      for (let j = i + 1; j < this.doc.frames.length && this.doc.frames[j].hold; j++) this.doc.updateThumb(this.doc.frames[j].id);
    }, 250));
  }

  private edited(frameId: string) {
    this.bump();
    this.thumbSoon(frameId);
    this.doc.scheduleSave();
  }

  pinFrame() {
    const d = this.doc;
    const pins = new Set<string>();
    const s = this.ui;
    const idx = new Set<number>([d.drawingIndex(s.frame)]);
    if (s.onion === 'before' || s.onion === 'both') for (let k = 1; k <= s.onionBefore; k++) idx.add(d.drawingIndex(Math.max(0, s.frame - k)));
    if (s.onion === 'after' || s.onion === 'both') for (let k = 1; k <= s.onionAfter; k++) idx.add(d.drawingIndex(Math.min(d.frames.length - 1, s.frame + k)));
    for (const i of idx) {
      const f = d.frames[i];
      if (!f) continue;
      for (const l of d.layers) {
        if (d.hasCell(l.id, f.id)) { pins.add(d.key(l.id, f.id)); d.ensure(l.id, f.id); }
      }
    }
    d.pinned = pins;
    // preload neighbouring video frames
    for (let k = -2; k <= 3; k++) {
      const f = d.frames[s.frame + k];
      if (f) d.loadVideoFrame(f.id);
    }
  }

  // ------------------------------------------------------------------ navigation
  goto(i: number, scrub = false) {
    const n = this.doc.frames.length;
    if (!n) return;
    if (this.ui.loop || this.ui.playing) i = ((i % n) + n) % n; else i = Math.max(0, Math.min(n - 1, i));
    if (i === this.ui.frame) return;
    this.commitFloating();
    this.cancelAction();
    this.store.set({ frame: i });
    this.onionKey = '';
    this.trackPreview = null;
    this.pinFrame();
    if (scrub && this.ui.audio && !this.ui.playing) this.scrubAudio(i);
  }
  next() { this.goto(this.ui.frame + 1, true); }
  prev() { this.goto(this.ui.frame - 1, true); }

  // ------------------------------------------------------------------ playback & audio
  private ensureAudio(): HTMLVideoElement | null {
    if (!this.doc.sourceVideo) return null;
    if (!this.audioEl) {
      this.audioUrl = URL.createObjectURL(this.doc.sourceVideo);
      const v = document.createElement('video');
      v.src = this.audioUrl;
      v.playsInline = true;
      v.preload = 'auto';
      this.audioEl = v;
    }
    return this.audioEl;
  }
  private scrubAudio(i: number) {
    const v = this.ensureAudio();
    const t = this.doc.frames[i]?.t;
    if (!v || t == null) return;
    try {
      v.currentTime = t;
      v.playbackRate = 1;
      v.play().catch(() => {});
      clearTimeout(this.audioStop);
      this.audioStop = window.setTimeout(() => v.pause(), Math.max(120, 1000 / this.doc.meta.fps));
    } catch {}
  }

  play() {
    if (this.ui.playing) return;
    this.commitFloating();
    if (this.ui.frame >= this.doc.frames.length - 1) this.store.set({ frame: 0 });
    this.playT0 = performance.now();
    this.playF0 = this.ui.frame;
    this.store.set({ playing: true });
    // preload every video frame bitmap near the start
    for (let k = 0; k < 12; k++) { const f = this.doc.frames[this.ui.frame + k]; if (f) this.doc.loadVideoFrame(f.id); }
    if (this.ui.audio) {
      const v = this.ensureAudio();
      const t = this.frame?.t;
      if (v && t != null) {
        v.currentTime = t;
        v.playbackRate = this.ui.speed;
        v.play().catch(() => {});
      }
    }
  }
  stop() {
    if (!this.ui.playing) return;
    this.store.set({ playing: false });
    this.audioEl?.pause();
    this.pinFrame();
    this.onionKey = '';
  }
  togglePlay() { this.ui.playing ? this.stop() : this.play(); }

  private tick() {
    const s = this.ui;
    if (s.playing) {
      const n = this.doc.frames.length;
      let target: number;
      const v = this.audioEl;
      const useAudio = s.audio && v && !v.paused && this.doc.frames[0]?.t != null;
      if (useAudio) {
        const ct = v!.currentTime;
        let i = 0;
        // frames are time-sorted for imported video; find last frame with t <= current time
        let lo = 0, hi = n - 1;
        while (lo <= hi) { const m = (lo + hi) >> 1; if ((this.doc.frames[m].t ?? 0) <= ct + 0.001) { i = m; lo = m + 1; } else hi = m - 1; }
        target = i;
        const endT = (this.doc.frames[n - 1].t ?? 0) + 1 / this.doc.meta.fps;
        if (ct >= endT || v!.ended) {
          if (s.loop) { v!.currentTime = this.doc.frames[0].t ?? 0; v!.play().catch(() => {}); target = 0; }
          else { this.stop(); return; }
        }
      } else {
        const el = (performance.now() - this.playT0) / 1000;
        const adv = Math.floor(el * this.doc.meta.fps * s.speed);
        target = this.playF0 + adv;
        if (target >= n) {
          if (s.loop) target = target % n;
          else { this.store.set({ frame: n - 1 }); this.stop(); return; }
        }
      }
      if (target !== s.frame) {
        this.store.set({ frame: target });
        for (let k = 1; k < 8; k++) { const f = this.doc.frames[(target + k) % n]; if (f) this.doc.loadVideoFrame(f.id); }
        // keep drawings for the next frames loading
        for (let k = 1; k < 4; k++) {
          const f = this.doc.frames[this.doc.drawingIndex((target + k) % n)];
          if (f) for (const l of this.doc.layers) this.doc.peek(l.id, f.id);
        }
      }
    }
    if (this.needsRender) {
      this.needsRender = false;
      this.render();
    }
  }

  // ------------------------------------------------------------------ rendering
  private buildOnion() {
    const s = this.ui;
    const d = this.doc;
    const key = [s.frame, s.onion, s.onionBefore, s.onionAfter, s.onionOpacity, s.onionTint, s.docVersion, d.layers.map((l) => l.visible + '' + l.opacity).join()].join('|');
    if (key === this.onionKey) return;
    let complete = true;
    const x = ctx2d(this.onionCanvas);
    x.clearRect(0, 0, d.w, d.h);
    const cur = d.drawingIndex(s.frame);
    const draw = (i: number, tint: string, alpha: number) => {
      const f = d.frames[i];
      const t = ctx2d(this.tmpCanvas);
      t.globalCompositeOperation = 'source-over';
      t.clearRect(0, 0, d.w, d.h);
      let any = false;
      for (const l of d.layers) {
        if (!l.visible || !d.hasCell(l.id, f.id)) continue;
        const c = d.peek(l.id, f.id);
        if (!c) { complete = false; continue; }
        t.globalAlpha = l.opacity;
        t.drawImage(c, 0, 0);
        any = true;
      }
      t.globalAlpha = 1;
      if (!any) return;
      if (s.onionTint) {
        t.globalCompositeOperation = 'source-atop';
        t.fillStyle = tint;
        t.fillRect(0, 0, d.w, d.h);
        t.globalCompositeOperation = 'source-over';
      }
      x.globalAlpha = alpha;
      x.drawImage(this.tmpCanvas, 0, 0);
      x.globalAlpha = 1;
    };
    const seen = new Set<number>([cur]);
    const collect = (dir: -1 | 1, count: number) => {
      const out: number[] = [];
      let i = s.frame;
      while (out.length < count) {
        i += dir;
        if (i < 0 || i >= d.frames.length) break;
        const di = d.drawingIndex(i);
        if (seen.has(di)) continue;
        seen.add(di);
        out.push(di);
      }
      return out;
    };
    const before = s.onion === 'before' || s.onion === 'both' ? collect(-1, s.onionBefore) : [];
    const after = s.onion === 'after' || s.onion === 'both' ? collect(1, s.onionAfter) : [];
    // draw farthest first
    before.slice().reverse().forEach((i, k) => draw(i, '#ef4444', s.onionOpacity * ((k + 1) / before.length)));
    after.slice().reverse().forEach((i, k) => draw(i, '#16a34a', s.onionOpacity * ((k + 1) / after.length)));
    if (complete) this.onionKey = key;
  }

  private render() {
    const cv = this.canvas;
    if (!cv) return;
    const x = ctx2d(cv);
    const d = this.doc;
    const s = this.ui;
    x.setTransform(1, 0, 0, 1, 0, 0);
    x.clearRect(0, 0, cv.width, cv.height);
    const dpr = this.dpr;
    const c = Math.cos(this.rot) * this.zoom, sn = Math.sin(this.rot) * this.zoom;
    x.setTransform(c * dpr, sn * dpr, -sn * dpr, c * dpr, this.panX * dpr, this.panY * dpr);
    x.imageSmoothingEnabled = this.zoom < 2;
    // paper
    x.shadowColor = 'rgba(0,0,0,0.35)';
    x.shadowBlur = 18 * dpr;
    x.fillStyle = d.meta.paper;
    x.fillRect(0, 0, d.w, d.h);
    x.shadowBlur = 0;
    x.shadowColor = 'transparent';
    const f = this.frame;
    if (!f) return;
    // video
    if (d.meta.hasVideo && s.videoVisible && s.videoOpacity > 0) {
      const v = d.videoFrame(f.id);
      if (v) {
        x.globalAlpha = s.videoOpacity;
        x.drawImage(v as CanvasImageSource, 0, 0, d.w, d.h);
        x.globalAlpha = 1;
      }
    }
    if (s.edgeGuide && d.meta.hasVideo && !s.playing) {
      let e = this.edgeCache.get(f.id + ':' + s.edgeThreshold);
      if (!e) {
        const v = d.videoFrame(f.id);
        if (v) {
          e = edgeGuide(v as CanvasImageSource, d.w, d.h, s.edgeThreshold);
          if (this.edgeCache.size > 30) this.edgeCache.clear();
          this.edgeCache.set(f.id + ':' + s.edgeThreshold, e);
        }
      }
      if (e) { x.globalAlpha = 0.7; x.drawImage(e, 0, 0, d.w, d.h); x.globalAlpha = 1; }
    }
    // onion
    if (s.onion !== 'off' && !s.playing) {
      this.buildOnion();
      x.drawImage(this.onionCanvas, 0, 0);
    }
    // layers
    const df = this.drawFrame;
    const a = this.action;
    for (const l of d.layers) {
      if (!l.visible) continue;
      const cell = d.hasCell(l.id, df.id) ? d.peek(l.id, df.id) : null;
      const activeStroke = a && (a.kind === 'stroke' || a.kind === 'shape') && a.layerId === l.id && a.frameId === df.id ? a : null;
      x.globalAlpha = l.opacity;
      if (activeStroke && activeStroke.kind === 'stroke' && activeStroke.erase) {
        const t = ctx2d(this.tmpCanvas);
        t.globalCompositeOperation = 'source-over';
        t.clearRect(0, 0, d.w, d.h);
        if (cell) t.drawImage(cell, 0, 0);
        t.globalCompositeOperation = 'destination-out';
        t.globalAlpha = activeStroke.opacity;
        t.drawImage(this.strokeCanvas, 0, 0);
        t.globalAlpha = 1;
        t.globalCompositeOperation = 'source-over';
        x.drawImage(this.tmpCanvas, 0, 0);
        this.onionKey = '';
      } else {
        if (cell) x.drawImage(cell, 0, 0);
        if (activeStroke) {
          x.globalAlpha = l.opacity * (activeStroke.kind === 'stroke' ? activeStroke.opacity : 1);
          x.drawImage(this.strokeCanvas, 0, 0);
        }
      }
      x.globalAlpha = 1;
      if (this.floating && this.floating.layerId === l.id) {
        const fl = this.floating;
        x.save();
        x.translate(fl.cx, fl.cy);
        x.rotate(fl.rot);
        x.scale(fl.sx, fl.sy);
        x.globalAlpha = l.opacity;
        x.drawImage(fl.canvas, -fl.canvas.width / 2, -fl.canvas.height / 2);
        x.restore();
      }
    }
    x.globalAlpha = 1;
    // ---- overlays in screen space
    x.setTransform(dpr, 0, 0, dpr, 0, 0);
    if (a && a.kind === 'lasso' && a.pts.length > 1) {
      x.beginPath();
      a.pts.forEach((p, i) => { const q = this.toScreenRaw(p.x, p.y); i ? x.lineTo(q.x, q.y) : x.moveTo(q.x, q.y); });
      x.closePath();
      x.fillStyle = 'rgba(127,127,127,0.08)';
      x.fill();
      x.lineWidth = 1.5;
      x.setLineDash([5, 4]);
      x.strokeStyle = '#fff';
      x.stroke();
      x.lineDashOffset = 5;
      x.strokeStyle = '#111111';
      x.stroke();
      x.setLineDash([]);
      x.lineDashOffset = 0;
    }
    if (this.floating) this.drawHandles(x);
    if (this.trackPreview) {
      x.beginPath();
      this.trackPreview.forEach((p, i) => { const q = this.toScreenRaw(p.x, p.y); i ? x.lineTo(q.x, q.y) : x.moveTo(q.x, q.y); });
      x.strokeStyle = '#f59e0b';
      x.lineWidth = 2;
      x.stroke();
      const p0 = this.trackPreview[0];
      if (p0) {
        const q = this.toScreenRaw(p0.x, p0.y);
        x.beginPath(); x.arc(q.x, q.y, 7, 0, Math.PI * 2); x.stroke();
      }
    }
    if (this.hover && !s.playing && !this.gesture) {
      const t = s.tool;
      if (t === 'pen' || t === 'pencil' || t === 'brush' || t === 'eraser') {
        const r = Math.max(1.5, (s.brushes[t].size * this.zoom) / 2);
        x.beginPath();
        x.arc(this.hover.x, this.hover.y, r, 0, Math.PI * 2);
        x.lineWidth = 1;
        x.strokeStyle = 'rgba(255,255,255,0.9)';
        x.stroke();
        x.beginPath();
        x.arc(this.hover.x, this.hover.y, r + 1, 0, Math.PI * 2);
        x.strokeStyle = 'rgba(0,0,0,0.6)';
        x.stroke();
      }
    }
  }

  private floatCorners(): Pt[] {
    const fl = this.floating!;
    const w = fl.canvas.width / 2, h = fl.canvas.height / 2;
    const c = Math.cos(fl.rot), s = Math.sin(fl.rot);
    return [[-w, -h], [w, -h], [w, h], [-w, h]].map(([px, py]) => {
      const X = px * fl.sx, Y = py * fl.sy;
      const dx = fl.cx + X * c - Y * s, dy = fl.cy + X * s + Y * c;
      return this.toScreenRaw(dx, dy);
    });
  }
  private rotHandle(): Pt {
    const k = this.floatCorners();
    const mx = (k[0].x + k[1].x) / 2, my = (k[0].y + k[1].y) / 2;
    const cx = (k[0].x + k[2].x) / 2, cy = (k[0].y + k[2].y) / 2;
    const dx = mx - cx, dy = my - cy;
    const len = Math.hypot(dx, dy) || 1;
    return { x: mx + (dx / len) * 34, y: my + (dy / len) * 34 };
  }
  private drawHandles(x: CanvasRenderingContext2D) {
    const k = this.floatCorners();
    x.beginPath();
    k.forEach((p, i) => (i ? x.lineTo(p.x, p.y) : x.moveTo(p.x, p.y)));
    x.closePath();
    x.lineWidth = 1.5;
    x.strokeStyle = '#ffffff';
    x.stroke();
    x.setLineDash([6, 4]);
    x.strokeStyle = '#111111';
    x.stroke();
    x.setLineDash([]);
    const r = this.rotHandle();
    const mx = (k[0].x + k[1].x) / 2, my = (k[0].y + k[1].y) / 2;
    x.beginPath(); x.moveTo(mx, my); x.lineTo(r.x, r.y); x.stroke();
    for (const p of k) {
      x.beginPath();
      x.rect(p.x - 6, p.y - 6, 12, 12);
      x.fillStyle = '#fff'; x.fill(); x.strokeStyle = '#111111'; x.stroke();
    }
    x.beginPath(); x.arc(r.x, r.y, 7, 0, Math.PI * 2); x.fillStyle = '#111111'; x.fill(); x.strokeStyle = '#fff'; x.stroke();
  }

  // ------------------------------------------------------------------ input
  private fingerDraws() {
    const m = this.ui.fingerMode;
    return m === 'draw' || (m === 'auto' && !this.ui.penSeen);
  }

  private onDown(e: PointerEvent) {
    e.preventDefault();
    const p = this.local(e);
    try { this.canvas!.setPointerCapture(e.pointerId); } catch {}
    this.pointers.set(e.pointerId, { ...p, type: e.pointerType });
    if (e.pointerType === 'pen') {
      if (!this.ui.penSeen) this.store.set({ penSeen: true });
      // palm rejection: a pen cancels any touch gesture
      this.gesture = null;
      this.tap = null;
      if (this.action && (this.action as any).touch) this.cancelAction();
      if (this.ui.playing) this.stop();
      this.beginTool(e, p, false);
      return;
    }
    if (e.pointerType === 'touch') {
      if (this.penActive()) { this.pointers.delete(e.pointerId); return; }
      const touches = this.touchPoints();
      if (touches.length === 1) this.tap = { t: performance.now(), max: 1, moved: false, sx: p.x, sy: p.y };
      else if (this.tap) this.tap.max = Math.max(this.tap.max, touches.length);
      if (touches.length >= 2) {
        // second finger: cancel a fresh one-finger stroke and start pinch/pan/rotate
        if (this.action && this.action.kind !== 'pan') {
          const young = 'touch' in this.action && this.action.touch;
          if (young) this.cancelAction(); else if (this.action.kind === 'xform') this.action = null;
        }
        if (this.action?.kind === 'pan') this.action = null;
        this.startGesture();
        return;
      }
      if (this.ui.playing) { this.stop(); return; }
      if (this.ui.tool === 'hand' || !this.fingerDraws()) {
        // fingers still move the selection when a selection is active
        if (this.floating && this.ui.tool === 'lasso' && this.hitFloating(p)) { this.beginTool(e, p, true); return; }
        this.action = { kind: 'pan', id: e.pointerId, last: p };
        return;
      }
      this.beginTool(e, p, true);
      return;
    }
    // mouse
    if (e.button === 1 || this.spaceDown || this.ui.tool === 'hand' || (e.button === 0 && e.altKey && this.ui.tool !== 'eyedropper')) {
      this.action = { kind: 'pan', id: e.pointerId, last: p };
      return;
    }
    if (e.button !== 0) return;
    if (this.ui.playing) this.stop();
    this.beginTool(e, p, false);
  }

  private penActive() { for (const v of this.pointers.values()) if (v.type === 'pen') return true; return false; }
  private touchPoints() { return [...this.pointers.values()].filter((v) => v.type === 'touch'); }

  private startGesture() {
    const t = this.touchPoints();
    if (t.length < 2) { this.gesture = null; return; }
    const [a, b] = t;
    this.gesture = {
      d: Math.hypot(b.x - a.x, b.y - a.y) || 1,
      a: Math.atan2(b.y - a.y, b.x - a.x),
      cx: (a.x + b.x) / 2, cy: (a.y + b.y) / 2,
      zoom: this.zoom, rot: this.rot, panX: this.panX, panY: this.panY,
      sx: 0, sy: 0,
    };
    const d0 = this.toDoc(this.gesture.cx, this.gesture.cy);
    this.gesture.sx = d0.x; this.gesture.sy = d0.y;
  }

  private updateGesture() {
    const g = this.gesture!;
    const t = this.touchPoints();
    if (t.length < 2) return;
    const [a, b] = t;
    const d = Math.hypot(b.x - a.x, b.y - a.y) || 1;
    const ang = Math.atan2(b.y - a.y, b.x - a.x);
    const cx = (a.x + b.x) / 2, cy = (a.y + b.y) / 2;
    if (this.tap && (Math.abs(d - g.d) > 14 || Math.hypot(cx - g.cx, cy - g.cy) > 14)) this.tap.moved = true;
    this.zoom = Math.min(64, Math.max(0.05, g.zoom * (d / g.d)));
    let rot = g.rot + (ang - g.a);
    // snap to straight within 6 degrees
    const deg = ((rot * 180) / Math.PI) % 90;
    if (Math.abs(deg) < 6 || Math.abs(Math.abs(deg) - 90) < 6) rot = Math.round(rot / (Math.PI / 2)) * (Math.PI / 2);
    this.rot = rot;
    // keep the doc point under the fingers' center
    this.panX = 0; this.panY = 0;
    const s = this.toScreenRaw(g.sx, g.sy);
    this.panX = cx - s.x; this.panY = cy - s.y;
    this.store.set({ zoom: this.zoom });
    this.requestRender();
  }

  private onMove(e: PointerEvent) {
    const p = this.local(e);
    const ptr = this.pointers.get(e.pointerId);
    if (e.pointerType !== 'touch') { this.hover = p; this.requestRender(); }
    if (!ptr) return;
    ptr.x = p.x; ptr.y = p.y;
    if (this.tap && e.pointerType === 'touch' && Math.hypot(p.x - this.tap.sx, p.y - this.tap.sy) > 12 && this.touchPoints().length === 1) this.tap.moved = true;
    if (this.gesture && e.pointerType === 'touch') { this.updateGesture(); return; }
    const a = this.action;
    if (!a || a.id !== e.pointerId) return;
    const events = typeof e.getCoalescedEvents === 'function' ? e.getCoalescedEvents() : [];
    const list = events.length ? events : [e];
    switch (a.kind) {
      case 'pan': {
        this.panX += p.x - a.last.x; this.panY += p.y - a.last.y;
        a.last = p;
        this.requestRender();
        break;
      }
      case 'stroke': {
        for (const ev of list) {
          const q = this.local(ev);
          const d = this.toDoc(q.x, q.y);
          a.stroke.add(d.x, d.y, this.pressure(ev));
        }
        a.pts += list.length;
        this.requestRender();
        break;
      }
      case 'shape': {
        const d = this.toDoc(p.x, p.y);
        a.b = this.constrain(a.shape, a.a, d, e.shiftKey);
        a.rect = drawShape(this.strokeCanvas, a.shape, a.a.x, a.a.y, a.b.x, a.b.y, this.ui.color, this.ui.shapeSize, a.rect);
        this.requestRender();
        break;
      }
      case 'lasso': {
        const d = this.toDoc(p.x, p.y);
        const last = a.pts[a.pts.length - 1];
        if (!last || Math.hypot(d.x - last.x, d.y - last.y) * this.zoom > 2) a.pts.push(d);
        this.requestRender();
        break;
      }
      case 'xform': {
        const fl = this.floating;
        if (!fl) break;
        const d = this.toDoc(p.x, p.y);
        const f0 = a.f0;
        if (a.mode === 'move') { fl.cx = f0.cx + d.x - a.start.x; fl.cy = f0.cy + d.y - a.start.y; }
        else if (a.mode === 'scale') {
          const k = Math.hypot(d.x - f0.cx, d.y - f0.cy) / Math.max(1, Math.hypot(a.start.x - f0.cx, a.start.y - f0.cy));
          fl.sx = f0.sx * k; fl.sy = f0.sy * k;
        } else {
          let r = f0.rot + Math.atan2(d.y - f0.cy, d.x - f0.cx) - Math.atan2(a.start.y - f0.cy, a.start.x - f0.cx);
          if (e.shiftKey) r = Math.round(r / (Math.PI / 12)) * (Math.PI / 12);
          fl.rot = r;
        }
        this.requestRender();
        break;
      }
      case 'pick': this.pickColor(p); break;
    }
  }

  private constrain(shape: ShapeKind, a: Pt, b: Pt, shift: boolean): Pt {
    if (!shift) return b;
    const dx = b.x - a.x, dy = b.y - a.y;
    if (shape === 'line') {
      const ang = Math.round(Math.atan2(dy, dx) / (Math.PI / 12)) * (Math.PI / 12);
      const len = Math.hypot(dx, dy);
      return { x: a.x + Math.cos(ang) * len, y: a.y + Math.sin(ang) * len };
    }
    const m = Math.max(Math.abs(dx), Math.abs(dy));
    return { x: a.x + Math.sign(dx || 1) * m, y: a.y + Math.sign(dy || 1) * m };
  }

  private pressure(e: PointerEvent) {
    if (e.pointerType === 'pen') {
      let p = e.pressure || 0.5;
      // tilt widens the pencil like shading with the side of a lead
      if (this.ui.tool === 'pencil' && (e.tiltX || e.tiltY)) {
        const tilt = Math.min(60, Math.hypot(e.tiltX, e.tiltY));
        p = Math.min(1, p * (1 + tilt / 60));
      }
      return p;
    }
    return 1;
  }

  private onUp(e: PointerEvent) {
    const p = this.local(e);
    const ptr = this.pointers.get(e.pointerId);
    this.pointers.delete(e.pointerId);
    if (e.pointerType === 'touch') {
      const left = this.touchPoints().length;
      if (this.gesture) {
        if (left >= 2) this.startGesture();
        else this.gesture = null;
      }
      if (left === 0 && this.tap) {
        const tap = this.tap;
        this.tap = null;
        const quick = performance.now() - tap.t < 320 && !tap.moved;
        if (quick && tap.max === 2) { this.cancelAction(); this.undo(); return; }
        if (quick && tap.max >= 3) { this.cancelAction(); this.redo(); return; }
      }
    }
    if (!ptr) return;
    const a = this.action;
    if (!a || a.id !== e.pointerId) return;
    if (e.type === 'pointercancel' && a.kind !== 'pan' && a.kind !== 'xform') { this.cancelAction(); return; }
    this.action = null;
    switch (a.kind) {
      case 'stroke': {
        const d = this.toDoc(p.x, p.y);
        a.stroke.finish(d.x, d.y, this.pressure(e));
        this.commitStroke(a);
        break;
      }
      case 'shape': this.commitShape(a); break;
      case 'lasso': this.finishLasso(a.pts); break;
      case 'xform': this.requestRender(); break;
    }
    this.requestRender();
  }

  private cancelAction() {
    const a = this.action;
    if (!a) return;
    if (a.kind === 'stroke' || a.kind === 'shape') {
      ctx2d(this.strokeCanvas).clearRect(0, 0, this.doc.w, this.doc.h);
    }
    this.action = null;
    this.requestRender();
  }

  private onWheel(e: WheelEvent) {
    e.preventDefault();
    const p = this.local(e);
    if (e.ctrlKey || e.metaKey || Math.abs(e.deltaY) >= 40 && !e.shiftKey && e.deltaMode !== 0 || (e.deltaMode === 0 && Math.abs(e.deltaY) >= 50 && Number.isInteger(e.deltaY) && e.deltaX === 0)) {
      // pinch on trackpad (ctrl) or mouse wheel notches: zoom
      const f = Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.0018));
      this.zoomBy(f, p.x, p.y);
    } else {
      // two-finger trackpad scroll: pan
      this.panX -= e.deltaX; this.panY -= e.deltaY;
      this.requestRender();
    }
  }

  private onKey(e: KeyboardEvent, down: boolean) {
    const tgt = e.target as HTMLElement;
    if (tgt && (tgt.tagName === 'INPUT' || tgt.tagName === 'TEXTAREA' || tgt.tagName === 'SELECT' || tgt.isContentEditable)) return;
    if (e.code === 'Space') { this.spaceDown = down; e.preventDefault(); return; }
    if (!down) return;
    const mod = e.metaKey || e.ctrlKey;
    const k = e.key.toLowerCase();
    if (mod && k === 'z') { e.preventDefault(); e.shiftKey ? this.redo() : this.undo(); return; }
    if (mod && k === 'y') { e.preventDefault(); this.redo(); return; }
    if (mod && k === 'c') { if (this.floating) { e.preventDefault(); this.copySelection(); } return; }
    if (mod && k === 'x') { if (this.floating) { e.preventDefault(); this.cutSelection(); } return; }
    if (mod && k === 'v') { e.preventDefault(); this.paste(); return; }
    if (mod && k === 'a') { e.preventDefault(); this.selectAll(); return; }
    if (mod && k === 'd') { e.preventDefault(); this.duplicateToNext(); return; }
    if (mod) return;
    const tools: Record<string, ToolId> = { b: 'pen', n: 'pencil', m: 'brush', e: 'eraser', g: 'fill', l: 'lasso', i: 'eyedropper', u: 'line', r: 'rect', o: 'ellipse', h: 'hand', t: 'track' };
    if (k === 'delete' || k === 'backspace') { if (this.floating) this.deleteSelection(); return; }
    if (k === 'escape') { this.commitFloating(); this.cancelAction(); return; }
    if (k === 'enter' || k === 'p') { this.togglePlay(); return; }
    if (k === ',' || k === 'arrowleft') { this.prev(); return; }
    if (k === '.' || k === 'arrowright') { this.next(); return; }
    if (k === '[') { this.adjustSize(1 / 1.2); return; }
    if (k === ']') { this.adjustSize(1.2); return; }
    if (k === '0') { this.fit(); return; }
    if (k === '1') { this.actualSize(); return; }
    if (k === 'k') { this.cycleOnion(); return; }
    if (k === 'v' && this.doc.meta.hasVideo) { this.store.set({ videoVisible: !this.ui.videoVisible }); return; }
    if (k === '=' || k === '+') { this.zoomBy(1.25); return; }
    if (k === '-') { this.zoomBy(0.8); return; }
    if (tools[k]) this.setTool(tools[k]);
  }

  cycleOnion() {
    const order: OnionMode[] = ['off', 'before', 'after', 'both'];
    this.store.set({ onion: order[(order.indexOf(this.ui.onion) + 1) % 4] });
    this.onionKey = '';
    this.pinFrame();
  }

  adjustSize(f: number) {
    const t = this.ui.tool;
    if (t === 'pen' || t === 'pencil' || t === 'brush' || t === 'eraser') {
      const b = this.ui.brushes[t];
      this.setBrush(t, { size: Math.max(0.5, Math.min(300, Math.round(b.size * f * 10) / 10)) });
    } else if (t === 'line' || t === 'rect' || t === 'ellipse') this.store.set({ shapeSize: Math.max(1, Math.round(this.ui.shapeSize * f)) });
  }

  setBrush(kind: BrushKind, p: Partial<BrushPrefs>) {
    this.store.set((s) => ({ brushes: { ...s.brushes, [kind]: { ...s.brushes[kind], ...p } } }));
  }

  setTool(t: ToolId) {
    if (t !== 'lasso') this.commitFloating();
    this.store.set({ tool: t });
    if (t !== 'track') this.trackPreview = null;
  }

  setColor(c: string, addRecent = true) {
    this.store.set((s) => ({ color: c, recent: addRecent ? [c, ...s.recent.filter((r) => r !== c)].slice(0, 12) : s.recent }));
    if (this.ui.tool === 'eraser' || this.ui.tool === 'eyedropper' || this.ui.tool === 'hand' || this.ui.tool === 'lasso' || this.ui.tool === 'track') this.store.set({ tool: 'pen' });
  }

  // ------------------------------------------------------------------ tools
  private editableCell(): { cell: HTMLCanvasElement; layerId: string; frameId: string } | null {
    const l = this.layer;
    if (!l.visible) { this.toast(`"${l.name}" is hidden. Show the layer to draw on it.`); return null; }
    if (l.locked) { this.toast(`"${l.name}" is locked.`); return null; }
    const f = this.drawFrame;
    const cell = this.doc.ensureSync(l.id, f.id);
    if (!cell) { this.doc.ensure(l.id, f.id).then(() => this.requestRender()); this.toast('Loading this frame, try again in a moment.'); return null; }
    return { cell, layerId: l.id, frameId: f.id };
  }

  private beginTool(e: PointerEvent, p: Pt, touch: boolean) {
    const s = this.ui;
    const d = this.toDoc(p.x, p.y);
    const id = e.pointerId;
    if (this.ui.frame !== this.doc.drawingIndex(this.ui.frame) && ['pen', 'pencil', 'brush', 'eraser', 'fill', 'line', 'rect', 'ellipse'].includes(s.tool) && !this.heldWarned) {
      this.heldWarned = true;
      this.toast(`This frame holds frame ${this.doc.drawingIndex(this.ui.frame) + 1}, so you are editing that drawing.`);
    }
    switch (s.tool) {
      case 'pen': case 'pencil': case 'brush': case 'eraser': {
        const target = this.editableCell();
        if (!target) return;
        ctx2d(this.strokeCanvas).clearRect(0, 0, this.doc.w, this.doc.h);
        const b = s.brushes[s.tool];
        const pen = e.pointerType === 'pen';
        const stroke = new Stroke({
          kind: s.tool,
          color: s.color,
          size: b.size,
          opacity: b.opacity,
          smoothing: b.smoothing,
          pressureSize: b.pressureSize && pen,
          pressureOpacity: b.pressureOpacity && pen,
        }, this.strokeCanvas);
        stroke.add(d.x, d.y, this.pressure(e));
        this.action = { kind: 'stroke', id, stroke, ...target, t0: performance.now(), touch, erase: s.tool === 'eraser', opacity: b.opacity, pts: 1 };
        this.requestRender();
        return;
      }
      case 'line': case 'rect': case 'ellipse': {
        const target = this.editableCell();
        if (!target) return;
        ctx2d(this.strokeCanvas).clearRect(0, 0, this.doc.w, this.doc.h);
        this.action = { kind: 'shape', id, shape: s.tool, a: d, b: d, rect: null, ...target, touch, t0: performance.now() };
        return;
      }
      case 'fill': this.fillAt(d); return;
      case 'eyedropper': this.action = { kind: 'pick', id }; this.pickColor(p); return;
      case 'lasso': {
        if (this.floating) {
          const hit = this.hitFloating(p);
          if (hit) {
            const fl = this.floating;
            this.action = { kind: 'xform', id, mode: hit, start: d, f0: { cx: fl.cx, cy: fl.cy, sx: fl.sx, sy: fl.sy, rot: fl.rot } };
            return;
          }
          this.commitFloating();
        }
        this.action = { kind: 'lasso', id, pts: [d], touch, t0: performance.now() };
        return;
      }
      case 'track': this.startTracking(d); return;
      case 'hand': this.action = { kind: 'pan', id, last: p }; return;
    }
  }
  private heldWarned = false;

  private commitStroke(a: Extract<Action, { kind: 'stroke' }>) {
    const r = a.stroke.rect && clampRect(a.stroke.rect, this.doc.w, this.doc.h);
    if (!r) { ctx2d(this.strokeCanvas).clearRect(0, 0, this.doc.w, this.doc.h); return; }
    const patch = new PixelPatch(this.doc, a.layerId, a.frameId, a.cell, r);
    const x = ctx2d(a.cell);
    x.globalAlpha = a.opacity;
    x.globalCompositeOperation = a.erase ? 'destination-out' : 'source-over';
    x.drawImage(this.strokeCanvas, r.x, r.y, r.w, r.h, r.x, r.y, r.w, r.h);
    x.globalAlpha = 1;
    x.globalCompositeOperation = 'source-over';
    ctx2d(this.strokeCanvas).clearRect(r.x, r.y, r.w, r.h);
    this.doc.markDirty(a.layerId, a.frameId);
    this.history.push(patch.entry(a.erase ? 'Erase' : 'Stroke', a.cell, () => this.edited(a.frameId)));
    this.edited(a.frameId);
  }

  private commitShape(a: Extract<Action, { kind: 'shape' }>) {
    const r = a.rect && clampRect(a.rect, this.doc.w, this.doc.h);
    if (!r || (Math.abs(a.b.x - a.a.x) < 1 && Math.abs(a.b.y - a.a.y) < 1)) { ctx2d(this.strokeCanvas).clearRect(0, 0, this.doc.w, this.doc.h); return; }
    const patch = new PixelPatch(this.doc, a.layerId, a.frameId, a.cell, r);
    ctx2d(a.cell).drawImage(this.strokeCanvas, r.x, r.y, r.w, r.h, r.x, r.y, r.w, r.h);
    ctx2d(this.strokeCanvas).clearRect(0, 0, this.doc.w, this.doc.h);
    this.doc.markDirty(a.layerId, a.frameId);
    this.history.push(patch.entry('Shape', a.cell, () => this.edited(a.frameId)));
    this.edited(a.frameId);
  }

  private fillAt(d: Pt) {
    const target = this.editableCell();
    if (!target) return;
    const s = this.ui;
    const { w, h } = this.doc;
    let src: ImageData;
    if (s.fillAllLayers) {
      const t = ctx2d(this.tmpCanvas, { willReadFrequently: true });
      t.globalCompositeOperation = 'source-over';
      t.clearRect(0, 0, w, h);
      for (const l of this.doc.layers) {
        if (!l.visible) continue;
        const c = this.doc.hasCell(l.id, target.frameId) ? this.doc.peek(l.id, target.frameId) : null;
        if (c) t.drawImage(c, 0, 0);
      }
      src = t.getImageData(0, 0, w, h);
    } else src = ctx2d(target.cell).getImageData(0, 0, w, h);
    const res = floodFill(src, d.x, d.y, s.color, s.fillTolerance, s.fillGap);
    if (!res) return;
    if (res.rect.w * res.rect.h >= w * h * 0.98 && s.fillGap > 0) this.toast('The fill covered the whole frame. Close the shape or raise "Close gaps".');
    const patch = new PixelPatch(this.doc, target.layerId, target.frameId, target.cell, res.rect);
    const x = ctx2d(target.cell);
    x.globalCompositeOperation = 'destination-over'; // tuck the fill under existing lines
    x.drawImage(res.canvas, res.rect.x, res.rect.y);
    x.globalCompositeOperation = 'source-over';
    this.doc.markDirty(target.layerId, target.frameId);
    this.history.push(patch.entry('Fill', target.cell, () => this.edited(target.frameId)));
    this.edited(target.frameId);
    this.requestRender();
  }

  private pickColor(p: Pt) {
    const d = this.toDoc(p.x, p.y);
    if (d.x < 0 || d.y < 0 || d.x >= this.doc.w || d.y >= this.doc.h) return;
    const c = makeCanvas(1, 1);
    const x = ctx2d(c, { willReadFrequently: true });
    x.translate(-Math.floor(d.x), -Math.floor(d.y));
    x.fillStyle = this.doc.meta.paper;
    x.fillRect(0, 0, this.doc.w, this.doc.h);
    const v = this.doc.meta.hasVideo && this.ui.videoVisible ? this.doc.videoFrame(this.frame.id) : null;
    if (v) { x.globalAlpha = this.ui.videoOpacity; x.drawImage(v as CanvasImageSource, 0, 0, this.doc.w, this.doc.h); x.globalAlpha = 1; }
    for (const l of this.doc.layers) {
      if (!l.visible) continue;
      const cell = this.doc.hasCell(l.id, this.drawFrame.id) ? this.doc.peek(l.id, this.drawFrame.id) : null;
      if (cell) { x.globalAlpha = l.opacity; x.drawImage(cell, 0, 0); }
    }
    const px = x.getImageData(0, 0, 1, 1).data;
    const hex = '#' + [px[0], px[1], px[2]].map((n) => n.toString(16).padStart(2, '0')).join('');
    this.store.set((s) => ({ color: hex, recent: [hex, ...s.recent.filter((r) => r !== hex)].slice(0, 12) }));
  }

  // ------------------------------------------------------------------ selection
  private hitFloating(p: Pt): 'move' | 'scale' | 'rotate' | null {
    if (!this.floating) return null;
    const R = 22;
    const r = this.rotHandle();
    if (Math.hypot(p.x - r.x, p.y - r.y) < R) return 'rotate';
    const k = this.floatCorners();
    for (const c of k) if (Math.hypot(p.x - c.x, p.y - c.y) < R) return 'scale';
    // inside polygon
    let inside = false;
    for (let i = 0, j = 3; i < 4; j = i++) {
      if ((k[i].y > p.y) !== (k[j].y > p.y) && p.x < ((k[j].x - k[i].x) * (p.y - k[i].y)) / (k[j].y - k[i].y) + k[i].x) inside = !inside;
    }
    return inside ? 'move' : null;
  }

  private finishLasso(pts: Pt[]) {
    if (pts.length < 3) { this.requestRender(); return; }
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const p of pts) { minX = Math.min(minX, p.x); minY = Math.min(minY, p.y); maxX = Math.max(maxX, p.x); maxY = Math.max(maxY, p.y); }
    const r = clampRect({ x: minX, y: minY, w: maxX - minX, h: maxY - minY }, this.doc.w, this.doc.h);
    if (!r || r.w < 2 || r.h < 2) return;
    const target = this.editableCell();
    if (!target) return;
    const path = new Path2D();
    pts.forEach((p, i) => (i ? path.lineTo(p.x, p.y) : path.moveTo(p.x, p.y)));
    path.closePath();
    const c = makeCanvas(r.w, r.h);
    const x = ctx2d(c);
    x.translate(-r.x, -r.y);
    x.clip(path);
    x.drawImage(target.cell, 0, 0);
    if (isCanvasEmpty(c)) { this.toast('Nothing to select there on this layer.'); return; }
    const patch = new PixelPatch(this.doc, target.layerId, target.frameId, target.cell);
    const cx = ctx2d(target.cell);
    cx.save();
    cx.clip(path);
    cx.clearRect(r.x, r.y, r.w, r.h);
    cx.restore();
    this.floating = { canvas: c, cx: r.x + r.w / 2, cy: r.y + r.h / 2, sx: 1, sy: 1, rot: 0, ...target, cellCanvas: target.cell, patch, label: 'Move selection' };
    this.store.set({ hasSelection: true });
    this.onionKey = '';
    this.requestRender();
  }

  selectAll() {
    this.setTool('lasso');
    this.commitFloating();
    const target = this.editableCell();
    if (!target) return;
    const b = contentBounds(target.cell);
    if (!b) { this.toast('This layer is empty on this frame.'); return; }
    const c = makeCanvas(b.w, b.h);
    ctx2d(c).drawImage(target.cell, -b.x, -b.y);
    const patch = new PixelPatch(this.doc, target.layerId, target.frameId, target.cell);
    ctx2d(target.cell).clearRect(b.x, b.y, b.w, b.h);
    this.floating = { canvas: c, cx: b.x + b.w / 2, cy: b.y + b.h / 2, sx: 1, sy: 1, rot: 0, ...target, cellCanvas: target.cell, patch, label: 'Transform' };
    this.store.set({ hasSelection: true });
    this.requestRender();
  }

  commitFloating() {
    const fl = this.floating;
    if (!fl) return;
    this.floating = null;
    const x = ctx2d(fl.cellCanvas);
    x.save();
    x.translate(fl.cx, fl.cy);
    x.rotate(fl.rot);
    x.scale(fl.sx, fl.sy);
    x.drawImage(fl.canvas, -fl.canvas.width / 2, -fl.canvas.height / 2);
    x.restore();
    this.doc.markDirty(fl.layerId, fl.frameId);
    this.history.push(fl.patch.entry(fl.label, fl.cellCanvas, () => this.edited(fl.frameId)));
    this.edited(fl.frameId);
    this.store.set({ hasSelection: false });
  }

  copySelection() {
    const fl = this.floating;
    if (!fl) return;
    const c = makeCanvas(fl.canvas.width, fl.canvas.height);
    ctx2d(c).drawImage(fl.canvas, 0, 0);
    this.clipboard = { canvas: c, cx: fl.cx, cy: fl.cy, sx: fl.sx, sy: fl.sy, rot: fl.rot };
    this.store.set({ hasClipboard: true });
    this.toast('Copied');
  }
  cutSelection() {
    if (!this.floating) return;
    this.copySelection();
    this.deleteSelection();
  }
  deleteSelection() {
    const fl = this.floating;
    if (!fl) return;
    fl.canvas = makeCanvas(1, 1);
    fl.label = 'Delete selection';
    this.commitFloating();
  }
  flipSelection(axis: 'h' | 'v') {
    const fl = this.floating;
    if (!fl) return;
    if (axis === 'h') fl.sx = -fl.sx; else fl.sy = -fl.sy;
    this.requestRender();
  }
  paste() {
    const cb = this.clipboard;
    if (!cb) { this.toast('Copy a selection first.'); return; }
    this.commitFloating();
    const target = this.editableCell();
    if (!target) return;
    const c = makeCanvas(cb.canvas.width, cb.canvas.height);
    ctx2d(c).drawImage(cb.canvas, 0, 0);
    const patch = new PixelPatch(this.doc, target.layerId, target.frameId, target.cell);
    this.floating = { canvas: c, cx: cb.cx, cy: cb.cy, sx: cb.sx, sy: cb.sy, rot: cb.rot, ...target, cellCanvas: target.cell, patch, label: 'Paste' };
    this.store.set({ tool: 'lasso', hasSelection: true });
    this.requestRender();
  }
  /** Copy the selection, then paste it in the same spot on the next frame. */
  async pasteToNext() {
    if (!this.floating) return;
    this.copySelection();
    this.commitFloating();
    await this.ensureNextFrame();
    this.goto(this.ui.frame + 1);
    await this.loadCurrent();
    this.paste();
  }

  private async loadCurrent() {
    const f = this.drawFrame;
    await this.doc.ensure(this.layer.id, f.id);
  }

  private async ensureNextFrame() {
    if (this.ui.frame < this.doc.frames.length - 1) return;
    if (this.doc.meta.hasVideo) return;
    this.insertFrameAt(this.ui.frame + 1);
  }

  // ------------------------------------------------------------------ frames
  private insertFrameAt(at: number, label = 'Add frame') {
    const f = this.doc.insertFrame(at);
    this.history.push({
      label, bytes: 100,
      undo: () => { const i = this.doc.frameIndex(f.id); if (i >= 0) this.doc.removeFrame(i); this.clampFrame(); this.bump(); },
      redo: () => { this.doc.insertFrame(Math.min(at, this.doc.frames.length), f); this.bump(); },
    });
    this.bump();
    return f;
  }
  private clampFrame() {
    const n = this.doc.frames.length;
    if (this.ui.frame >= n) this.store.set({ frame: n - 1 });
  }

  addFrame() {
    this.commitFloating();
    this.insertFrameAt(this.ui.frame + 1);
    this.goto(this.ui.frame + 1);
  }

  async duplicateFrame() {
    this.commitFloating();
    const src = this.drawFrame;
    const f = this.doc.insertFrame(this.ui.frame + 1);
    await this.doc.copyFrame(src.id, f.id);
    this.doc.updateThumb(f.id);
    const at = this.ui.frame + 1;
    this.history.push({
      label: 'Duplicate frame', bytes: 100,
      undo: () => { const i = this.doc.frameIndex(f.id); if (i >= 0) this.doc.removeFrame(i); this.clampFrame(); this.bump(); },
      redo: () => { this.doc.insertFrame(Math.min(at, this.doc.frames.length), f); this.bump(); },
    });
    this.bump();
    this.goto(at);
  }

  deleteFrame() {
    this.commitFloating();
    if (this.doc.frames.length <= 1) { this.toast('An animation needs at least one frame.'); return; }
    const at = this.ui.frame;
    const f = this.doc.removeFrame(at);
    this.history.push({
      label: 'Delete frame', bytes: 100,
      undo: () => { this.doc.insertFrame(at, f); this.store.set({ frame: at }); this.bump(); },
      redo: () => { const i = this.doc.frameIndex(f.id); if (i >= 0) this.doc.removeFrame(i); this.clampFrame(); this.bump(); },
    });
    this.clampFrame();
    this.bump();
    this.pinFrame();
    this.toast(`Deleted frame ${at + 1}`, { label: 'Undo', run: () => this.undo() });
  }

  toggleHold() {
    const i = this.ui.frame;
    if (i === 0) { this.toast('The first frame cannot hold a previous drawing.'); return; }
    const f = this.doc.frames[i];
    const set = (v: boolean) => { f.hold = v; this.doc.touchMeta(); this.bump(); this.thumbSoon(this.doc.frames[this.doc.drawingIndex(i)].id); this.doc.updateThumb(f.id); this.pinFrame(); };
    const v = !f.hold;
    set(v);
    this.history.push({ label: 'Hold frame', bytes: 10, undo: () => set(!v), redo: () => set(v) });
    if (v && this.doc.layers.some((l) => this.doc.hasCell(l.id, f.id))) this.toast('This frame now repeats the previous drawing. Its own drawing is kept and comes back if you turn hold off.');
  }

  /** Hold the current drawing for n frames total (on twos = 2, threes = 3) across the whole animation. */
  async setExposure(n: number) {
    const frames = this.doc.frames;
    const before = frames.map((f) => f.hold);
    frames.forEach((f, i) => (f.hold = i % n !== 0));
    const after = frames.map((f) => f.hold);
    const apply = (v: boolean[]) => { frames.forEach((f, i) => (f.hold = v[i] ?? false)); this.doc.touchMeta(); this.bump(); this.doc.rebuildAllThumbs(); this.pinFrame(); };
    apply(after);
    this.history.push({ label: 'Exposure', bytes: 10, undo: () => apply(before), redo: () => apply(after) });
    this.toast(n === 1 ? 'Every frame has its own drawing.' : `Drawings now hold for ${n} frames.`);
  }

  /** Snapshot cells of frames as blobs so big multi-frame operations are undoable without huge memory. */
  private async snapshot(frameIds: string[], layerIds: string[]) {
    const snap: { lid: string; fid: string; blob: Blob | null }[] = [];
    for (const fid of frameIds) for (const lid of layerIds) {
      if (!this.doc.hasCell(lid, fid)) { snap.push({ lid, fid, blob: null }); continue; }
      const c = await this.doc.ensure(lid, fid);
      snap.push({ lid, fid, blob: isCanvasEmpty(c) ? null : await toBlob(c) });
    }
    return snap;
  }
  private async restore(snap: { lid: string; fid: string; blob: Blob | null }[]) {
    for (const s of snap) {
      if (!s.blob) { this.doc.clearCell(s.lid, s.fid); continue; }
      const c = await this.doc.ensure(s.lid, s.fid);
      const img = await blobToCanvas(s.blob);
      const x = ctx2d(c);
      x.clearRect(0, 0, c.width, c.height);
      x.drawImage(img, 0, 0);
      this.doc.markDirty(s.lid, s.fid);
    }
    for (const fid of new Set(snap.map((s) => s.fid))) this.thumbSoon(fid);
    this.bump();
  }
  private async snapshotEntry(label: string, frameIds: string[], layerIds: string[], work: () => Promise<void>): Promise<void> {
    const before = await this.snapshot(frameIds, layerIds);
    await work();
    const after = await this.snapshot(frameIds, layerIds);
    const bytes = [...before, ...after].reduce((a, s) => a + (s.blob?.size ?? 0), 0);
    this.history.push({ label, bytes, undo: () => this.restore(before), redo: () => this.restore(after) });
    for (const fid of frameIds) this.thumbSoon(fid);
    this.bump();
  }

  /** Copy this frame's drawing onto the next frame and go there (the classic straight-ahead workflow). */
  async duplicateToNext(allLayers = true) {
    this.commitFloating();
    const src = this.drawFrame;
    const nextIdx = this.ui.frame + 1;
    if (nextIdx >= this.doc.frames.length) {
      if (this.doc.meta.hasVideo) { this.toast('This is the last frame.'); return; }
      await this.duplicateFrame();
      return;
    }
    const dst = this.doc.frames[nextIdx];
    if (dst.hold) { dst.hold = false; this.doc.touchMeta(); }
    const layers = allLayers ? this.doc.layers.map((l) => l.id) : [this.layer.id];
    const hadContent = layers.some((l) => this.doc.hasCell(l, dst.id));
    await this.snapshotEntry('Copy to next frame', [dst.id], layers, () => this.doc.copyFrame(src.id, dst.id, layers));
    this.goto(nextIdx);
    if (hadContent) this.toast(`Replaced the drawing on frame ${nextIdx + 1}.`, { label: 'Undo', run: () => this.undo() });
  }

  async copyToRange(from: number, to: number, allLayers: boolean) {
    this.commitFloating();
    const src = this.drawFrame;
    const a = Math.max(0, Math.min(from, to)), b = Math.min(this.doc.frames.length - 1, Math.max(from, to));
    const ids = this.doc.frames.slice(a, b + 1).map((f) => f.id).filter((id) => id !== src.id);
    const layers = allLayers ? this.doc.layers.map((l) => l.id) : [this.layer.id];
    this.store.set({ busy: { label: 'Copying frames', progress: 0 } });
    try {
      await this.snapshotEntry('Copy to frames', ids, layers, async () => {
        for (let i = 0; i < ids.length; i++) {
          const f = this.doc.frames.find((x) => x.id === ids[i])!;
          f.hold = false;
          await this.doc.copyFrame(src.id, ids[i], layers);
          this.store.set({ busy: { label: 'Copying frames', progress: (i + 1) / ids.length } });
        }
        this.doc.touchMeta();
      });
      this.toast(`Copied to ${ids.length} frame${ids.length === 1 ? '' : 's'}.`);
    } finally {
      this.store.set({ busy: null });
    }
  }

  clearFrameLayer() {
    this.commitFloating();
    const target = this.editableCell();
    if (!target) return;
    const patch = new PixelPatch(this.doc, target.layerId, target.frameId, target.cell);
    ctx2d(target.cell).clearRect(0, 0, this.doc.w, this.doc.h);
    this.doc.markDirty(target.layerId, target.frameId);
    this.history.push(patch.entry('Clear', target.cell, () => this.edited(target.frameId)));
    this.edited(target.frameId);
  }

  // ------------------------------------------------------------------ layers
  selectLayer(id: string) { this.commitFloating(); this.store.set({ layerId: id }); }
  addLayer() {
    this.commitFloating();
    const idx = this.doc.layers.findIndex((l) => l.id === this.ui.layerId) + 1;
    const l = this.doc.addLayer(`Layer ${this.doc.layers.length + 1}`, idx);
    this.history.push({
      label: 'Add layer', bytes: 10,
      undo: () => { const i = this.doc.layers.indexOf(l); if (i >= 0) this.doc.layers.splice(i, 1); this.fixLayer(); this.doc.touchMeta(); this.bump(); },
      redo: () => { this.doc.layers.splice(idx, 0, l); this.doc.touchMeta(); this.bump(); },
    });
    this.store.set({ layerId: l.id });
    this.bump();
  }
  deleteLayer(id: string) {
    this.commitFloating();
    if (this.doc.layers.length <= 1) { this.toast('Keep at least one layer.'); return; }
    const idx = this.doc.layers.findIndex((l) => l.id === id);
    const [l] = this.doc.layers.splice(idx, 1);
    this.doc.touchMeta();
    this.history.push({
      label: 'Delete layer', bytes: 10,
      undo: () => { this.doc.layers.splice(idx, 0, l); this.doc.touchMeta(); this.bump(); this.doc.rebuildAllThumbs(); },
      redo: () => { const i = this.doc.layers.indexOf(l); if (i >= 0) this.doc.layers.splice(i, 1); this.fixLayer(); this.doc.touchMeta(); this.bump(); this.doc.rebuildAllThumbs(); },
    });
    this.fixLayer();
    this.bump();
    this.doc.rebuildAllThumbs();
    this.toast(`Deleted "${l.name}"`, { label: 'Undo', run: () => this.undo() });
  }
  private fixLayer() {
    if (!this.doc.layers.find((l) => l.id === this.ui.layerId)) this.store.set({ layerId: this.doc.layers[this.doc.layers.length - 1].id });
  }
  updateLayer(id: string, p: Partial<{ name: string; visible: boolean; opacity: number; locked: boolean }>) {
    const l = this.doc.layers.find((x) => x.id === id);
    if (!l) return;
    Object.assign(l, p);
    this.doc.touchMeta();
    this.bump();
    if ('visible' in p || 'opacity' in p) { clearTimeout(this.layerThumbT); this.layerThumbT = window.setTimeout(() => this.doc.rebuildAllThumbs(), 400); }
  }
  private layerThumbT = 0;
  moveLayer(id: string, dir: -1 | 1) {
    const i = this.doc.layers.findIndex((l) => l.id === id);
    const j = i + dir;
    if (j < 0 || j >= this.doc.layers.length) return;
    const L = this.doc.layers;
    [L[i], L[j]] = [L[j], L[i]];
    this.doc.touchMeta();
    this.bump();
    this.doc.rebuildAllThumbs();
  }

  // ------------------------------------------------------------------ undo
  async undo() {
    if (this.floating) { this.cancelFloating(); return; }
    this.cancelAction();
    const e = await this.history.undo();
    if (e) { this.afterHistory(e); this.toast(`Undo: ${e.label}`); }
  }
  async redo() {
    this.commitFloating();
    const e = await this.history.redo();
    if (e) { this.afterHistory(e); this.toast(`Redo: ${e.label}`); }
  }
  private afterHistory(e: HistoryEntry) {
    this.clampFrame();
    if (e.frameId) {
      const i = this.doc.frameIndex(e.frameId);
      if (i >= 0 && this.doc.drawingIndex(this.ui.frame) !== i) { this.store.set({ frame: i }); }
    }
    this.pinFrame();
    this.bump();
  }
  /** Put a lifted selection back where it was, without an undo entry. */
  private cancelFloating() {
    const fl = this.floating;
    if (!fl) return;
    this.floating = null;
    const e = fl.patch.entry('', fl.cellCanvas, () => {});
    e.undo();
    this.store.set({ hasSelection: false });
    this.bump();
  }

  // ------------------------------------------------------------------ motion tracking
  private async startTracking(d: Pt) {
    if (!this.doc.meta.hasVideo) { this.toast('Motion tracking needs a video.'); return; }
    if (this.tracking) return;
    if (d.x < 0 || d.y < 0 || d.x > this.doc.w || d.y > this.doc.h) return;
    this.tracking = true;
    const start = this.ui.frame;
    const maxN = this.ui.trackFrames > 0 ? this.ui.trackFrames : this.doc.frames.length - start;
    const n = Math.min(this.doc.frames.length - start, maxN + 1);
    let cancelled = false;
    this.store.set({ busy: { label: 'Tracking motion', progress: 0, cancel: () => (cancelled = true) } });
    try {
      const pts = await trackPoint(
        async (i) => (await this.doc.videoFrameAsync(this.doc.frames[start + i].id)) as CanvasImageSource | null,
        n, this.doc.w, this.doc.h, d.x, d.y,
        (i) => this.store.set({ busy: { label: 'Tracking motion', progress: i / n, cancel: () => (cancelled = true) } }),
        () => cancelled,
      );
      this.trackPreview = pts;
      this.lastTrack = { start, pts };
      this.requestRender();
      this.toast(`Tracked ${pts.length - 1} frames. Tap "Stick drawing" to make this frame's drawing follow it.`);
    } finally {
      this.tracking = false;
      this.store.set({ busy: null });
    }
  }
  lastTrack: { start: number; pts: Pt[] } | null = null;

  async stickToTrack() {
    const tr = this.lastTrack;
    if (!tr) { this.toast('Tap a point on the video with the Track tool first.'); return; }
    this.commitFloating();
    const l = this.layer;
    const srcF = this.doc.frames[tr.start];
    if (!this.doc.hasCell(l.id, srcF.id)) { this.toast(`Draw on frame ${tr.start + 1} ("${l.name}") first, then stick it.`); return; }
    const src = await this.doc.ensure(l.id, srcF.id);
    const copy = makeCanvas(src.width, src.height);
    ctx2d(copy).drawImage(src, 0, 0);
    const ids = tr.pts.slice(1).map((_, i) => this.doc.frames[tr.start + 1 + i]?.id).filter(Boolean) as string[];
    this.store.set({ busy: { label: 'Placing drawing', progress: 0 } });
    try {
      await this.snapshotEntry('Stick to motion', ids, [l.id], async () => {
        for (let i = 0; i < ids.length; i++) {
          const p = tr.pts[i + 1];
          const dx = p.x - tr.pts[0].x, dy = p.y - tr.pts[0].y;
          const f = this.doc.frames.find((x) => x.id === ids[i])!;
          f.hold = false;
          const c = await this.doc.ensure(l.id, ids[i]);
          ctx2d(c).drawImage(copy, dx, dy);
          this.doc.markDirty(l.id, ids[i]);
          this.store.set({ busy: { label: 'Placing drawing', progress: (i + 1) / ids.length } });
        }
        this.doc.touchMeta();
      });
      this.toast(`The drawing now follows the motion for ${ids.length} frames.`);
    } finally {
      this.store.set({ busy: null });
      this.trackPreview = null;
    }
  }
}

function contentBounds(c: HTMLCanvasElement): Rect | null {
  const { width: w, height: h } = c;
  const d = ctx2d(c).getImageData(0, 0, w, h).data;
  let minX = w, minY = h, maxX = -1, maxY = -1;
  for (let y = 0; y < h; y++) {
    const row = y * w * 4;
    for (let x = 0; x < w; x++) {
      if (d[row + x * 4 + 3]) {
        if (x < minX) minX = x; if (x > maxX) maxX = x;
        if (y < minY) minY = y; if (y > maxY) maxY = y;
      }
    }
  }
  if (maxX < 0) return null;
  return { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 };
}

export type { Doc };
