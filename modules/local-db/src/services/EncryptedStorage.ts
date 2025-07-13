import sodium from 'libsodium-wrappers';
import type Database from 'better-sqlite3';
import type { IEncryptedStorage } from '../types';

export class EncryptedStorage implements IEncryptedStorage {
  private db: Database.Database | null = null;
  private encryptionKey: Uint8Array | null = null;

  async initialize(db: Database.Database, encryptionKey: Uint8Array): Promise<void> {
    await sodium.ready;
    this.db = db;
    this.encryptionKey = encryptionKey;

    // Сохранение тестовых данных для проверки ключа
    await this.set('encryption_test', { test: true });
  }

  async set(key: string, value: any): Promise<void> {
    if (!this.db || !this.encryptionKey) {
      throw new Error('Encrypted storage not initialized');
    }

    // Сериализация значения
    const serialized = JSON.stringify(value);
    const data = new TextEncoder().encode(serialized);

    // Шифрование
    const nonce = sodium.randombytes_buf(sodium.crypto_secretbox_NONCEBYTES);
    const encrypted = sodium.crypto_secretbox_easy(data, nonce, this.encryptionKey);

    // Сохранение в БД
    const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO encrypted_storage (key, value, nonce, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?)
    `);

    const now = new Date().toISOString();
    stmt.run(key, encrypted, nonce, now, now);
  }

  async get<T = any>(key: string): Promise<T | null> {
    if (!this.db || !this.encryptionKey) {
      throw new Error('Encrypted storage not initialized');
    }

    const stmt = this.db.prepare('SELECT value, nonce FROM encrypted_storage WHERE key = ?');
    const row = stmt.get(key) as { value: Buffer; nonce: Buffer } | undefined;

    if (!row) {
      return null;
    }

    try {
      // Расшифровка
      const decrypted = sodium.crypto_secretbox_open_easy(
        row.value,
        row.nonce,
        this.encryptionKey
      );

      // Десериализация
      const serialized = new TextDecoder().decode(decrypted);
      return JSON.parse(serialized) as T;
    } catch (error) {
      console.error('Failed to decrypt value:', error);
      return null;
    }
  }

  async delete(key: string): Promise<void> {
    if (!this.db) {
      throw new Error('Encrypted storage not initialized');
    }

    const stmt = this.db.prepare('DELETE FROM encrypted_storage WHERE key = ?');
    stmt.run(key);
  }

  async has(key: string): Promise<boolean> {
    if (!this.db) {
      throw new Error('Encrypted storage not initialized');
    }

    const stmt = this.db.prepare('SELECT 1 FROM encrypted_storage WHERE key = ? LIMIT 1');
    const exists = stmt.get(key);
    return !!exists;
  }

  async clear(): Promise<void> {
    if (!this.db) {
      throw new Error('Encrypted storage not initialized');
    }

    // Сохраняем тестовые данные
    const testData = await this.get('encryption_test');
    
    this.db.exec('DELETE FROM encrypted_storage');
    
    // Восстанавливаем тестовые данные
    if (testData) {
      await this.set('encryption_test', testData);
    }
  }

  async keys(): Promise<string[]> {
    if (!this.db) {
      throw new Error('Encrypted storage not initialized');
    }

    const stmt = this.db.prepare('SELECT key FROM encrypted_storage ORDER BY key');
    const rows = stmt.all() as { key: string }[];
    return rows.map(row => row.key);
  }

  // Дополнительные методы для работы с зашифрованными данными

  async setWithExpiry(key: string, value: any, ttlSeconds: number): Promise<void> {
    const expiryTime = Date.now() + (ttlSeconds * 1000);
    const wrappedValue = {
      value,
      expiryTime,
    };
    
    await this.set(key, wrappedValue);
  }

  async getWithExpiry<T = any>(key: string): Promise<T | null> {
    const wrapped = await this.get<{ value: T; expiryTime: number }>(key);
    
    if (!wrapped) {
      return null;
    }

    if (Date.now() > wrapped.expiryTime) {
      await this.delete(key);
      return null;
    }

    return wrapped.value;
  }

  async increment(key: string, amount: number = 1): Promise<number> {
    const current = await this.get<number>(key) || 0;
    const newValue = current + amount;
    await this.set(key, newValue);
    return newValue;
  }

  async append(key: string, value: any): Promise<void> {
    const current = await this.get<any[]>(key) || [];
    if (!Array.isArray(current)) {
      throw new Error('Value is not an array');
    }
    
    current.push(value);
    await this.set(key, current);
  }

  async getMultiple<T = any>(keys: string[]): Promise<Map<string, T>> {
    const results = new Map<string, T>();
    
    for (const key of keys) {
      const value = await this.get<T>(key);
      if (value !== null) {
        results.set(key, value);
      }
    }
    
    return results;
  }

  async setMultiple(entries: Map<string, any>): Promise<void> {
    for (const [key, value] of entries) {
      await this.set(key, value);
    }
  }

  // Методы для работы с большими данными

  async setChunked(key: string, data: Uint8Array, chunkSize: number = 1024 * 1024): Promise<void> {
    const chunks = Math.ceil(data.length / chunkSize);
    const metadata = {
      totalChunks: chunks,
      totalSize: data.length,
      chunkSize,
    };

    // Сохранение метаданных
    await this.set(`${key}:meta`, metadata);

    // Сохранение чанков
    for (let i = 0; i < chunks; i++) {
      const start = i * chunkSize;
      const end = Math.min(start + chunkSize, data.length);
      const chunk = data.slice(start, end);
      
      await this.set(`${key}:chunk:${i}`, Array.from(chunk));
    }
  }

  async getChunked(key: string): Promise<Uint8Array | null> {
    const metadata = await this.get<{
      totalChunks: number;
      totalSize: number;
      chunkSize: number;
    }>(`${key}:meta`);

    if (!metadata) {
      return null;
    }

    const result = new Uint8Array(metadata.totalSize);
    let offset = 0;

    // Загрузка чанков
    for (let i = 0; i < metadata.totalChunks; i++) {
      const chunk = await this.get<number[]>(`${key}:chunk:${i}`);
      if (!chunk) {
        throw new Error(`Missing chunk ${i} for key ${key}`);
      }
      
      result.set(new Uint8Array(chunk), offset);
      offset += chunk.length;
    }

    return result;
  }

  // Методы для безопасной работы

  async secureDelete(key: string): Promise<void> {
    // Перезапись данных случайными значениями перед удалением
    const randomData = sodium.randombytes_buf(1024);
    await this.set(key, randomData);
    
    // Удаление
    await this.delete(key);
  }

  async exportEncrypted(): Promise<Uint8Array> {
    if (!this.db || !this.encryptionKey) {
      throw new Error('Encrypted storage not initialized');
    }

    // Экспорт всех данных
    const allData: Record<string, any> = {};
    const keys = await this.keys();
    
    for (const key of keys) {
      const value = await this.get(key);
      if (value !== null) {
        allData[key] = value;
      }
    }

    // Сериализация и шифрование
    const serialized = JSON.stringify(allData);
    const data = new TextEncoder().encode(serialized);
    
    const nonce = sodium.randombytes_buf(sodium.crypto_secretbox_NONCEBYTES);
    const encrypted = sodium.crypto_secretbox_easy(data, nonce, this.encryptionKey);
    
    const result = new Uint8Array(nonce.length + encrypted.length);
    result.set(nonce);
    result.set(encrypted, nonce.length);
    
    return result;
  }

  async importEncrypted(encryptedData: Uint8Array): Promise<void> {
    if (!this.db || !this.encryptionKey) {
      throw new Error('Encrypted storage not initialized');
    }

    // Расшифровка
    const nonceLength = sodium.crypto_secretbox_NONCEBYTES;
    const nonce = encryptedData.slice(0, nonceLength);
    const encrypted = encryptedData.slice(nonceLength);
    
    const decrypted = sodium.crypto_secretbox_open_easy(
      encrypted,
      nonce,
      this.encryptionKey
    );

    // Десериализация и импорт
    const serialized = new TextDecoder().decode(decrypted);
    const allData = JSON.parse(serialized) as Record<string, any>;
    
    for (const [key, value] of Object.entries(allData)) {
      await this.set(key, value);
    }
  }
}
