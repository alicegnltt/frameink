// Minimal observable store for React (useSyncExternalStore).
export class Store<T extends object> {
  private listeners = new Set<() => void>();
  constructor(private state: T) {}
  get = () => this.state;
  set = (p: Partial<T> | ((s: T) => Partial<T>)) => {
    const patch = typeof p === 'function' ? p(this.state) : p;
    this.state = { ...this.state, ...patch };
    this.listeners.forEach((l) => l());
  };
  subscribe = (l: () => void) => {
    this.listeners.add(l);
    return () => { this.listeners.delete(l); };
  };
}
