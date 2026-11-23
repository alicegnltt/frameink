// Video import: pull frames out of a video file by seeking a <video> element.
export type SplitMode = 'every' | 'fps' | 'twos' | 'threes' | 'count';

export interface VideoInfo { duration: number; width: number; height: number; }

export async function probeVideo(url: string): Promise<{ video: HTMLVideoElement; info: VideoInfo }> {
  const v = document.createElement('video');
  v.muted = true;
  v.playsInline = true;
  v.preload = 'auto';
  v.crossOrigin = 'anonymous';
  v.src = url;
  await new Promise<void>((res, rej) => {
    v.onloadedmetadata = () => res();
    v.onerror = () => rej(new Error('This video format cannot be opened in this browser. Try an MP4 (H.264) file.'));
  });
  // iOS needs data before the first seek works reliably
  if (v.readyState < 2) {
    await new Promise<void>((res) => {
      const t = setTimeout(res, 3000);
      v.onloadeddata = () => { clearTimeout(t); res(); };
      v.load();
    });
  }
  return { video: v, info: { duration: v.duration, width: v.videoWidth, height: v.videoHeight } };
}

export function frameTimes(mode: SplitMode, start: number, end: number, sourceFps: number, fps: number, count: number): number[] {
  const len = Math.max(0, end - start);
  let step: number;
  switch (mode) {
    case 'every': step = 1 / sourceFps; break;
    case 'twos': step = 2 / sourceFps; break;
    case 'threes': step = 3 / sourceFps; break;
    case 'fps': step = 1 / fps; break;
    case 'count': {
      const n = Math.max(1, Math.round(count));
      return Array.from({ length: n }, (_, i) => start + (n === 1 ? 0 : (len * i) / n) + 0.0001);
    }
  }
  const n = Math.min(5000, Math.max(1, Math.floor(len / step + 1e-6)));
  return Array.from({ length: n }, (_, i) => start + i * step + Math.min(step / 2, 0.01));
}

export function playbackFps(mode: SplitMode, sourceFps: number, fps: number, count: number, len: number) {
  switch (mode) {
    case 'every': return sourceFps;
    case 'twos': return sourceFps / 2;
    case 'threes': return sourceFps / 3;
    case 'fps': return fps;
    case 'count': return Math.max(1, Math.round((count / Math.max(len, 0.01)) * 100) / 100);
  }
}

function seek(v: HTMLVideoElement, t: number): Promise<void> {
  return new Promise((res) => {
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      v.removeEventListener('seeked', onSeeked);
      res();
    };
    const onSeeked = () => {
      const anyV = v as any;
      if (anyV.requestVideoFrameCallback) {
        anyV.requestVideoFrameCallback(() => finish());
        setTimeout(finish, 250);
      } else setTimeout(finish, 30);
    };
    v.addEventListener('seeked', onSeeked);
    setTimeout(finish, 4000);
    v.currentTime = Math.min(t, Math.max(0, v.duration - 0.001));
  });
}

export async function extractFrames(
  v: HTMLVideoElement,
  times: number[],
  outW: number,
  outH: number,
  onFrame: (i: number, jpeg: Blob, t: number) => void,
  onProgress: (done: number) => void,
  cancelled: () => boolean,
) {
  const c = document.createElement('canvas');
  c.width = outW; c.height = outH;
  const x = c.getContext('2d')!;
  for (let i = 0; i < times.length; i++) {
    if (cancelled()) return false;
    await seek(v, times[i]);
    x.drawImage(v, 0, 0, outW, outH);
    const b = await new Promise<Blob>((res) => c.toBlob((b) => res(b!), 'image/jpeg', 0.85));
    onFrame(i, b, times[i]);
    onProgress(i + 1);
  }
  return true;
}
