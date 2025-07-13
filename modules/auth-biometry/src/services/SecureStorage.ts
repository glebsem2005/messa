import sodium from 'libsodium-wrappers';
import type { DID } from '../types';

interface StorageKey {
  type: 'did' | 'privateKey' | 'faceData' | 'settings';
  id: string;
}

export class SecureStorage {
  private masterKey: Uint8Array | null = null;
  private storage: Map<string, Uint8Array> = new Map();

  async initialize(): Promise<void> {
    await sodium.ready;
    
    // Генерация или загрузка мастер-ключа
    // В реальном приложении ключ выводится из биометрии
    this.masterKey = sodium.crypto_secretbox_keygen();
  }

  async encryptData(data: Uint8Array): Promise<Uint8Array> {
    if (!this.masterKey) throw new Error('Storage not initialized');

    const nonce = sodium.randombytes_buf(sodium.crypto_secretbox_NONCEBYTES);
    const encrypted = sodium.crypto_secretbox_easy(data, nonce, this.masterKey);

    // Объединение nonce и зашифрованных данных
    const result = new Uint8Array(nonce.length + encrypted.length);
    result.set(nonce);
    result.set(encrypted, nonce.length);

    return result;
  }

  async decryptData(encryptedData: Uint8Array): Promise<Uint8Array> {
    if (!this.masterKey) throw new Error('Storage not initialized');

    const nonceLength = sodium.crypto_secretbox_NONCEBYTES;
    const nonce = encryptedData.slice(0, nonceLength);
    const ciphertext = encryptedData.slice(nonceLength);

    return sodium.crypto_secretbox_open_easy(ciphertext, nonce, this.masterKey);
  }

  private getKey(key: StorageKey): string {
    return `${key.type}:${key.id}`;
  }

  async saveDID(did: DID): Promise<void> {
    const key = this.getKey({ type: 'did', id: did.id });
    const data = new TextEncoder().encode(JSON.stringify(did));
    const encrypted = await this.encryptData(data);
    this.storage.set(key, encrypted);
  }

  async getDID(id: string): Promise<DID | null> {
    const key = this.getKey({ type: 'did', id });
    const encrypted = this.storage.get(key);
    
    if (!encrypted) return null;

    const decrypted = await this.decryptData(encrypted);
    const did = JSON.parse(new TextDecoder().decode(decrypted));
    
    // Восстановление Date объекта
    did.createdAt = new Date(did.createdAt);
    
    return did;
  }

  async updateDID(did: DID): Promise<void> {
    await this.saveDID(did);
  }

  async getAllDIDs(): Promise<string[]> {
    const dids: string[] = [];
    
    for (const key of this.storage.keys()) {
      if (key.startsWith('did:')) {
        const id = key.split(':')[1];
        dids.push(id);
      }
    }
    
    return dids;
  }

  async savePrivateKey(didId: string, privateKey: Uint8Array): Promise<void> {
    const key = this.getKey({ type: 'privateKey', id: didId });
    const encrypted = await this.encryptData(privateKey);
    this.storage.set(key, encrypted);
  }

  async getPrivateKey(didId: string): Promise<Uint8Array> {
    const key = this.getKey({ type: 'privateKey', id: didId });
    const encrypted = this.storage.get(key);
    
    if (!encrypted) {
      throw new Error('Private key not found');
    }

    return this.decryptData(encrypted);
  }

  async saveFaceData(didId: string, faceData: Uint8Array): Promise<void> {
    const key = this.getKey({ type: 'faceData', id: didId });
    this.storage.set(key, faceData); // Уже зашифровано
  }

  async getFaceData(didId: string): Promise<Uint8Array | null> {
    const key = this.getKey({ type: 'faceData', id: didId });
    return this.storage.get(key) || null;
  }

  async clear(): Promise<void> {
    this.storage.clear();
  }

  async export(): Promise<string> {
    const exportData: Record<string, string> = {};
    
    for (const [key, value] of this.storage.entries()) {
      exportData[key] = sodium.to_base64(value);
    }
    
    return JSON.stringify(exportData);
  }

  async import(data: string): Promise<void> {
    const importData = JSON.parse(data) as Record<string, string>;
    
    this.storage.clear();
    
    for (const [key, value] of Object.entries(importData)) {
      this.storage.set(key, sodium.from_base64(value));
    }
  }

  // Метод для безопасного удаления данных
  async secureDelete(didId: string): Promise<void> {
    const keys = [
      this.getKey({ type: 'did', id: didId }),
      this.getKey({ type: 'privateKey', id: didId }),
      this.getKey({ type: 'faceData', id: didId }),
    ];

    for (const key of keys) {
      const data = this.storage.get(key);
      if (data) {
        // Перезапись нулями перед удалением
        sodium.memzero(data);
        this.storage.delete(key);
      }
    }
  }
}
