export type ToolId =
  | 'pen' | 'pencil' | 'brush' | 'eraser' | 'fill' | 'lasso' | 'eyedropper'
  | 'line' | 'rect' | 'ellipse' | 'hand' | 'track';

export type OnionMode = 'off' | 'before' | 'after' | 'both';
export type FingerMode = 'auto' | 'draw' | 'navigate';

export interface Layer {
  id: string;
  name: string;
  visible: boolean;
  opacity: number; // 0..1
  locked: boolean;
}

export interface Frame {
  id: string;
  hold: boolean; // shows the drawing of the previous frame
  t?: number; // source video time (seconds)
  hasVideo?: boolean;
}

export interface ProjectMeta {
  id: string;
  name: string;
  width: number;
  height: number;
  fps: number;
  paper: string; // background color
  frames: Frame[];
  layers: Layer[];
  hasVideo: boolean;
  videoName?: string;
  created: number;
  updated: number;
  thumb?: string; // data url
}

export interface BrushSettings {
  size: number;
  opacity: number;
  smoothing: number; // 0..1
  pressureSize: boolean;
  pressureOpacity: boolean;
}

export const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
