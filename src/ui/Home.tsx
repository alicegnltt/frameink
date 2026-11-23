import { useEffect, useRef, useState } from 'react';
import * as db from '../db';
import type { ProjectMeta } from '../types';
import { Doc } from '../engine/doc';
import { ImportDialog } from './ImportDialog';
import { makeSampleDoc } from './sample';

const PRESETS = [
  { label: '1280x720', w: 1280, h: 720 },
  { label: '1920x1080', w: 1920, h: 1080 },
  { label: '1080x1080', w: 1080, h: 1080 },
  { label: '1080x1920', w: 1080, h: 1920 },
  { label: '800x600', w: 800, h: 600 },
];

// A six-frame bouncing ball, drawn in ASCII. The highlighted frame steps like playback.
const BALL_ROW = [0, 1, 2, 3, 2, 1];
const CELL = 5;
function cell(f: number, r: number) {
  const b = BALL_ROW[f];
  if (r < 3) return b === r ? '  o  ' : '     ';
  return b === 3 ? '_(_)_' : '_____';
}

function Strip() {
  const [cur, setCur] = useState(0);
  useEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const t = setInterval(() => setCur((c) => (c + 1) % BALL_ROW.length), 1000 / 6);
    return () => clearInterval(t);
  }, []);
  const n = BALL_ROW.length;
  const border = '+' + Array(n).fill('-'.repeat(CELL)).join('+') + '+';
  const row = (r: number) => (
    <>
      |{Array.from({ length: n }, (_, f) => (
        <span key={f}>
          <span className={f === cur ? 'inv' : undefined}>{cell(f, r)}</span>|
        </span>
      ))}
      {'\n'}
    </>
  );
  return (
    <pre className="ascii" aria-hidden>
      {border + '\n'}
      {row(0)}
      {row(1)}
      {row(2)}
      {row(3)}
      {border + '\n'}
      {Array.from({ length: n }, (_, f) => (
        <span key={f} className={f === cur ? 'hi' : undefined}>{('  ' + String(f + 1).padStart(2, '0')).padEnd(CELL + 1)}</span>
      ))}
    </pre>
  );
}

