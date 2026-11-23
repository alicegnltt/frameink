import { memo, useEffect, useRef } from 'react';
import type { Editor } from '../engine/editor';
import { useDocVersion, useUI } from './hooks';
import {
  ChevronLeft, ChevronRight, Play, Pause, Plus, CopyPlus, ArrowRightToLine, Trash2, Repeat, Pin, Copy,
} from 'lucide-react';

const Thumb = memo(function Thumb({ ed, frameId, v }: { ed: Editor; frameId: string; v: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = ref.current;
    const t = ed.doc.thumbs.get(frameId);
    if (!c) return;
    c.width = ed.doc.thumbW;
    c.height = ed.doc.thumbH;
    const x = c.getContext('2d')!;
    x.fillStyle = ed.doc.meta.paper;
    x.fillRect(0, 0, c.width, c.height);
    if (t) x.drawImage(t, 0, 0);
  }, [ed, frameId, v]);
  return <canvas ref={ref} className="thumb-canvas" />;
});

export function Timeline({ ed, onRange }: { ed: Editor; onRange: () => void }) {
  const ui = useUI(ed);
  const v = useDocVersion(ed.doc);
  const strip = useRef<HTMLDivElement>(null);
  const frames = ed.doc.frames;
  const n = frames.length;

  useEffect(() => {
    const el = strip.current?.querySelector<HTMLElement>(`[data-i="${ui.frame}"]`);
    el?.scrollIntoView({ block: 'nearest', inline: ui.playing ? 'center' : 'nearest' });
  }, [ui.frame, ui.playing]);

  const held = ui.frame > 0 && frames[ui.frame]?.hold;
  const fps = ed.doc.meta.fps;

  return (
    <div className="timeline">
      <div className="tl-controls">
        <div className="tl-group">
          <button className="icon-btn" onClick={() => ed.prev()} title="Previous frame (,)" aria-label="Previous frame"><ChevronLeft size={20} /></button>
          <button className="icon-btn play" onClick={() => ed.togglePlay()} title="Play (Enter)" aria-label={ui.playing ? 'Pause' : 'Play'}>
            {ui.playing ? <Pause size={20} /> : <Play size={20} />}
          </button>
          <button className="icon-btn" onClick={() => ed.next()} title="Next frame (.)" aria-label="Next frame"><ChevronRight size={20} /></button>
          <span className="frame-count">
            <b>{ui.frame + 1}</b> / {n}
            <span className="muted"> · {fps} fps</span>
          </span>
          <button className={'icon-btn small' + (ui.loop ? ' on' : '')} onClick={() => ed.store.set({ loop: !ui.loop })} title="Loop" aria-pressed={ui.loop} aria-label="Loop"><Repeat size={16} /></button>
          <select className="speed" value={ui.speed} onChange={(e) => ed.store.set({ speed: +e.target.value })} aria-label="Playback speed" id="speed">
            {[0.25, 0.5, 1, 1.5, 2].map((s) => <option key={s} value={s}>{s}×</option>)}
          </select>
        </div>
        <div className="tl-group actions">
          <button className="pill primary" onClick={() => ed.duplicateToNext()} title="Copy this drawing onto the next frame and go there (Ctrl+D)">
            <ArrowRightToLine size={16} /> <span>Copy to next</span>
          </button>
          {!ed.doc.meta.hasVideo && <button className="icon-btn" onClick={() => ed.addFrame()} title="Add blank frame" aria-label="Add blank frame"><Plus size={18} /></button>}
          <button className="icon-btn" onClick={() => ed.duplicateFrame()} title="Insert a copy of this frame" aria-label="Duplicate frame"><CopyPlus size={18} /></button>
          <button className="icon-btn" onClick={onRange} title="Copy drawing to a range of frames" aria-label="Copy to range"><Copy size={18} /></button>
          <button className={'icon-btn' + (held ? ' on' : '')} onClick={() => ed.toggleHold()} title="Hold: repeat the previous drawing on this frame" aria-label="Hold frame" aria-pressed={!!held}><Pin size={18} /></button>
          <button className="icon-btn danger" onClick={() => ed.deleteFrame()} title="Delete frame" aria-label="Delete frame"><Trash2 size={18} /></button>
        </div>
      </div>
      <input
        id="scrub"
        className="scrub"
        type="range"
        min={0}
        max={Math.max(0, n - 1)}
        value={ui.frame}
        onChange={(e) => ed.goto(+e.target.value, true)}
        aria-label="Scrub frames"
      />
      <div className="strip" ref={strip}>
        {frames.map((f, i) => (
          <button
            key={f.id}
            data-i={i}
            className={'frame' + (i === ui.frame ? ' current' : '') + (f.hold && i > 0 ? ' hold' : '')}
            onClick={() => ed.goto(i, true)}
            title={f.hold && i > 0 ? `Frame ${i + 1} (holds the previous drawing)` : `Frame ${i + 1}`}
          >
            <Thumb ed={ed} frameId={f.id} v={v} />
            <span className="frame-no">{i + 1}</span>
            {f.hold && i > 0 && <span className="hold-mark">hold</span>}
          </button>
        ))}
      </div>
    </div>
  );
}
