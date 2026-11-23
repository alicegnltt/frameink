# Frameink

Frame-by-frame animation in the browser: draw on blank frames, or split a video into frames and trace over it.
Runs fully on the device (nothing is uploaded). Works with Apple Pencil, mouse and finger.

## Run it
```
npm install
npm run dev        # local dev server (open the printed address, also from an iPad on the same Wi-Fi)
npm run build      # static site in dist/ (host anywhere over HTTPS to install it as an iPad app)
npm run build:single  # one self-contained HTML file in dist-single/
```
To install on iPad: host `dist/` over HTTPS (e.g. Netlify drop, GitHub Pages, Vercel), open it in Safari, Share > Add to Home Screen.

## Features
- Import: every frame, fixed FPS (6/8/12/24/custom), on twos/threes, or a total frame count; trim start/end; frame size.
- Blank animations: canvas size presets or custom, fps, frame count, paper color.
- Tools: pen, pencil (tilt shading), brush, eraser, fill (tolerance, close gaps, uses all layers), lasso select (move/scale/rotate/flip/copy/cut/paste/delete), eyedropper, line/rectangle/ellipse (Shift snaps), pan.
- Pressure for size and opacity, smoothing, color picker, hex, palette and recent colors.
- Undo/redo (Ctrl+Z, two-finger tap / three-finger tap), pinch zoom, two-finger pan and rotate.
- Fingers: Auto (draw until a Pencil is used, then fingers navigate), Draw, or Pan & zoom. Palm rejection while the Pencil is down.
- Animation: copy drawing to next frame, paste selection on next frame, copy to a frame range, duplicate/add/delete frames, hold frames, whole-animation timing on ones/twos/threes.
- Onion skin off/before/after/both, frame counts, opacity, red/green tint. Video show/hide and opacity.
- Layers: add, delete, rename, reorder, hide, lock, opacity.
- Playback with loop and speed; sound from the video during playback and scrubbing.
- Motion tracking: tap a point in the video and stick the current drawing to its motion.
- Edge guide: auto-traced outlines of the video as a faint guide.
- Autosave in the browser (IndexedDB). Export MP4 (WebCodecs, WebM/MP4 recording fallback), GIF, ZIP of PNG frames; drawing only or over video.

## Not possible in a web app
- Apple Pencil double-tap/squeeze is not exposed to websites (use the eraser button or E).
