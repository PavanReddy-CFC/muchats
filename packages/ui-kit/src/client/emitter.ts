/** Minimal typed pub-sub — avoids depending on Node's 'events' module, which isn't
 *  bundled in React Native by default. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export class TypedEmitter<Events extends { [K in keyof Events]: (...args: any[]) => void }> {
  private listeners: { [K in keyof Events]?: Set<Events[K]> } = {};

  on<K extends keyof Events>(event: K, handler: Events[K]): () => void {
    const set = (this.listeners[event] ??= new Set());
    set.add(handler);
    return () => set.delete(handler);
  }

  emit<K extends keyof Events>(event: K, ...args: Parameters<Events[K]>): void {
    this.listeners[event]?.forEach((handler) => handler(...args));
  }
}
