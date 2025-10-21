import { StorageManager } from '../../storage';

export interface TelegrafSessionStore<T> {
  get: (key: string) => Promise<T | undefined>;
  set: (key: string, value: T) => Promise<void>;
  delete: (key: string) => Promise<void>;
}

export class MongoSessionStore<T = any> implements TelegrafSessionStore<T> {
  private storage = StorageManager.getInstance();
  private ttlMs: number;

  constructor(ttlMs: number = 7 * 24 * 60 * 60 * 1000) {
    this.ttlMs = ttlMs;
  }

  async get(key: string): Promise<T | undefined> {
    try {
      const session = await this.storage.get<any>('sessions', key);
      if (!session) return undefined;
      if (session.expiresAt && Date.now() > new Date(session.expiresAt).getTime()) {
        await this.delete(key);
        return undefined;
      }
      return session.data as T;
    } catch {
      return undefined;
    }
  }

  async set(key: string, value: T): Promise<void> {
    const now = Date.now();
    const doc = {
      id: key,
      data: value,
      updatedAt: new Date(now).toISOString(),
      expiresAt: new Date(now + this.ttlMs).toISOString()
    };
    await this.storage.set('sessions', doc, key);
  }

  async delete(key: string): Promise<void> {
    await this.storage.delete('sessions', key);
  }
}