export function Home({ onOpen }: { onOpen: (d: Doc) => void }) {
  const [projects, setProjects] = useState<ProjectMeta[] | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [preset, setPreset] = useState(0);
  const [cw, setCw] = useState(1280);
  const [ch, setCh] = useState(720);
  const [fps, setFps] = useState(12);
  const [frames, setFrames] = useState(24);
  const [name, setName] = useState('');
  const [paper, setPaper] = useState('#ffffff');
  const [showNew, setShowNew] = useState(false);
  const [confirmDel, setConfirmDel] = useState<string | null>(null);
  const [opening, setOpening] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  const refresh = () => db.listProjects().then(setProjects);
  useEffect(() => { refresh(); db.requestPersist(); }, []);

  const custom = preset === PRESETS.length;
  const W = custom ? cw : PRESETS[preset].w;
  const H = custom ? ch : PRESETS[preset].h;

  const createBlank = async () => {
    const d = Doc.blank({ name: name.trim() || 'untitled', width: Math.max(16, Math.min(4096, W)), height: Math.max(16, Math.min(4096, H)), fps, frames: Math.max(1, Math.min(1000, frames)), paper });
    await d.save();
    d.rebuildAllThumbs();
    onOpen(d);
  };

  const open = async (id: string) => {
    setOpening(true);
    const d = await Doc.load(id);
    setOpening(false);
    if (d) onOpen(d);
  };

  const pickVideo = (f: File | undefined | null) => { if (f) setFile(f); };

  return (
    <div
      className={'home' + (dragOver ? ' drag' : '')}
      onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
      onDragLeave={() => setDragOver(false)}
      onDrop={(e) => { e.preventDefault(); setDragOver(false); pickVideo([...e.dataTransfer.files].find((x) => x.type.startsWith('video/'))); }}
    >
      <main className="home-col">
        <Strip />
        <h1>frameink</h1>
        <p className="dim">frame-by-frame animation. draw from scratch or over a video.</p>

        <section className="block">
          <input ref={fileInput} id="video-file" type="file" accept="video/*" hidden onChange={(e) => pickVideo(e.target.files?.[0])} />
          <button className="line-btn" onClick={() => fileInput.current?.click()}>
            <span>&gt; open video</span><span className="dim">split into frames, trace over it</span>
          </button>
          <button className="line-btn" onClick={() => setShowNew((v) => !v)} aria-expanded={showNew}>
            <span>&gt; new blank</span><span className="dim">empty frames, your size and speed</span>
          </button>

          {showNew && (
            <div className="new-form">
              <label htmlFor="new-name"><span>name</span><input id="new-name" placeholder="untitled" value={name} onChange={(e) => setName(e.target.value)} /></label>
              <label htmlFor="new-size">
                <span>size</span>
                <select id="new-size" value={preset} onChange={(e) => setPreset(+e.target.value)}>
                  {PRESETS.map((p, i) => <option key={p.label} value={i}>{p.label}</option>)}
                  <option value={PRESETS.length}>custom</option>
                </select>
              </label>
              {custom && (
                <label htmlFor="new-w">
                  <span>w x h</span>
                  <span className="pair">
                    <input id="new-w" type="number" min={16} max={4096} value={cw} onChange={(e) => setCw(+e.target.value)} aria-label="Width" />
                    <input id="new-h" type="number" min={16} max={4096} value={ch} onChange={(e) => setCh(+e.target.value)} aria-label="Height" />
                  </span>
                </label>
              )}
              <label htmlFor="new-fps">
                <span>fps</span>
                <select id="new-fps" value={fps} onChange={(e) => setFps(+e.target.value)}>
                  {[6, 8, 12, 15, 24, 30].map((f) => <option key={f} value={f}>{f}</option>)}
                </select>
              </label>
              <label htmlFor="new-frames"><span>frames</span><input id="new-frames" type="number" min={1} max={1000} value={frames} onChange={(e) => setFrames(+e.target.value)} /></label>
              <label htmlFor="new-paper">
                <span>paper</span>
                <span className="paper-row">
                  <span className="paper-swatch" style={{ background: paper }}>
                    <input id="new-paper" type="color" value={paper} onChange={(e) => setPaper(e.target.value)} aria-label="Paper color" />
                  </span>
                  <span className="dim">{paper}</span>
                  {['#ffffff', '#f4f1ea', '#000000'].map((c) => (
                    <button key={c} type="button" className={'text-btn' + (paper === c ? ' on' : '')} onClick={() => setPaper(c)}>{c === '#ffffff' ? 'white' : c === '#000000' ? 'black' : 'cream'}</button>
                  ))}
                </span>
              </label>
              <div className="form-foot">
                <span className="dim">{(frames / fps).toFixed(1)}s</span>
                <button className="solid" onClick={createBlank}>create</button>
              </div>
            </div>
          )}
          <p className="dim small">or drop a video file on this page. nothing leaves your device.</p>
        </section>

        <section className="block">
          <div className="label">projects</div>
          {projects === null ? (
            <p className="dim">loading...</p>
          ) : projects.length === 0 ? (
            <p className="dim">
              none yet.{' '}
              <button className="text-btn" onClick={async () => onOpen(await makeSampleDoc())}>open the example</button>
            </p>
          ) : (
            <ul className="plist">
              {projects.map((p) => (
                <li key={p.id}>
                  {confirmDel === p.id ? (
                    <div className="prow">
                      <span>delete "{p.name}"?</span>
                      <span className="acts">
                        <button className="text-btn" onClick={async () => { await db.deleteProject(p.id); setConfirmDel(null); refresh(); }}>yes, delete</button>
                        <button className="text-btn" onClick={() => setConfirmDel(null)}>keep</button>
                      </span>
                    </div>
                  ) : (
                    <div className="prow">
                      <button className="pthumb" onClick={() => open(p.id)} disabled={opening} style={{ background: p.paper, aspectRatio: `${p.width} / ${p.height}` }} aria-label={`Open ${p.name}`} tabIndex={-1}>
                        {p.thumb && <img src={p.thumb} alt="" />}
                      </button>
                      <button className="pname" onClick={() => open(p.id)} disabled={opening}>
                        {p.name}{p.hasVideo ? <span className="dim"> [video]</span> : null}
                      </button>
                      <span className="dim meta">{p.frames.length}f / {p.fps}fps / {new Date(p.updated).toLocaleDateString()}</span>
                      <button className="text-btn x" onClick={() => setConfirmDel(p.id)} aria-label={`Delete ${p.name}`}>x</button>
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
        </section>
      </main>

      {file && <ImportDialog file={file} onClose={() => setFile(null)} onDone={(d) => { setFile(null); onOpen(d); }} />}
    </div>
  );
}
