// Tiny IndexedDB wrapper. Every call is wrapped so the app still works when storage is blocked.
import type { ProjectMeta } from './types';

let dbp: Promise<IDBDatabase | null> | null = null;

function open(): Promise<IDBDatabase | null> {
  if (dbp) return dbp;
  dbp = new Promise((resolve) => {
    try {
      const req = indexedDB.open('frameink', 1);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains('projects')) db.createObjectStore('projects', { keyPath: 'id' });
        if (!db.objectStoreNames.contains('blobs')) db.createObjectStore('blobs');
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
      req.onblocked = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
  return dbp;
}

function wrap<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((res, rej) => {
    req.onsuccess = () => res(req.result);
    req.onerror = () => rej(req.error);
  });
}

export const storageAvailable = async () => !!(await open());

export async function listProjects(): Promise<ProjectMeta[]> {
  const db = await open();
  if (!db) return [];
  try {
    const all = await wrap(db.transaction('projects').objectStore('projects').getAll());
    return (all as ProjectMeta[]).sort((a, b) => b.updated - a.updated);
  } catch {
    return [];
  }
}

export async function getProject(id: string): Promise<ProjectMeta | null> {
  const db = await open();
  if (!db) return null;
  try {
    return ((await wrap(db.transaction('projects').objectStore('projects').get(id))) as ProjectMeta) ?? null;
  } catch {
    return null;
  }
}

export async function putProject(meta: ProjectMeta) {
  const db = await open();
  if (!db) return;
  try {
    await wrap(db.transaction('projects', 'readwrite').objectStore('projects').put(meta));
  } catch (e) {
    console.warn('save meta failed', e);
  }
}

export async function putBlobs(entries: [string, Blob | null][]) {
  const db = await open();
  if (!db || !entries.length) return;
  try {
    const tx = db.transaction('blobs', 'readwrite');
    const st = tx.objectStore('blobs');
    for (const [k, b] of entries) {
      if (b) st.put(b, k);
      else st.delete(k);
    }
    await new Promise<void>((res, rej) => {
      tx.oncomplete = () => res();
      tx.onerror = () => rej(tx.error);
      tx.onabort = () => rej(tx.error);
    });
  } catch (e) {
    console.warn('save blobs failed', e);
  }
}

export async function getBlob(key: string): Promise<Blob | null> {
  const db = await open();
  if (!db) return null;
  try {
    return ((await wrap(db.transaction('blobs').objectStore('blobs').get(key))) as Blob) ?? null;
  } catch {
    return null;
  }
}

export async function deleteProject(id: string) {
  const db = await open();
  if (!db) return;
  try {
    const tx = db.transaction(['projects', 'blobs'], 'readwrite');
    tx.objectStore('projects').delete(id);
    const range = IDBKeyRange.bound(id + '/', id + '/￿');
    tx.objectStore('blobs').delete(range);
    await new Promise<void>((res) => {
      tx.oncomplete = () => res();
      tx.onerror = () => res();
    });
  } catch {}
}

export async function requestPersist() {
  try {
    await navigator.storage?.persist?.();
  } catch {}
}
