import { useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { Editor, PALETTE } from '../engine/editor';
import type { Doc } from '../engine/doc';
import type { ToolId, OnionMode } from '../types';
import { useDocVersion, useMedia, useUI } from './hooks';
import { Timeline } from './Timeline';
import { ExportDialog } from './ExportDialog';
import {
  PenTool, Pencil, Paintbrush, Eraser, PaintBucket, Lasso, Pipette, Slash, Square, Circle, Hand, LocateFixed,
  Undo2, Redo2, Layers, Ghost, Video, Download, Settings, ChevronLeft, Eye, EyeOff, Lock, LockOpen, Plus, Trash2,
  ChevronUp, ChevronDown, Copy, Scissors, ClipboardPaste, FlipHorizontal2, FlipVertical2, Check, ArrowRightToLine,
  Maximize, ZoomIn, ZoomOut, SlidersHorizontal, X,
} from 'lucide-react';

const TOOLS: { id: ToolId; label: string; key: string; icon: ReactNode }[] = [
  { id: 'pen', label: 'Pen', key: 'B', icon: <PenTool size={20} /> },
  { id: 'pencil', label: 'Pencil', key: 'N', icon: <Pencil size={20} /> },
  { id: 'brush', label: 'Brush', key: 'M', icon: <Paintbrush size={20} /> },
  { id: 'eraser', label: 'Eraser', key: 'E', icon: <Eraser size={20} /> },
  { id: 'fill', label: 'Fill', key: 'G', icon: <PaintBucket size={20} /> },
  { id: 'lasso', label: 'Lasso select', key: 'L', icon: <Lasso size={20} /> },
  { id: 'eyedropper', label: 'Eyedropper', key: 'I', icon: <Pipette size={20} /> },
  { id: 'line', label: 'Line', key: 'U', icon: <Slash size={20} /> },
  { id: 'rect', label: 'Rectangle', key: 'R', icon: <Square size={20} /> },
  { id: 'ellipse', label: 'Ellipse', key: 'O', icon: <Circle size={20} /> },
  { id: 'hand', label: 'Pan', key: 'H', icon: <Hand size={20} /> },
  { id: 'track', label: 'Motion track', key: 'T', icon: <LocateFixed size={20} /> },
];

type Panel = null | 'onion' | 'video' | 'layers' | 'settings' | 'export' | 'range' | 'options';

export function EditorView({ doc, onExit }: { doc: Doc; onExit: () => void }) {
  const ed = useMemo(() => new Editor(doc), [doc]);
  const ui = useUI(ed);
  useDocVersion(doc);
  const host = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const [panel, setPanel] = useState<Panel>(null);
  const narrow = useMedia('(max-width: 760px)');

  useEffect(() => {
    ed.attach(canvas.current!, host.current!);
    return () => ed.destroy();
  }, [ed]);

  useEffect(() => {
    const save = () => doc.save();
    window.addEventListener('pagehide', save);
    document.addEventListener('visibilitychange', save);
    return () => { window.removeEventListener('pagehide', save); document.removeEventListener('visibilitychange', save); };
  }, [doc]);

  const toggle = (p: Panel) => setPanel((cur) => (cur === p ? null : p));
  const tools = TOOLS.filter((t) => t.id !== 'track' || doc.meta.hasVideo);
  const saveState = doc.saving ? 'Saving…' : doc.lastSaved ? 'Saved' : '';

  return (
    <div className={'editor' + (narrow ? ' narrow' : '')}>
      <header className="topbar">
        <button className="icon-btn" onClick={() => { doc.save(); onExit(); }} title="Back to projects" aria-label="Back to projects"><ChevronLeft size={22} /></button>
        <div className="title">
          <input
            id="project-name"
            className="name-input"
            value={doc.meta.name}
            onChange={(e) => { doc.meta.name = e.target.value; doc.touchMeta(); }}
            aria-label="Project name"
          />
          <span className="save-state">{saveState}</span>
        </div>
        <div className="top-actions">
          <button className="icon-btn" disabled={!ui.canUndo && !ui.hasSelection} onClick={() => ed.undo()} title="Undo (Ctrl+Z, two-finger tap)" aria-label="Undo"><Undo2 size={20} /></button>
          <button className="icon-btn" disabled={!ui.canRedo} onClick={() => ed.redo()} title="Redo (Shift+Ctrl+Z, three-finger tap)" aria-label="Redo"><Redo2 size={20} /></button>
          <span className="sep" />
          <button className={'icon-btn' + (ui.onion !== 'off' ? ' on' : '')} onClick={() => toggle('onion')} title="Onion skin (K)" aria-label="Onion skin"><Ghost size={20} /></button>
          {doc.meta.hasVideo && (
            <button className={'icon-btn' + (ui.videoVisible ? ' on' : '')} onClick={() => toggle('video')} title="Video (V)" aria-label="Video settings"><Video size={20} /></button>
          )}
          <button className={'icon-btn' + (panel === 'layers' ? ' on' : '')} onClick={() => toggle('layers')} title="Layers" aria-label="Layers"><Layers size={20} /></button>
          {narrow && <button className={'icon-btn' + (panel === 'options' ? ' on' : '')} onClick={() => toggle('options')} title="Tool options" aria-label="Tool options"><SlidersHorizontal size={20} /></button>}
          <button className="icon-btn" onClick={() => toggle('settings')} title="Settings" aria-label="Settings"><Settings size={20} /></button>
          <button className="pill primary" onClick={() => toggle('export')}><Download size={16} /> <span className="hide-sm">Export</span></button>
        </div>
      </header>

      <div className="workspace">
        <nav className="toolbar" aria-label="Tools">
          {tools.map((t) => (
            <button
              key={t.id}
              className={'tool' + (ui.tool === t.id ? ' active' : '')}
              onClick={() => { ed.setTool(t.id); if (narrow && ui.tool === t.id) toggle('options'); }}
              title={`${t.label} (${t.key})`}
              aria-label={t.label}
              aria-pressed={ui.tool === t.id}
            >
              {t.icon}
            </button>
          ))}
          <span className="tool-sep" />
          <label className="color-well" title="Color" style={{ background: ui.color }}>
            <input id="color-quick" type="color" value={ui.color} onChange={(e) => ed.setColor(e.target.value, false)} onBlur={(e) => ed.setColor(e.target.value)} aria-label="Color" />
          </label>
        </nav>

        <div className="stage" ref={host}>
          <canvas ref={canvas} className="view" />
          <div className="zoom-ctl">
            <button className="icon-btn small" onClick={() => ed.zoomBy(0.8)} aria-label="Zoom out"><ZoomOut size={16} /></button>
            <button className="zoom-label" onClick={() => ed.actualSize()} title="Actual size (1)">{Math.round(ui.zoom * 100)}%</button>
            <button className="icon-btn small" onClick={() => ed.zoomBy(1.25)} aria-label="Zoom in"><ZoomIn size={16} /></button>
            <button className="icon-btn small" onClick={() => ed.fit()} title="Fit and reset rotation (0)" aria-label="Fit to screen"><Maximize size={16} /></button>
          </div>
          {ui.hasSelection && <SelectionBar ed={ed} />}
          {ui.frame > 0 && doc.frames[ui.frame]?.hold && (
            <div className="badge-held">Holding frame {doc.drawingIndex(ui.frame) + 1}</div>
          )}
          {ui.toast && (
            <div className="toast" key={ui.toast.id} role="status">
              <span>{ui.toast.text}</span>
              {ui.toast.action && <button onClick={() => { ui.toast!.action!.run(); ed.store.set({ toast: null }); }}>{ui.toast.action.label}</button>}
            </div>
          )}
          {ui.busy && (
            <div className="busy">
              <div>{ui.busy.label}… {Math.round(ui.busy.progress * 100)}%</div>
              <div className="bar"><i style={{ width: `${ui.busy.progress * 100}%` }} /></div>
              {ui.busy.cancel && <button className="pill" onClick={ui.busy.cancel}>Stop</button>}
            </div>
          )}
          {panel === 'onion' && <Popover onClose={() => setPanel(null)} title="Onion skin"><OnionPanel ed={ed} /></Popover>}
          {panel === 'video' && <Popover onClose={() => setPanel(null)} title="Video"><VideoPanel ed={ed} /></Popover>}
          {panel === 'layers' && <Popover onClose={() => setPanel(null)} title="Layers"><LayersPanel ed={ed} /></Popover>}
          {panel === 'settings' && <Popover onClose={() => setPanel(null)} title="Settings"><SettingsPanel ed={ed} /></Popover>}
          {panel === 'range' && <Popover onClose={() => setPanel(null)} title="Copy to frames"><RangePanel ed={ed} onDone={() => setPanel(null)} /></Popover>}
          {panel === 'options' && narrow && <Popover onClose={() => setPanel(null)} title={TOOLS.find((t) => t.id === ui.tool)?.label ?? 'Options'} sheet><ToolOptions ed={ed} /></Popover>}
        </div>

        {!narrow && (
          <aside className="inspector" aria-label="Tool options">
            <h2>{TOOLS.find((t) => t.id === ui.tool)?.label}</h2>
            <ToolOptions ed={ed} />
          </aside>
        )}
      </div>

      <Timeline ed={ed} onRange={() => toggle('range')} />
      {panel === 'export' && <ExportDialog ed={ed} onClose={() => setPanel(null)} />}
    </div>
  );
}

function Popover({ title, children, onClose, sheet }: { title: string; children: ReactNode; onClose: () => void; sheet?: boolean }) {
  return (
    <div className={'popover' + (sheet ? ' sheet' : '')} role="dialog" aria-label={title}>
      <div className="pop-head">
        <h3>{title}</h3>
        <button className="icon-btn small" onClick={onClose} aria-label="Close"><X size={16} /></button>
      </div>
      <div className="pop-body">{children}</div>
    </div>
  );
}

function Slider({ id, label, value, min, max, step = 1, onChange, fmt }: { id: string; label: string; value: number; min: number; max: number; step?: number; onChange: (v: number) => void; fmt?: (v: number) => string }) {
  return (
    <label className="slider" htmlFor={id}>
      <span className="row"><span>{label}</span><span className="val">{fmt ? fmt(value) : value}</span></span>
      <input id={id} type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(+e.target.value)} />
    </label>
  );
}

