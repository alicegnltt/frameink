import { useState } from 'react';
import { Home } from './ui/Home';
import { EditorView } from './ui/EditorView';
import type { Doc } from './engine/doc';

export function App() {
  const [doc, setDoc] = useState<Doc | null>(null);
  return doc ? <EditorView key={doc.meta.id} doc={doc} onExit={() => setDoc(null)} /> : <Home onOpen={setDoc} />;
}
