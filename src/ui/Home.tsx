import { useEffect, useRef, useState } from 'react';
import { Film, Plus, Trash2, Upload } from 'lucide-react';
import * as db from '../db';
import type { ProjectMeta } from '../types';
import { Doc } from '../engine/doc';
import { ImportDialog } from './ImportDialog';
import { makeSampleDoc } from './sample';

const PRESETS = [
  { label: 'HD 16:9', w: 1280, h: 720 },
  { label: 'Full HD', w: 1920, h: 1080 },
  { label: 'Square', w: 1080, h: 1080 },
  { label: 'Vertical 9:16', w: 1080, h: 1920 },
  { label: 'Small 4:3', w: 800, h: 600 },
];

export function Home({ onOpen }: { onOpen: (d: Doc) => void }) {
  const [projects, setProjects] = useState<ProjectMeta[] | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [preset, setPreset] = useState(0);
  const [cw, setCw] = useState(1280);
  const [ch, setCh] = useState(720);
  const [fps, setFps] = useState(12);
  const [frames, setFrames] = useState(24);
  const [paper, setPaper] = useState('#ffffff');
  const [name, setName] = useState('');
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
    const d = Doc.blank({ name: name.trim() || 'Untitled animation', width: Math.max(16, Math.min(4096, W)), height: Math.max(16, Math.min(4096, H)), fps, frames: Math.max(1, Math.min(1000, frames)), paper });
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
      onDrop={(e) => { e.preventDefault(); setDragOver(false); const f = [...e.dataTransfer.files].find((x) => x.type.startsWith('video/')); pickVideo(f); }}
    >
      <header className="home-head">
        <div className="brand">
          <span className="logo" aria-hidden><Film size={22} /></span>
          <div>
            <h1>Frameink</h1>
            <p>Frame-by-frame animation, on its own or drawn over video.</p>
          </div>
        </div>
      </header>

      <main className="home-main">
        <section className="start-cards">
          <div className="card video-card">
            <div className="card-kicker">Rotoscope</div>
            <h2>Animate over a video</h2>
            <p>Pick a clip, choose how to split it (every frame, 6 to 24 fps, on twos, or a frame count) and trace on top.</p>
            <input ref={fileInput} id="video-file" type="file" accept="video/*" hidden onChange={(e) => pickVideo(e.target.files?.[0])} />
            <button className="pill primary" onClick={() => fileInput.current?.click()}><Upload size={16} /> Choose video</button>
            <p className="hint">Or drop a video file anywhere on this page. Nothing is uploaded: the video stays on this device.</p>
          </div>

          <div className="card blank-card">
            <div className="card-kicker">Blank</div>
            <h2>New animation</h2>
            <label className="field" htmlFor="new-name"><span>Name</span><input id="new-name" placeholder="Untitled animation" value={name} onChange={(e) => setName(e.target.value)} /></label>
            <label className="field" htmlFor="new-size">
              <span>Canvas</span>
              <select id="new-size" value={preset} onChange={(e) => setPreset(+e.target.value)}>
                {PRESETS.map((p, i) => <option key={p.label} value={i}>{p.label} · {p.w}×{p.h}</option>)}
                <option value={PRESETS.length}>Custom size</option>
              </select>
            </label>
            {custom && (
              <div className="two">
                <label className="field" htmlFor="new-w"><span>Width</span><input id="new-w" type="number" min={16} max={4096} value={cw} onChange={(e) => setCw(+e.target.value)} /></label>
                <label className="field" htmlFor="new-h"><span>Height</span><input id="new-h" type="number" min={16} max={4096} value={ch} onChange={(e) => setCh(+e.target.value)} /></label>
              </div>
            )}
            <div className="two">
              <label className="field" htmlFor="new-fps">
                <span>Speed</span>
                <select id="new-fps" value={fps} onChange={(e) => setFps(+e.target.value)}>
                  {[6, 8, 12, 15, 24, 30].map((f) => <option key={f} value={f}>{f} fps</option>)}
                </select>
              </label>
              <label className="field" htmlFor="new-frames"><span>Frames</span><input id="new-frames" type="number" min={1} max={1000} value={frames} onChange={(e) => setFrames(+e.target.value)} /></label>
            </div>
            <label className="field inline" htmlFor="new-paper"><span>Paper</span><input id="new-paper" type="color" value={paper} onChange={(e) => setPaper(e.target.value)} /></label>
            <p className="hint">{(frames / fps).toFixed(1)} seconds. You can add or remove frames later.</p>
            <button className="pill primary" onClick={createBlank}><Plus size={16} /> Create</button>
          </div>
        </section>

        <section className="projects">
          <div className="projects-head">
            <h2>Your animations</h2>
            <span className="hint">Saved automatically in this browser</span>
          </div>
          {projects === null ? (
            <p className="hint">Loading…</p>
          ) : projects.length === 0 ? (
            <div className="empty">
              <p>No animations yet. Start one above, or open a short example to try the tools.</p>
              <button className="pill" onClick={async () => { const d = await makeSampleDoc(); onOpen(d); }}>Open example</button>
            </div>
          ) : (
            <ul className="project-grid">
              {projects.map((p) => (
                <li key={p.id} className="project">
                  <button className="project-open" onClick={() => open(p.id)} disabled={opening}>
                    <div className="project-thumb" style={{ aspectRatio: `${p.width} / ${p.height}`, background: p.paper }}>
                      {p.thumb && <img src={p.thumb} alt="" />}
                      {p.hasVideo && <span className="tag">Video</span>}
                    </div>
                    <div className="project-meta">
                      <b>{p.name}</b>
                      <span>{p.frames.length} frames · {p.fps} fps · {new Date(p.updated).toLocaleDateString()}</span>
                    </div>
                  </button>
                  {confirmDel === p.id ? (
                    <div className="confirm">
                      <span>Delete for good?</span>
                      <button className="pill small danger" onClick={async () => { await db.deleteProject(p.id); setConfirmDel(null); refresh(); }}>Delete</button>
                      <button className="pill small" onClick={() => setConfirmDel(null)}>Keep</button>
                    </div>
                  ) : (
                    <button className="icon-btn small del" onClick={() => setConfirmDel(p.id)} aria-label={`Delete ${p.name}`}><Trash2 size={16} /></button>
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
