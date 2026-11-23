// The document: frames, layers, drawing cells (one canvas per layer per frame), video frames.
// Cells are paged out to PNG blobs when too many are in memory (iPad Safari has a tight canvas budget).
import type { Frame, Layer, ProjectMeta } from '../types';
import { uid } from '../types';
import { blobToCanvas, ctx2d, loadBitmap, makeCanvas, release, toBlob } from './canvas';
import * as db from '../db';

interface Cell {
  canvas: HTMLCanvasElement | null;
  blob: Blob | null; // last saved / paged-out version
  dirty: boolean; // canvas differs from blob
  loading: Promise<HTMLCanvasElement> | null;
  lastUse: number;
}

const CANVAS_BUDGET = 220 * 1024 * 1024; // bytes of cell canvases kept live

export class Doc {
  meta: ProjectMeta;
  private cells = new Map<string, Cell>();
  private videoBlobs = new Map<string, Blob>();
  private videoCache = new Map<string, ImageBitmap | HTMLImageElement>();
  private videoLoading = new Map<string, Promise<void>>();
  thumbs = new Map<string, HTMLCanvasElement>();
  sourceVideo: Blob | null = null;
  private deletedKeys = new Set<string>();
  private metaDirty = false;
  private listeners = new Set<() => void>();
  private saveTimer: number | undefined;
  private useClock = 0;
  pinned = new Set<string>(); // cell keys that must stay live
  saving = false;
  lastSaved = 0;
  storageOk = true;
  thumbW: number;
  thumbH: number;

  constructor(meta: ProjectMeta) {
    this.meta = meta;
    const s = 96 / Math.max(meta.width, meta.height);
    this.thumbW = Math.max(8, Math.round(meta.width * s));
    this.thumbH = Math.max(8, Math.round(meta.height * s));
  }

  get w() { return this.meta.width; }
  get h() { return this.meta.height; }
  get frames() { return this.meta.frames; }
  get layers() { return this.meta.layers; }

  static blank(opts: { name: string; width: number; height: number; fps: number; frames: number; paper: string }): Doc {
    const meta: ProjectMeta = {
      id: uid(),
      name: opts.name,
      width: opts.width,
      height: opts.height,
      fps: opts.fps,
      paper: opts.paper,
      frames: Array.from({ length: opts.frames }, () => ({ id: uid(), hold: false })),
      layers: [
        { id: uid(), name: 'Color', visible: true, opacity: 1, locked: false },
        { id: uid(), name: 'Line art', visible: true, opacity: 1, locked: false },
      ],
      hasVideo: false,
      created: Date.now(),
      updated: Date.now(),
    };
    const d = new Doc(meta);
    d.metaDirty = true;
    return d;
  }

  static async load(id: string): Promise<Doc | null> {
    const meta = await db.getProject(id);
    if (!meta) return null;
    const d = new Doc(meta);
    // load cell blobs lazily; we only need to know which exist -> read on demand
    const tasks: Promise<void>[] = [];
    for (const f of meta.frames) {
      for (const l of meta.layers) {
        tasks.push(
          db.getBlob(d.blobKey('c', l.id, f.id)).then((b) => {
            if (b) d.cells.set(d.key(l.id, f.id), { canvas: null, blob: b, dirty: false, loading: null, lastUse: 0 });
          }),
        );
      }
      if (f.hasVideo)
        tasks.push(db.getBlob(d.blobKey('v', f.id)).then((b) => { if (b) d.videoBlobs.set(f.id, b); }));
    }
    await Promise.all(tasks);
    if (meta.hasVideo) d.sourceVideo = await db.getBlob(d.blobKey('src'));
    // thumbnails in the background
    d.rebuildAllThumbs();
    return d;
  }

  key(layerId: string, frameId: string) { return layerId + ':' + frameId; }
  blobKey(...parts: string[]) { return this.meta.id + '/' + parts.join('/'); }

