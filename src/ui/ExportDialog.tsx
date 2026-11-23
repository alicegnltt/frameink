import { useState } from 'react';
import type { Editor } from '../engine/editor';
import { canEncodeMp4, exportGif, exportMp4, exportPngZip, safeName, saveFile } from '../engine/export';
import { X } from 'lucide-react';

type Fmt = 'mp4' | 'gif' | 'png';

export function ExportDialog({ ed, onClose }: { ed: Editor; onClose: () => void }) {
  const doc = ed.doc;
  const [fmt, setFmt] = useState<Fmt>('mp4');
  const [withVideo, setWithVideo] = useState(false);
  const [scale, setScale] = useState(doc.w > 1280 ? 0.5 : 1);
  const [transparent, setTransparent] = useState(true);
  const [progress, setProgress] = useState<number | null>(null);
  const [error, setError] = useState('');
  const [done, setDone] = useState('');

  const run = async () => {
    ed.commitFloating();
    ed.stop();
    setError(''); setDone('');
    setProgress(0);
    try {
      const o = { withVideo: withVideo && doc.meta.hasVideo, videoOpacity: 1, scale, transparent, onProgress: setProgress };
      const base = safeName(doc.meta.name);
      if (fmt === 'gif') { const b = await exportGif(doc, o); await saveFile(b, `${base}.gif`); setDone(`${base}.gif`); }
      else if (fmt === 'png') { const b = await exportPngZip(doc, o); await saveFile(b, `${base}_frames.zip`); setDone(`${base}_frames.zip`); }
      else { const r = await exportMp4(doc, o); await saveFile(r.blob, `${base}.${r.ext}`); setDone(`${base}.${r.ext}`); }
    } catch (e: any) {
      setError(e?.message || 'Export failed.');
    } finally {
      setProgress(null);
    }
  };

  const w = Math.round(doc.w * scale), h = Math.round(doc.h * scale);
  const secs = doc.frames.length / doc.meta.fps;

  return (
    <div className="modal-back" onClick={onClose}>
      <div className="modal" role="dialog" aria-label="Export" onClick={(e) => e.stopPropagation()}>
        <div className="pop-head">
          <h3>Export</h3>
          <button className="icon-btn small" onClick={onClose} aria-label="Close"><X size={16} /></button>
        </div>
        <div className="pop-body">
          <div className="segmented">
            <button className={fmt === 'mp4' ? 'sel' : ''} onClick={() => setFmt('mp4')}>Video (MP4)</button>
            <button className={fmt === 'gif' ? 'sel' : ''} onClick={() => setFmt('gif')}>GIF</button>
            <button className={fmt === 'png' ? 'sel' : ''} onClick={() => setFmt('png')}>PNG frames</button>
          </div>
          {doc.meta.hasVideo && (
            <div className="segmented">
              <button className={!withVideo ? 'sel' : ''} onClick={() => setWithVideo(false)}>Drawing only</button>
              <button className={withVideo ? 'sel' : ''} onClick={() => setWithVideo(true)}>Drawing over video</button>
            </div>
          )}
          <label className="field" htmlFor="export-scale">
            <span>Size</span>
            <select id="export-scale" value={scale} onChange={(e) => setScale(+e.target.value)}>
              <option value={1}>Full ({doc.w}×{doc.h})</option>
              <option value={0.5}>Half ({Math.round(doc.w / 2)}×{Math.round(doc.h / 2)})</option>
              <option value={0.25}>Quarter ({Math.round(doc.w / 4)}×{Math.round(doc.h / 4)})</option>
            </select>
          </label>
          {fmt === 'png' && (
            <label className="toggle" htmlFor="export-transparent">
              <span>Transparent background</span>
              <input id="export-transparent" type="checkbox" checked={transparent} onChange={(e) => setTransparent(e.target.checked)} />
              <i aria-hidden />
            </label>
          )}
          <p className="hint">
            {doc.frames.length} frames at {doc.meta.fps} fps ({secs.toFixed(1)} s), {w}×{h}.
            {fmt === 'mp4' && !canEncodeMp4() && ' This browser records the video in real time, so it takes as long as the animation.'}
            {fmt === 'mp4' && ' Sound from the video is not included yet.'}
            {fmt === 'gif' && ' GIFs are limited to 256 colors per frame.'}
          </p>
          {progress != null ? (
            <div className="bar big"><i style={{ width: `${progress * 100}%` }} /></div>
          ) : (
            <button className="pill primary wide" onClick={run}>Export {fmt === 'png' ? 'ZIP of PNGs' : fmt.toUpperCase()}</button>
          )}
          {done && <p className="ok">Exported {done}. On iPad, pick “Save to Files” or “Save Video/Image” in the share sheet.</p>}
          {error && <p className="err">{error}</p>}
        </div>
      </div>
    </div>
  );
}
