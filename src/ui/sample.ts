// A short example animation (a bouncing ball, drawn in code) so the first view is not empty.
import { Doc } from '../engine/doc';
import { ctx2d } from '../engine/canvas';

export async function makeSampleDoc(): Promise<Doc> {
  const d = Doc.blank({ name: 'Example: bouncing ball', width: 960, height: 540, fps: 12, frames: 12, paper: '#fbfaf7' });
  const [color, line] = d.layers;
  const n = d.frames.length;
  for (let i = 0; i < n; i++) {
    const f = d.frames[i];
    const t = i / n;
    const x = 140 + t * 680;
    const bounce = Math.abs(Math.cos(t * Math.PI * 2));
    const y = 440 - bounce * 300;
    const squash = bounce < 0.15 ? 1.35 : 1;
    const rx = 46 * squash, ry = 46 / squash;
    const cy = y + (46 - ry);
    const lc = ctx2d(await d.ensure(line.id, f.id));
    lc.strokeStyle = '#1d2433';
    lc.lineWidth = 5;
    lc.lineCap = 'round';
    lc.beginPath();
    lc.moveTo(60, 488); lc.lineTo(900, 488);
    lc.stroke();
    lc.beginPath();
    lc.ellipse(x, cy, rx, ry, 0, 0, Math.PI * 2);
    lc.stroke();
    const cc = ctx2d(await d.ensure(color.id, f.id));
    cc.fillStyle = '#f4a340';
    cc.beginPath();
    cc.ellipse(x, cy, rx, ry, 0, 0, Math.PI * 2);
    cc.fill();
    cc.fillStyle = 'rgba(29,36,51,0.15)';
    cc.beginPath();
    cc.ellipse(x, 490, 50 * (0.5 + 0.5 * (1 - bounce)), 8, 0, 0, Math.PI * 2);
    cc.fill();
    d.markDirty(line.id, f.id);
    d.markDirty(color.id, f.id);
  }
  await d.save();
  await d.rebuildAllThumbs();
  await d.save();
  return d;
}
