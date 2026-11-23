// Global undo/redo. Pixel edits store only the changed rectangle.
import type { Doc } from './doc';
import type { Rect } from './canvas';
import { ctx2d } from './canvas';

export interface HistoryEntry {
  label: string;
  frameId?: string;
  bytes: number;
  undo(): Promise<void> | void;
  redo(): Promise<void> | void;
}

const MAX_BYTES = 256 * 1024 * 1024;
const MAX_ENTRIES = 80;

export class History {
  private undoStack: HistoryEntry[] = [];
  private redoStack: HistoryEntry[] = [];
  onChange: () => void = () => {};

  get canUndo() { return this.undoStack.length > 0; }
  get canRedo() { return this.redoStack.length > 0; }

  push(e: HistoryEntry) {
    this.undoStack.push(e);
    this.redoStack = [];
    let total = this.undoStack.reduce((a, b) => a + b.bytes, 0);
    while (this.undoStack.length > MAX_ENTRIES || (total > MAX_BYTES && this.undoStack.length > 1)) {
      total -= this.undoStack.shift()!.bytes;
    }
    this.onChange();
  }
  async undo() {
    const e = this.undoStack.pop();
    if (!e) return null;
    await e.undo();
    this.redoStack.push(e);
    this.onChange();
    return e;
  }
  async redo() {
    const e = this.redoStack.pop();
    if (!e) return null;
    await e.redo();
    this.undoStack.push(e);
    this.onChange();
    return e;
  }
  clear() { this.undoStack = []; this.redoStack = []; this.onChange(); }
}

/** Captures a cell region before an edit; call commit() after to push the entry. */
export class PixelPatch {
  private before: ImageData | null = null;
  private rect: Rect;
  constructor(private doc: Doc, private layerId: string, private frameId: string, canvas: HTMLCanvasElement, rect?: Rect) {
    this.rect = rect ?? { x: 0, y: 0, w: canvas.width, h: canvas.height };
    this.before = ctx2d(canvas, { willReadFrequently: false }).getImageData(this.rect.x, this.rect.y, this.rect.w, this.rect.h);
  }
  entry(label: string, canvas: HTMLCanvasElement, onApply: () => void): HistoryEntry {
    const r = this.rect;
    const after = ctx2d(canvas).getImageData(r.x, r.y, r.w, r.h);
    const before = this.before!;
    const { doc, layerId, frameId } = this;
    const apply = async (img: ImageData) => {
      const c = await doc.ensure(layerId, frameId);
      ctx2d(c).putImageData(img, r.x, r.y);
      doc.markDirty(layerId, frameId);
      onApply();
    };
    return {
      label,
      frameId,
      bytes: before.data.length * 2,
      undo: () => apply(before),
      redo: () => apply(after),
    };
  }
}

export function compound(label: string, entries: HistoryEntry[], frameId?: string): HistoryEntry {
  return {
    label,
    frameId,
    bytes: entries.reduce((a, b) => a + b.bytes, 0),
    undo: async () => { for (const e of [...entries].reverse()) await e.undo(); },
    redo: async () => { for (const e of entries) await e.redo(); },
  };
}
