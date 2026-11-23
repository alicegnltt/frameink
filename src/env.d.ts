declare const __SINGLE__: boolean;
declare module 'gifenc' {
  export function GIFEncoder(): any;
  export function quantize(data: Uint8Array | Uint8ClampedArray, maxColors: number, opts?: any): number[][];
  export function applyPalette(data: Uint8Array | Uint8ClampedArray, palette: number[][], format?: string): Uint8Array;
}