  subscribe(fn: () => void) { this.listeners.add(fn); return () => { this.listeners.delete(fn); }; }
  emit() { this.listeners.forEach((f) => f()); }

  // ---------- frames ----------
  frameIndex(id: string) { return this.frames.findIndex((f) => f.id === id); }
  /** index of the frame whose drawing is shown at index i (resolves holds) */
  drawingIndex(i: number) {
    while (i > 0 && this.frames[i]?.hold) i--;
    return i;
  }

  // ---------- cells ----------
  hasCell(layerId: string, frameId: string) { return this.cells.has(this.key(layerId, frameId)); }

  /** Returns the live canvas or null (and starts loading a paged-out one). */
  peek(layerId: string, frameId: string): HTMLCanvasElement | null {
    const k = this.key(layerId, frameId);
    const c = this.cells.get(k);
    if (!c) return null;
    c.lastUse = ++this.useClock;
    if (c.canvas) return c.canvas;
    if (!c.loading && c.blob) this.loadCell(k, c);
    return null;
  }

  private loadCell(k: string, c: Cell) {
    c.loading = blobToCanvas(c.blob!, this.w, this.h).then((cv) => {
      c.canvas = cv;
      c.loading = null;
      this.evict();
      this.emit();
      return cv;
    });
    return c.loading;
  }

  /** Get (creating if needed) the canvas for editing. */
  async ensure(layerId: string, frameId: string): Promise<HTMLCanvasElement> {
    const k = this.key(layerId, frameId);
    let c = this.cells.get(k);
    if (!c) {
      c = { canvas: makeCanvas(this.w, this.h), blob: null, dirty: true, loading: null, lastUse: ++this.useClock };
      this.cells.set(k, c);
      this.deletedKeys.delete(k);
      this.evict();
      return c.canvas!;
    }
    c.lastUse = ++this.useClock;
    if (c.canvas) return c.canvas;
    return c.loading ?? this.loadCell(k, c);
  }

  /** Synchronous variant: only works when the cell is live or absent. */
  ensureSync(layerId: string, frameId: string): HTMLCanvasElement | null {
    const k = this.key(layerId, frameId);
    const c = this.cells.get(k);
    if (!c) {
      const cv = makeCanvas(this.w, this.h);
      this.cells.set(k, { canvas: cv, blob: null, dirty: true, loading: null, lastUse: ++this.useClock });
      this.deletedKeys.delete(k);
      return cv;
    }
    c.lastUse = ++this.useClock;
    return c.canvas;
  }

  markDirty(layerId: string, frameId: string) {
    const c = this.cells.get(this.key(layerId, frameId));
    if (c) c.dirty = true;
    this.scheduleSave();
  }

  clearCell(layerId: string, frameId: string) {
    const k = this.key(layerId, frameId);
    const c = this.cells.get(k);
    if (c?.canvas) release(c.canvas);
    this.cells.delete(k);
    this.deletedKeys.add(k);
    this.scheduleSave();
  }

  /** Copy all cells of one frame to another frame (optionally a single layer). */
  async copyFrame(fromId: string, toId: string, layerIds?: string[]) {
    for (const l of this.layers) {
      if (layerIds && !layerIds.includes(l.id)) continue;
      if (!this.hasCell(l.id, fromId)) { this.clearCell(l.id, toId); continue; }
      const src = await this.ensure(l.id, fromId);
      const dst = await this.ensure(l.id, toId);
      const x = ctx2d(dst);
      x.clearRect(0, 0, dst.width, dst.height);
      x.drawImage(src, 0, 0);
      this.markDirty(l.id, toId);
    }
  }

