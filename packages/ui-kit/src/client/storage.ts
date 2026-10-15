import AsyncStorage from '@react-native-async-storage/async-storage';

/** Namespaced AsyncStorage helper for the client's local cache + outgoing queue. */
export class ChatStorage {
  constructor(private readonly namespace: string) {}

  private key(name: string): string {
    return `qennect:${this.namespace}:${name}`;
  }

  async getJson<T>(name: string): Promise<T | null> {
    try {
      const raw = await AsyncStorage.getItem(this.key(name));
      return raw ? (JSON.parse(raw) as T) : null;
    } catch {
      return null;
    }
  }

  async setJson<T>(name: string, value: T): Promise<void> {
    try {
      await AsyncStorage.setItem(this.key(name), JSON.stringify(value));
    } catch {
      // Best-effort cache; a write failure shouldn't break the chat flow.
    }
  }
}
