import { useEffect, useState, useSyncExternalStore } from 'react';
import type { Editor, UIState } from '../engine/editor';
import type { Doc } from '../engine/doc';

export function useUI(ed: Editor): UIState {
  return useSyncExternalStore(ed.store.subscribe, ed.store.get);
}

export function useDocVersion(doc: Doc) {
  const [v, setV] = useState(0);
  useEffect(() => {
    let raf = 0;
    return doc.subscribe(() => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => setV((x) => x + 1));
    });
  }, [doc]);
  return v;
}

export function useMedia(q: string) {
  const [m, setM] = useState(() => window.matchMedia(q).matches);
  useEffect(() => {
    const mq = window.matchMedia(q);
    const f = () => setM(mq.matches);
    mq.addEventListener('change', f);
    return () => mq.removeEventListener('change', f);
  }, [q]);
  return m;
}