function Toggle({ id, label, checked, onChange }: { id: string; label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="toggle" htmlFor={id}>
      <span>{label}</span>
      <input id={id} type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <i aria-hidden />
    </label>
  );
}

function ColorSection({ ed }: { ed: Editor }) {
  const ui = useUI(ed);
  const [hex, setHex] = useState(ui.color);
  useEffect(() => setHex(ui.color), [ui.color]);
  return (
    <section className="section">
      <div className="section-title">Color</div>
      <div className="color-row">
        <label className="color-big" style={{ background: ui.color }}>
          <input id="color-picker" type="color" value={ui.color} onChange={(e) => ed.setColor(e.target.value, false)} onBlur={(e) => ed.setColor(e.target.value)} aria-label="Pick color" />
        </label>
        <input
          id="color-hex"
          className="hex"
          value={hex}
          onChange={(e) => { setHex(e.target.value); if (/^#[0-9a-f]{6}$/i.test(e.target.value)) ed.setColor(e.target.value.toLowerCase()); }}
          aria-label="Hex color"
        />
        <button className="icon-btn small" onClick={() => ed.setTool('eyedropper')} title="Eyedropper (I)" aria-label="Eyedropper"><Pipette size={16} /></button>
      </div>
      <div className="swatches">
        {PALETTE.map((c) => (
          <button key={c} className={'sw' + (c === ui.color ? ' sel' : '')} style={{ background: c }} onClick={() => ed.setColor(c)} aria-label={c} />
        ))}
      </div>
      {ui.recent.length > 0 && (
        <>
          <div className="mini-title">Recent</div>
          <div className="swatches">
            {ui.recent.map((c) => (
              <button key={c} className={'sw' + (c === ui.color ? ' sel' : '')} style={{ background: c }} onClick={() => ed.setColor(c)} aria-label={c} />
            ))}
          </div>
        </>
      )}
    </section>
  );
}

function ToolOptions({ ed }: { ed: Editor }) {
  const ui = useUI(ed);
  const t = ui.tool;
  if (t === 'pen' || t === 'pencil' || t === 'brush' || t === 'eraser') {
    const b = ui.brushes[t];
    return (
      <>
        <section className="section">
          <BrushPreview size={b.size} color={t === 'eraser' ? '#9aa3b2' : ui.color} />
          <Slider id={`${t}-size`} label="Size" value={b.size} min={0.5} max={t === 'brush' || t === 'eraser' ? 200 : 60} step={0.5} onChange={(v) => ed.setBrush(t, { size: v })} fmt={(v) => `${v}px`} />
          <Slider id={`${t}-opacity`} label="Opacity" value={Math.round(b.opacity * 100)} min={5} max={100} onChange={(v) => ed.setBrush(t, { opacity: v / 100 })} fmt={(v) => `${v}%`} />
          <Slider id={`${t}-smooth`} label="Smoothing" value={Math.round(b.smoothing * 100)} min={0} max={100} onChange={(v) => ed.setBrush(t, { smoothing: v / 100 })} fmt={(v) => `${v}%`} />
          <Toggle id={`${t}-psize`} label="Pressure changes size" checked={b.pressureSize} onChange={(v) => ed.setBrush(t, { pressureSize: v })} />
          {t !== 'eraser' && <Toggle id={`${t}-popa`} label="Pressure changes opacity" checked={b.pressureOpacity} onChange={(v) => ed.setBrush(t, { pressureOpacity: v })} />}
          {t === 'eraser' && <button className="pill wide" onClick={() => ed.clearFrameLayer()}><Trash2 size={16} /> Clear this layer on this frame</button>}
        </section>
        {t !== 'eraser' && <ColorSection ed={ed} />}
      </>
    );
  }
  if (t === 'fill') {
    return (
      <>
        <section className="section">
          <Slider id="fill-tol" label="Tolerance" value={ui.fillTolerance} min={0} max={100} onChange={(v) => ed.store.set({ fillTolerance: v })} fmt={(v) => `${v}%`} />
          <Slider id="fill-gap" label="Close gaps" value={ui.fillGap} min={0} max={20} onChange={(v) => ed.store.set({ fillGap: v })} fmt={(v) => (v ? `${v}px` : 'off')} />
          <Toggle id="fill-all" label="Use lines from all layers" checked={ui.fillAllLayers} onChange={(v) => ed.store.set({ fillAllLayers: v })} />
          <p className="hint">Fill goes under the lines on the current layer. Put color on its own layer to keep it separate from line art.</p>
        </section>
        <ColorSection ed={ed} />
      </>
    );
  }
  if (t === 'line' || t === 'rect' || t === 'ellipse') {
    return (
      <>
        <section className="section">
          <Slider id="shape-size" label="Line width" value={ui.shapeSize} min={1} max={60} onChange={(v) => ed.store.set({ shapeSize: v })} fmt={(v) => `${v}px`} />
          <p className="hint">Hold Shift to snap angles or make a perfect square or circle.</p>
        </section>
        <ColorSection ed={ed} />
      </>
    );
  }
  if (t === 'lasso') {
    return (
      <section className="section">
        <p className="hint">Draw around part of the drawing to select it. Drag inside to move, a corner to scale, the round handle to rotate.</p>
        <div className="btn-grid">
          <button className="pill" onClick={() => ed.selectAll()}>Select all</button>
          <button className="pill" disabled={!ui.hasClipboard} onClick={() => ed.paste()}><ClipboardPaste size={16} /> Paste</button>
        </div>
        {ui.hasSelection && <SelectionActions ed={ed} />}
      </section>
    );
  }
  if (t === 'eyedropper') return <><section className="section"><p className="hint">Tap or drag on the canvas to pick a color.</p></section><ColorSection ed={ed} /></>;
  if (t === 'hand') return <section className="section"><p className="hint">Drag to move around. Pinch with two fingers to zoom and rotate. Space + drag also pans with a mouse.</p></section>;
  if (t === 'track') {
    return (
      <section className="section">
        <p className="hint">1. Go to the first frame of the motion. 2. Draw what should follow it. 3. With this tool, tap the spot in the video to follow (pick a high-contrast detail).</p>
        <Slider id="track-n" label="Frames to track" value={ui.trackFrames} min={0} max={Math.max(1, ed.doc.frames.length - 1)} onChange={(v) => ed.store.set({ trackFrames: v })} fmt={(v) => (v ? String(v) : 'to the end')} />
        <button className="pill primary wide" disabled={!ed.lastTrack} onClick={() => ed.stickToTrack()}>Stick drawing to the motion</button>
        <p className="hint">Copies the current layer's drawing from the tracked frame onto each following frame, moved with the motion. Undo reverses it in one step.</p>
      </section>
    );
  }
  return null;
}

function BrushPreview({ size, color }: { size: number; color: string }) {
  const d = Math.min(56, Math.max(2, size));
  return (
    <div className="brush-preview" aria-hidden>
      <span style={{ width: d, height: d, background: color }} />
    </div>
  );
}

function SelectionActions({ ed }: { ed: Editor }) {
  return (
    <div className="btn-grid">
      <button className="pill" onClick={() => ed.copySelection()}><Copy size={16} /> Copy</button>
      <button className="pill" onClick={() => ed.cutSelection()}><Scissors size={16} /> Cut</button>
      <button className="pill" onClick={() => ed.flipSelection('h')}><FlipHorizontal2 size={16} /> Flip</button>
      <button className="pill" onClick={() => ed.flipSelection('v')}><FlipVertical2 size={16} /> Flip V</button>
      <button className="pill danger" onClick={() => ed.deleteSelection()}><Trash2 size={16} /> Delete</button>
      <button className="pill primary" onClick={() => ed.pasteToNext()}><ArrowRightToLine size={16} /> To next frame</button>
      <button className="pill wide" onClick={() => ed.commitFloating()}><Check size={16} /> Done</button>
    </div>
  );
}

function SelectionBar({ ed }: { ed: Editor }) {
  return (
    <div className="selection-bar">
      <button className="icon-btn small" onClick={() => ed.copySelection()} title="Copy" aria-label="Copy"><Copy size={16} /></button>
      <button className="icon-btn small" onClick={() => ed.cutSelection()} title="Cut" aria-label="Cut"><Scissors size={16} /></button>
      <button className="icon-btn small" onClick={() => ed.flipSelection('h')} title="Flip horizontally" aria-label="Flip horizontally"><FlipHorizontal2 size={16} /></button>
      <button className="icon-btn small danger" onClick={() => ed.deleteSelection()} title="Delete" aria-label="Delete"><Trash2 size={16} /></button>
      <button className="pill small primary" onClick={() => ed.pasteToNext()} title="Paste a copy on the next frame"><ArrowRightToLine size={14} /> Next frame</button>
      <button className="pill small" onClick={() => ed.commitFloating()}><Check size={14} /> Done</button>
    </div>
  );
}

function OnionPanel({ ed }: { ed: Editor }) {
  const ui = useUI(ed);
  const modes: { id: OnionMode; label: string }[] = [
    { id: 'off', label: 'Off' }, { id: 'before', label: 'Before' }, { id: 'after', label: 'After' }, { id: 'both', label: 'Both' },
  ];
  const set = (p: Partial<typeof ui>) => { ed.store.set(p); ed.pinFrame(); };
  return (
    <>
      <div className="segmented" role="radiogroup" aria-label="Onion skin mode">
        {modes.map((m) => (
          <button key={m.id} role="radio" aria-checked={ui.onion === m.id} className={ui.onion === m.id ? 'sel' : ''} onClick={() => set({ onion: m.id })}>{m.label}</button>
        ))}
      </div>
      <Slider id="onion-before" label="Frames before" value={ui.onionBefore} min={1} max={6} onChange={(v) => set({ onionBefore: v })} />
      <Slider id="onion-after" label="Frames after" value={ui.onionAfter} min={1} max={6} onChange={(v) => set({ onionAfter: v })} />
      <Slider id="onion-opacity" label="Opacity" value={Math.round(ui.onionOpacity * 100)} min={5} max={100} onChange={(v) => set({ onionOpacity: v / 100 })} fmt={(v) => `${v}%`} />
      <Toggle id="onion-tint" label="Tint (red before, green after)" checked={ui.onionTint} onChange={(v) => set({ onionTint: v })} />
    </>
  );
}

function VideoPanel({ ed }: { ed: Editor }) {
  const ui = useUI(ed);
  return (
    <>
      <Toggle id="video-visible" label="Show video" checked={ui.videoVisible} onChange={(v) => ed.store.set({ videoVisible: v })} />
      <Slider id="video-opacity" label="Video opacity" value={Math.round(ui.videoOpacity * 100)} min={0} max={100} onChange={(v) => ed.store.set({ videoOpacity: v / 100 })} fmt={(v) => `${v}%`} />
      <Toggle id="edge-guide" label="Edge guide (auto-traced outlines)" checked={ui.edgeGuide} onChange={(v) => ed.store.set({ edgeGuide: v })} />
      {ui.edgeGuide && <Slider id="edge-th" label="Edge sensitivity" value={200 - ui.edgeThreshold} min={20} max={190} onChange={(v) => ed.store.set({ edgeThreshold: 200 - v })} />}
      <Toggle id="audio" label="Sound (scrub and playback)" checked={ui.audio} onChange={(v) => ed.store.set({ audio: v })} />
      <p className="hint">{ed.doc.meta.videoName ? `Source: ${ed.doc.meta.videoName}` : ''}</p>
    </>
  );
}

function LayersPanel({ ed }: { ed: Editor }) {
  const ui = useUI(ed);
  useDocVersion(ed.doc);
  const layers = [...ed.doc.layers].reverse();
  return (
    <>
      <ul className="layers">
        {layers.map((l) => (
          <li key={l.id} className={l.id === ui.layerId ? 'sel' : ''} onClick={() => ed.selectLayer(l.id)}>
            <button className="icon-btn small" onClick={(e) => { e.stopPropagation(); ed.updateLayer(l.id, { visible: !l.visible }); }} aria-label={l.visible ? 'Hide layer' : 'Show layer'}>
              {l.visible ? <Eye size={16} /> : <EyeOff size={16} />}
            </button>
            <input
              id={`layer-name-${l.id}`}
              className="layer-name"
              value={l.name}
              onChange={(e) => ed.updateLayer(l.id, { name: e.target.value })}
              onClick={(e) => { e.stopPropagation(); ed.selectLayer(l.id); }}
              aria-label="Layer name"
            />
            <button className="icon-btn small" onClick={(e) => { e.stopPropagation(); ed.updateLayer(l.id, { locked: !l.locked }); }} aria-label={l.locked ? 'Unlock layer' : 'Lock layer'}>
              {l.locked ? <Lock size={16} /> : <LockOpen size={16} />}
            </button>
            <button className="icon-btn small" onClick={(e) => { e.stopPropagation(); ed.moveLayer(l.id, 1); }} aria-label="Move up"><ChevronUp size={16} /></button>
            <button className="icon-btn small" onClick={(e) => { e.stopPropagation(); ed.moveLayer(l.id, -1); }} aria-label="Move down"><ChevronDown size={16} /></button>
          </li>
        ))}
      </ul>
      {(() => {
        const l = ed.doc.layers.find((x) => x.id === ui.layerId);
        if (!l) return null;
        return <Slider id="layer-opacity" label={`"${l.name}" opacity`} value={Math.round(l.opacity * 100)} min={0} max={100} onChange={(v) => ed.updateLayer(l.id, { opacity: v / 100 })} fmt={(v) => `${v}%`} />;
      })()}
      <div className="btn-grid">
        <button className="pill" onClick={() => ed.addLayer()}><Plus size={16} /> New layer</button>
        <button className="pill danger" onClick={() => ed.deleteLayer(ui.layerId)}><Trash2 size={16} /> Delete</button>
      </div>
    </>
  );
}

function SettingsPanel({ ed }: { ed: Editor }) {
  const ui = useUI(ed);
  const doc = ed.doc;
  useDocVersion(doc);
  return (
    <>
      <div className="mini-title">Finger on touch screens</div>
      <div className="segmented">
        {([['auto', 'Auto'], ['draw', 'Draws'], ['navigate', 'Pans & zooms']] as const).map(([id, label]) => (
          <button key={id} className={ui.fingerMode === id ? 'sel' : ''} onClick={() => ed.store.set({ fingerMode: id })}>{label}</button>
        ))}
      </div>
      <p className="hint">Auto: fingers draw until an Apple Pencil is used, then only the Pencil draws and fingers move the canvas. Two-finger tap undoes, three-finger tap redoes.</p>
      <label className="field" htmlFor="fps">
        <span>Frames per second</span>
        <input id="fps" type="number" min={1} max={60} value={doc.meta.fps} onChange={(e) => { const v = Math.max(1, Math.min(60, +e.target.value || 12)); doc.meta.fps = v; doc.touchMeta(); }} />
      </label>
      <label className="field" htmlFor="paper">
        <span>Paper color</span>
        <input id="paper" type="color" value={doc.meta.paper} onChange={(e) => { doc.meta.paper = e.target.value; doc.touchMeta(); ed.requestRender(); }} />
      </label>
      <div className="mini-title">Timing for the whole animation</div>
      <div className="segmented">
        <button onClick={() => ed.setExposure(1)}>On ones</button>
        <button onClick={() => ed.setExposure(2)}>On twos</button>
        <button onClick={() => ed.setExposure(3)}>On threes</button>
      </div>
      <p className="hint">On twos makes every drawing last 2 frames, so you draw half as many. Drawings on held frames are kept and come back on ones.</p>
      <details className="keys">
        <summary>Keyboard shortcuts</summary>
        <p>B pen · N pencil · M brush · E eraser · G fill · L lasso · I eyedropper · U line · R rectangle · O ellipse · H pan · T track</p>
        <p>, and . previous/next frame · Enter play · K onion skin · V video · [ and ] brush size · 0 fit · 1 actual size · Ctrl+Z undo · Ctrl+Shift+Z redo · Ctrl+D copy to next frame · Ctrl+C / X / V selection · Space+drag pan · Mouse wheel zoom</p>
      </details>
    </>
  );
}

function RangePanel({ ed, onDone }: { ed: Editor; onDone: () => void }) {
  const ui = useUI(ed);
  const n = ed.doc.frames.length;
  const [from, setFrom] = useState(Math.min(n, ui.frame + 2));
  const [to, setTo] = useState(Math.min(n, ui.frame + 4));
  const [all, setAll] = useState(true);
  return (
    <>
      <p className="hint">Copies the drawing on frame {ui.frame + 1} onto every frame in the range. Existing drawings there are replaced (you can undo).</p>
      <div className="two">
        <label className="field" htmlFor="range-from"><span>From frame</span><input id="range-from" type="number" min={1} max={n} value={from} onChange={(e) => setFrom(+e.target.value)} /></label>
        <label className="field" htmlFor="range-to"><span>To frame</span><input id="range-to" type="number" min={1} max={n} value={to} onChange={(e) => setTo(+e.target.value)} /></label>
      </div>
      <Toggle id="range-all" label="All layers (off: only the current layer)" checked={all} onChange={setAll} />
      <button className="pill primary wide" onClick={async () => { onDone(); await ed.copyToRange(from - 1, to - 1, all); }}>Copy</button>
    </>
  );
}