  private evict() {
    const per = this.w * this.h * 4;
    const maxLive = Math.max(12, Math.floor(CANVAS_BUDGET / per));
    const live = [...this.cells.entries()].filter(([, c]) => c.canvas);
    if (live.length <= maxLive) return;
    live.sort((a, b) => a[1].lastUse - b[1].lastUse);
    let n = live.length - maxLive;
    for (const [k, c] of live) {
      if (n <= 0) break;
      if (this.pinned.has(k)) continue;
      n--;
      const cv = c.canvas!;
      if (c.dirty || !c.blob) {
        if (c.loading) continue;
        const stamp = c.lastUse;
        c.dirty = false;
        c.loading = toBlob(cv).then((b) => {
          c.loading = null;
          if (c.lastUse !== stamp || c.dirty) { c.dirty = true; return cv; } // used meanwhile: keep it live
          c.blob = b;
          this.pendingBlobSave.add(k);
          c.canvas = null;
          release(cv);
          return cv;
        });
      } else {
        c.canvas = null;
        release(cv);
      }
    }
  }
  private pendingBlobSave = new Set<string>();

  // ---------- video ----------
  setVideoFrame(frameId: string, b: Blob) { this.videoBlobs.set(frameId, b); }
  hasVideoFrame(frameId: string) { return this.videoBlobs.has(frameId); }
  videoFrame(frameId: string): ImageBitmap | HTMLImageElement | null {
    const v = this.videoCache.get(frameId);
    if (v) {
      this.videoCache.delete(frameId);
      this.videoCache.set(frameId, v); // LRU bump
      return v;
    }
    this.loadVideoFrame(frameId);
    return null;
  }
  loadVideoFrame(frameId: string): Promise<void> {
    if (this.videoCache.has(frameId)) return Promise.resolve();
    const b = this.videoBlobs.get(frameId);
    if (!b) return Promise.resolve();
    let p = this.videoLoading.get(frameId);
    if (p) return p;
    p = loadBitmap(b).then((bmp) => {
      this.videoCache.set(frameId, bmp);
      this.videoLoading.delete(frameId);
      while (this.videoCache.size > 40) {
        const [k, old] = this.videoCache.entries().next().value!;
        this.videoCache.delete(k);
        if ('close' in old) (old as ImageBitmap).close();
      }
      this.emit();
    });
    this.videoLoading.set(frameId, p);
    return p;
  }
  async videoFrameAsync(frameId: string) {
    await this.loadVideoFrame(frameId);
    return this.videoCache.get(frameId) ?? null;
  }

  // ---------- thumbnails ----------
  async updateThumb(frameId: string) {
    let t = this.thumbs.get(frameId);
    if (!t) { t = makeCanvas(this.thumbW, this.thumbH); this.thumbs.set(frameId, t); }
    const x = ctx2d(t);
    x.clearRect(0, 0, t.width, t.height);
    const v = this.videoBlobs.has(frameId) ? await this.videoFrameAsync(frameId) : null;
    if (v) { x.globalAlpha = 0.45; x.drawImage(v as CanvasImageSource, 0, 0, t.width, t.height); x.globalAlpha = 1; }
    const fi = this.frameIndex(frameId);
    const drawId = fi >= 0 ? this.frames[this.drawingIndex(fi)].id : frameId;
    for (const l of this.layers) {
      if (!l.visible) continue;
      const k = this.key(l.id, drawId);
      const c = this.cells.get(k);
      if (!c) continue;
      x.globalAlpha = l.opacity;
      if (c.canvas) x.drawImage(c.canvas, 0, 0, t.width, t.height);
      else if (c.blob) {
        const bmp = await loadBitmap(c.blob);
        x.drawImage(bmp as CanvasImageSource, 0, 0, t.width, t.height);
        if ('close' in bmp) (bmp as ImageBitmap).close();
      }
      x.globalAlpha = 1;
    }
    this.thumbVersion++;
    this.emit();
  }
  thumbVersion = 0;
  async rebuildAllThumbs() {
    for (const f of this.frames) await this.updateThumb(f.id);
  }

