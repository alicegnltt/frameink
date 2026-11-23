import { GIFEncoder, quantize, applyPalette } from 'gifenc';
import { zipSync } from 'fflate';
import { Muxer, ArrayBufferTarget } from 'mp4-muxer';
import type { Doc } from './doc';
import { ctx2d, toBlob } from './canvas';

export interface ExportOpts {
  withVideo: boolean;
  videoOpacity: number;
  scale: number;
  transparent?: boolean; // PNG only
  onProgress: (p: number) => void;
}

const yieldUI = () => new Promise((r) => setTimeout(r, 0));

export async function exportGif(doc: Doc, o: ExportOpts): Promise<Blob> {
  const gif = GIFEncoder();
  const n = doc.frames.length;
  const delay = Math.round(1000 / doc.meta.fps);
  for (let i = 0; i < n; i++) {
    const c = await doc.composite(i, { video: o.withVideo, videoOpacity: o.videoOpacity, paper: true, scale: o.scale });
    const { data, width, height } = ctx2d(c).getImageData(0, 0, c.width, c.height);
    const palette = quantize(data, 256, { format: 'rgb565' });
    const index = applyPalette(data, palette, 'rgb565');
    gif.writeFrame(index, width, height, { palette, delay });
    o.onProgress((i + 1) / n);
    await yieldUI();
  }
  gif.finish();
  return new Blob([gif.bytes()], { type: 'image/gif' });
}

export async function exportPngZip(doc: Doc, o: ExportOpts): Promise<Blob> {
  const files: Record<string, Uint8Array> = {};
  const n = doc.frames.length;
  const pad = String(n).length < 4 ? 4 : String(n).length;
  for (let i = 0; i < n; i++) {
    const c = await doc.composite(i, { video: o.withVideo, videoOpacity: o.videoOpacity, paper: !o.transparent, scale: o.scale });
    const b = await toBlob(c);
    files[`${safeName(doc.meta.name)}_${String(i + 1).padStart(pad, '0')}.png`] = new Uint8Array(await b.arrayBuffer());
    o.onProgress((i + 1) / n);
  }
  const zipped = zipSync(files, { level: 0 });
  return new Blob([zipped], { type: 'application/zip' });
}

export function canEncodeMp4() {
  return typeof (window as any).VideoEncoder === 'function';
}

export async function exportMp4(doc: Doc, o: ExportOpts): Promise<{ blob: Blob; ext: string }> {
  let w = Math.round(doc.w * o.scale), h = Math.round(doc.h * o.scale);
  w -= w % 2; h -= h % 2;
  const fps = doc.meta.fps;
  if (canEncodeMp4()) {
    const VE = (window as any).VideoEncoder;
    const codecs = ['avc1.640034', 'avc1.4d0034', 'avc1.640028', 'avc1.42003e', 'avc1.42001f'];
    let config: any = null;
    for (const codec of codecs) {
      const c = { codec, width: w, height: h, bitrate: Math.max(2e6, w * h * fps * 0.15), framerate: fps };
      try {
        const s = await VE.isConfigSupported(c);
        if (s.supported) { config = c; break; }
      } catch {}
    }
    if (config) {
      const muxer = new Muxer({ target: new ArrayBufferTarget(), video: { codec: 'avc', width: w, height: h, frameRate: fps }, fastStart: 'in-memory' });
      let err: any = null;
      const enc = new VE({ output: (chunk: any, meta: any) => muxer.addVideoChunk(chunk, meta), error: (e: any) => { err = e; } });
      enc.configure(config);
      const n = doc.frames.length;
      const frameC = document.createElement('canvas');
      frameC.width = w; frameC.height = h;
      const fx = ctx2d(frameC);
      for (let i = 0; i < n; i++) {
        const c = await doc.composite(i, { video: o.withVideo, videoOpacity: o.videoOpacity, paper: true, scale: o.scale });
        fx.drawImage(c, 0, 0, w, h);
        const vf = new (window as any).VideoFrame(frameC, { timestamp: Math.round((i * 1e6) / fps), duration: Math.round(1e6 / fps) });
        enc.encode(vf, { keyFrame: i % Math.max(1, Math.round(fps * 2)) === 0 });
        vf.close();
        if (err) throw err;
        while (enc.encodeQueueSize > 4) await new Promise((r) => setTimeout(r, 5));
        o.onProgress((i + 1) / n);
      }
      await enc.flush();
      muxer.finalize();
      return { blob: new Blob([(muxer.target as ArrayBufferTarget).buffer], { type: 'video/mp4' }), ext: 'mp4' };
    }
  }
  return recordFallback(doc, o, w, h);
}

// Fallback: real-time MediaRecorder capture (WebM on Chrome/Firefox, MP4 on Safari).
async function recordFallback(doc: Doc, o: ExportOpts, w: number, h: number): Promise<{ blob: Blob; ext: string }> {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const x = ctx2d(c);
  const stream = (c as any).captureStream(doc.meta.fps) as MediaStream;
  const types = ['video/mp4', 'video/webm;codecs=vp9', 'video/webm'];
  const type = types.find((t) => (window as any).MediaRecorder?.isTypeSupported?.(t));
  if (!type) throw new Error('This browser cannot record video. Export a GIF or PNG sequence instead.');
  const rec = new MediaRecorder(stream, { mimeType: type });
  const chunks: Blob[] = [];
  rec.ondataavailable = (e) => chunks.push(e.data);
  const done = new Promise<void>((r) => (rec.onstop = () => r()));
  const frames: HTMLCanvasElement[] = [];
  for (let i = 0; i < doc.frames.length; i++) {
    frames.push(await doc.composite(i, { video: o.withVideo, videoOpacity: o.videoOpacity, paper: true, scale: o.scale }));
    o.onProgress(((i + 1) / doc.frames.length) * 0.5);
  }
  rec.start();
  for (let i = 0; i < frames.length; i++) {
    x.drawImage(frames[i], 0, 0, w, h);
    await new Promise((r) => setTimeout(r, 1000 / doc.meta.fps));
    o.onProgress(0.5 + ((i + 1) / frames.length) * 0.5);
  }
  rec.stop();
  await done;
  return { blob: new Blob(chunks, { type }), ext: type.includes('mp4') ? 'mp4' : 'webm' };
}

export function safeName(s: string) {
  return (s || 'animation').replace(/[^\w\- ]+/g, '').trim().replace(/\s+/g, '_') || 'animation';
}

export async function saveFile(blob: Blob, name: string) {
  // Inside a claude.ai artifact, files go through the viewer's download prompt.
  const claude = (window as any).claude;
  if (claude?.use) {
    const dl = await claude.use('downloads').catch(() => null);
    if (dl) {
      try {
        await dl.save({ filename: name, data: blob });
      } catch (e: any) {
        if (e?.code === 'declined') return;
        throw new Error(e?.message || 'The download was blocked here.');
      }
      return;
    }
  }
  // On iPad/iPhone prefer the share sheet so the file can go to Photos or Files.
  const file = new File([blob], name, { type: blob.type });
  const nav = navigator as any;
  if (nav.canShare && 'ontouchend' in document && /iPad|iPhone|iPod|Macintosh/.test(navigator.userAgent)) {
    try {
      if (nav.canShare({ files: [file] })) { await nav.share({ files: [file] }); return; }
    } catch (e: any) {
      if (e?.name === 'AbortError') return;
    }
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}
