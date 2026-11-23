import { useEffect, useMemo, useRef, useState } from 'react';
import { X } from 'lucide-react';
import { extractFrames, frameTimes, playbackFps, probeVideo } from '../engine/video';
import type { SplitMode, VideoInfo } from '../engine/video';
import { Doc } from '../engine/doc';
import { uid } from '../types';
import type { ProjectMeta } from '../types';
import { makeCanvas, ctx2d } from '../engine/canvas';

const SIZES = [640, 960, 1280, 1920];

export function ImportDialog({ file, onClose, onDone }: { file: File; onClose: () => void; onDone: (d: Doc) => void }) {
  const [url] = useState(() => URL.createObjectURL(file));
  const [info, setInfo] = useState<VideoInfo | null>(null);
  const [error, setError] = useState('');
  const [mode, setMode] = useState<SplitMode>('fps');
  const [srcFps, setSrcFps] = useState(30);
  const [fps, setFps] = useState(12);
  const [count, setCount] = useState(24);
  const [start, setStart] = useState(0);
  const [end, setEnd] = useState(0);
  const [maxEdge, setMaxEdge] = useState(1280);
  const [progress, setProgress] = useState<number | null>(null);
  const cancelRef = useRef(false);
  const previewRef = useRef<HTMLVideoElement>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);

  useEffect(() => {
    let alive = true;
    probeVideo(url)
      .then(({ video, info }) => {
        if (!alive) return;
        videoRef.current = video;
        setInfo(info);
        setEnd(Math.min(info.duration, 10));
        if (Math.max(info.width, info.height) <= 1280) setMaxEdge(Math.max(info.width, info.height));
      })
      .catch((e) => setError(e.message));
    return () => { alive = false; };
  }, [url]);

  useEffect(() => () => URL.revokeObjectURL(url), [url]);

  const times = useMemo(() => (info ? frameTimes(mode, start, end, srcFps, fps, count) : []), [info, mode, start, end, srcFps, fps, count]);
  const outFps = playbackFps(mode, srcFps, fps, count, end - start);
  const scale = info ? Math.min(1, maxEdge / Math.max(info.width, info.height)) : 1;
  const outW = info ? Math.max(2, Math.round((info.width * scale) / 2) * 2) : 0;
  const outH = info ? Math.max(2, Math.round((info.height * scale) / 2) * 2) : 0;

  const seekPreview = (t: number) => { const p = previewRef.current; if (p) p.currentTime = t; };

  const go = async () => {
    if (!info || !videoRef.current || !times.length) return;
    cancelRef.current = false;
    setProgress(0);
    const frames = times.map((t) => ({ id: uid(), hold: false, t, hasVideo: true }));
    const meta: ProjectMeta = {
      id: uid(),
      name: file.name.replace(/\.[^.]+$/, '') || 'Video animation',
      width: outW,
      height: outH,
      fps: Math.round(outFps * 100) / 100,
      paper: '#ffffff',
      frames,
      layers: [
        { id: uid(), name: 'Color', visible: true, opacity: 1, locked: false },
        { id: uid(), name: 'Line art', visible: true, opacity: 1, locked: false },
      ],
      hasVideo: true,
      videoName: file.name,
      created: Date.now(),
      updated: Date.now(),
    };
    const doc = new Doc(meta);
    const ok = await extractFrames(
      videoRef.current, times, outW, outH,
      (i, jpeg) => doc.setVideoFrame(frames[i].id, jpeg),
      (n) => setProgress(n / times.length),
      () => cancelRef.current,
    );
    if (!ok) { setProgress(null); return; }
    doc.sourceVideo = file;
    setProgress(1);
    await doc.saveVideoAssets();
    await doc.save();
    doc.rebuildAllThumbs();
    onDone(doc);
  };

  const fmt = (t: number) => `${Math.floor(t / 60)}:${(t % 60).toFixed(1).padStart(4, '0')}`;
  const tooMany = times.length > 400;

  return (
    <div className="modal-back">
      <div className="modal wide" role="dialog" aria-label="Import video">
        <div className="pop-head">
          <h3>Split video into frames</h3>
          <button className="icon-btn small" onClick={() => { cancelRef.current = true; onClose(); }} aria-label="Close"><X size={16} /></button>
        </div>
        <div className="pop-body import">
          {error && <p className="err">{error}</p>}
          <div className="import-grid">
            <div className="import-preview">
              <video ref={previewRef} src={url} muted playsInline controls preload="auto" />
              {info && <p className="hint">{info.width}×{info.height} · {fmt(info.duration)} · {file.name}</p>}
            </div>
            {info && (
              <div className="import-form">
                <div className="mini-title">Trim</div>
                <label className="slider" htmlFor="trim-start">
                  <span className="row"><span>Start</span><span className="val">{fmt(start)}</span></span>
                  <input id="trim-start" type="range" min={0} max={info.duration} step={0.01} value={start}
                    onChange={(e) => { const v = Math.min(+e.target.value, end - 0.05); setStart(v); seekPreview(v); }} />
                </label>
                <label className="slider" htmlFor="trim-end">
                  <span className="row"><span>End</span><span className="val">{fmt(end)}</span></span>
                  <input id="trim-end" type="range" min={0} max={info.duration} step={0.01} value={end}
                    onChange={(e) => { const v = Math.max(+e.target.value, start + 0.05); setEnd(v); seekPreview(v); }} />
                </label>
                <div className="mini-title">How to split</div>
                <div className="segmented wrap">
                  {([['every', 'Every frame'], ['fps', 'Fixed FPS'], ['twos', 'On twos'], ['threes', 'On threes'], ['count', 'Frame count']] as const).map(([id, l]) => (
                    <button key={id} className={mode === id ? 'sel' : ''} onClick={() => setMode(id)}>{l}</button>
                  ))}
                </div>
                {mode === 'fps' && (
                  <div className="segmented">
                    {[6, 8, 12, 24].map((f) => <button key={f} className={fps === f ? 'sel' : ''} onClick={() => setFps(f)}>{f} fps</button>)}
                    <input id="fps-custom" className="num" type="number" min={1} max={60} value={fps} onChange={(e) => setFps(Math.max(1, Math.min(60, +e.target.value || 1)))} aria-label="Custom FPS" />
                  </div>
                )}
                {(mode === 'every' || mode === 'twos' || mode === 'threes') && (
                  <label className="field" htmlFor="src-fps">
                    <span>Video frame rate</span>
                    <select id="src-fps" value={srcFps} onChange={(e) => setSrcFps(+e.target.value)}>
                      {[24, 25, 30, 50, 60].map((f) => <option key={f} value={f}>{f} fps</option>)}
                    </select>
                  </label>
                )}
                {mode === 'count' && (
                  <label className="field" htmlFor="frame-count">
                    <span>Number of frames</span>
                    <input id="frame-count" type="number" min={1} max={2000} value={count} onChange={(e) => setCount(Math.max(1, +e.target.value || 1))} />
                  </label>
                )}
                <label className="field" htmlFor="max-edge">
                  <span>Frame size</span>
                  <select id="max-edge" value={maxEdge} onChange={(e) => setMaxEdge(+e.target.value)}>
                    {[...new Set([...SIZES.filter((s) => s < Math.max(info.width, info.height)), Math.max(info.width, info.height)])].map((s) => (
                      <option key={s} value={s}>{s === Math.max(info.width, info.height) ? `Original (${info.width}×${info.height})` : `${Math.round(info.width * s / Math.max(info.width, info.height))}×${Math.round(info.height * s / Math.max(info.width, info.height))}`}</option>
                    ))}
                  </select>
                </label>
                <div className="summary">
                  <b>{times.length}</b> frames, plays back at <b>{Math.round(outFps * 100) / 100} fps</b>, {outW}×{outH}
                </div>
                {tooMany && <p className="warn">That is a lot of frames to draw and can be slow on iPad. Trim the clip or use a lower FPS.</p>}
                {progress == null ? (
                  <button className="pill primary wide" disabled={!times.length} onClick={go}>Split into {times.length} frames</button>
                ) : (
                  <>
                    <div className="bar big"><i style={{ width: `${progress * 100}%` }} /></div>
                    <button className="pill wide" onClick={() => (cancelRef.current = true)}>Cancel</button>
                  </>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// Used by the home screen to make a small demo when there are no projects yet.
export function demoThumb(w: number, h: number) {
  const c = makeCanvas(w, h);
  const x = ctx2d(c);
  x.fillStyle = '#fff';
  x.fillRect(0, 0, w, h);
  return c;
}