  // ---------- frames structure ----------
  insertFrame(at: number, frame?: Frame): Frame {
    const f = frame ?? { id: uid(), hold: false };
    this.frames.splice(at, 0, f);
    this.touchMeta();
    return f;
  }
  removeFrame(at: number): Frame {
    const [f] = this.frames.splice(at, 1);
    this.touchMeta();
    return f;
  }
  /** Fully delete storage for frame (used when history drops it) */
  purgeFrame(f: Frame) {
    for (const l of this.layers) this.clearCell(l.id, f.id);
    this.thumbs.delete(f.id);
  }

  addLayer(name: string, at?: number): Layer {
    const l: Layer = { id: uid(), name, visible: true, opacity: 1, locked: false };
    this.layers.splice(at ?? this.layers.length, 0, l);
    this.touchMeta();
    return l;
  }

  touchMeta() { this.metaDirty = true; this.scheduleSave(); this.emit(); }

  // ---------- saving ----------
  scheduleSave() {
    clearTimeout(this.saveTimer);
    this.saveTimer = window.setTimeout(() => this.save(), 1500);
  }

  async save() {
    if (this.saving) { this.scheduleSave(); return; }
    this.saving = true;
    try {
      const entries: [string, Blob | null][] = [];
      for (const [k, c] of this.cells) {
        const [lid, fid] = k.split(':');
        if (c.dirty && c.canvas) {
          c.blob = await toBlob(c.canvas);
          c.dirty = false;
          entries.push([this.blobKey('c', lid, fid), c.blob]);
        } else if (this.pendingBlobSave.has(k) && c.blob) {
          entries.push([this.blobKey('c', lid, fid), c.blob]);
        }
      }
      this.pendingBlobSave.clear();
      for (const k of this.deletedKeys) {
        if (this.cells.has(k)) continue;
        const [lid, fid] = k.split(':');
        entries.push([this.blobKey('c', lid, fid), null]);
      }
      this.deletedKeys.clear();
      await db.putBlobs(entries);
      this.meta.updated = Date.now();
      const first = this.frames[0];
      const t = first && this.thumbs.get(first.id);
      if (t) {
        try { this.meta.thumb = t.toDataURL('image/png'); } catch {}
      }
      await db.putProject(this.meta);
      this.metaDirty = false;
      this.lastSaved = Date.now();
    } catch (e) {
      console.warn('save failed', e);
    } finally {
      this.saving = false;
      this.emit();
    }
  }

  async saveVideoAssets() {
    const entries: [string, Blob | null][] = [];
    for (const [fid, b] of this.videoBlobs) entries.push([this.blobKey('v', fid), b]);
    if (this.sourceVideo) entries.push([this.blobKey('src'), this.sourceVideo]);
    // store in chunks so one huge transaction does not fail on iPad
    for (let i = 0; i < entries.length; i += 20) await db.putBlobs(entries.slice(i, i + 20));
  }

  /** Make a flat image of one frame. */
  async composite(frameIndex: number, opts: { video: boolean; videoOpacity?: number; paper: boolean; scale?: number }): Promise<HTMLCanvasElement> {
    const s = opts.scale ?? 1;
    const out = makeCanvas(this.w * s, this.h * s);
    const x = ctx2d(out);
    if (opts.paper) { x.fillStyle = this.meta.paper; x.fillRect(0, 0, out.width, out.height); }
    const f = this.frames[frameIndex];
    if (opts.video && f && this.videoBlobs.has(f.id)) {
      const v = await this.videoFrameAsync(f.id);
      if (v) { x.globalAlpha = opts.videoOpacity ?? 1; x.drawImage(v as CanvasImageSource, 0, 0, out.width, out.height); x.globalAlpha = 1; }
    }
    const df = this.frames[this.drawingIndex(frameIndex)];
    for (const l of this.layers) {
      if (!l.visible || !this.hasCell(l.id, df.id)) continue;
      const c = await this.ensure(l.id, df.id);
      x.globalAlpha = l.opacity;
      x.drawImage(c, 0, 0, out.width, out.height);
    }
    x.globalAlpha = 1;
    return out;
  }
}
