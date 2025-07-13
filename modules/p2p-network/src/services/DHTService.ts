import type { Libp2p } from 'libp2p';
import { sha256 } from '@noble/hashes/sha256';
import { fromString, toString } from 'uint8arrays';
import type { IDHTService, DHTRecord, PeerInfo } from '../types';

export class DHTService implements IDHTService {
  private node: Libp2p | null = null;
  private cache: Map<string, DHTRecord> = new Map();
  private providers: Map<string, Set<string>> = new Map();

  initialize(node: Libp2p): void {
    this.node = node;
    
    // Периодическая очистка кеша
    setInterval(() => this.cleanupCache(), 60000);
  }

  async put(key: string, value: Uint8Array): Promise<void> {
    if (!this.node) {
      throw new Error('DHT not initialized');
    }

    const keyHash = this.hashKey(key);
    
    // Создание записи
    const record: DHTRecord = {
      key,
      value,
      timestamp: new Date(),
      signature: await this.signRecord(key, value),
      author: this.node.peerId.toString(),
    };

    // Сохранение в локальный кеш
    this.cache.set(key, record);

    // Публикация в DHT
    try {
      await this.node.services.dht.put(keyHash, value);
    } catch (error) {
      console.error('Failed to put in DHT:', error);
      throw error;
    }
  }

  async get(key: string): Promise<DHTRecord | null> {
    if (!this.node) {
      throw new Error('DHT not initialized');
    }

    // Проверка локального кеша
    const cached = this.cache.get(key);
    if (cached && this.isRecordValid(cached)) {
      return cached;
    }

    const keyHash = this.hashKey(key);

    try {
      // Поиск в DHT
      const result = await this.node.services.dht.get(keyHash);
      
      if (result) {
        const record: DHTRecord = {
          key,
          value: result,
          timestamp: new Date(),
          signature: new Uint8Array(),
          author: '',
        };

        // Кеширование результата
        this.cache.set(key, record);
        return record;
      }
    } catch (error) {
      console.error('Failed to get from DHT:', error);
    }

    return null;
  }

  async findPeer(peerId: string): Promise<PeerInfo | null> {
    if (!this.node) {
      throw new Error('DHT not initialized');
    }

    try {
      // Поиск peer info в DHT
      const peerInfo = await this.node.peerRouting.findPeer(peerId);
      
      if (peerInfo) {
        return {
          id: peerInfo.id.toString(),
          addresses: peerInfo.multiaddrs.map(addr => addr.toString()),
          protocols: [],
          metadata: new Map(),
          lastSeen: new Date(),
        };
      }
    } catch (error) {
      console.error('Failed to find peer:', error);
    }

    return null;
  }

  async provide(key: string): Promise<void> {
    if (!this.node) {
      throw new Error('DHT not initialized');
    }

    const keyHash = this.hashKey(key);

    try {
      // Объявление себя провайдером контента
      await this.node.contentRouting.provide(keyHash);
      
      // Сохранение в локальный список
      if (!this.providers.has(key)) {
        this.providers.set(key, new Set());
      }
      this.providers.get(key)!.add(this.node.peerId.toString());
    } catch (error) {
      console.error('Failed to provide:', error);
      throw error;
    }
  }

  async findProviders(key: string): Promise<PeerInfo[]> {
    if (!this.node) {
      throw new Error('DHT not initialized');
    }

    const keyHash = this.hashKey(key);
    const providers: PeerInfo[] = [];

    try {
      // Поиск провайдеров в DHT
      for await (const provider of this.node.contentRouting.findProviders(keyHash)) {
        providers.push({
          id: provider.id.toString(),
          addresses: provider.multiaddrs.map(addr => addr.toString()),
          protocols: [],
          metadata: new Map(),
          lastSeen: new Date(),
        });

        // Ограничение количества результатов
        if (providers.length >= 20) break;
      }
    } catch (error) {
      console.error('Failed to find providers:', error);
    }

    return providers;
  }

  // Дополнительные методы

  async putSigned(key: string, value: Uint8Array, ttl: number = 3600000): Promise<void> {
    if (!this.node) {
      throw new Error('DHT not initialized');
    }

    // Добавление временной метки и TTL
    const metadata = {
      timestamp: Date.now(),
      ttl,
      author: this.node.peerId.toString(),
    };

    const fullValue = new Uint8Array(value.length + 256);
    fullValue.set(value);
    fullValue.set(new TextEncoder().encode(JSON.stringify(metadata)), value.length);

    await this.put(key, fullValue);
  }

  async getSigned(key: string): Promise<{ value: Uint8Array; metadata: any } | null> {
    const record = await this.get(key);
    if (!record) return null;

    try {
      // Извлечение метаданных
      const metadataStart = record.value.findIndex((_, i) => {
        try {
          const slice = record.value.slice(i);
          const text = new TextDecoder().decode(slice);
          JSON.parse(text);
          return true;
        } catch {
          return false;
        }
      });

      if (metadataStart === -1) {
        return { value: record.value, metadata: {} };
      }

      const value = record.value.slice(0, metadataStart);
      const metadataText = new TextDecoder().decode(record.value.slice(metadataStart));
      const metadata = JSON.parse(metadataText);

      // Проверка TTL
      if (metadata.ttl && Date.now() - metadata.timestamp > metadata.ttl) {
        this.cache.delete(key);
        return null;
      }

      return { value, metadata };
    } catch (error) {
      console.error('Failed to parse signed record:', error);
      return { value: record.value, metadata: {} };
    }
  }

  // Репликация данных
  async replicate(key: string, replicationFactor: number = 3): Promise<void> {
    if (!this.node) return;

    const value = this.cache.get(key);
    if (!value) return;

    // Поиск ближайших узлов
    const closestPeers = await this.findClosestPeers(key, replicationFactor);
    
    // Отправка данных для репликации
    for (const peer of closestPeers) {
      try {
        await this.sendReplicationRequest(peer.id, key, value.value);
      } catch (error) {
        console.error(`Failed to replicate to ${peer.id}:`, error);
      }
    }
  }

  private hashKey(key: string): Uint8Array {
    return sha256(new TextEncoder().encode(key));
  }

  private async signRecord(key: string, value: Uint8Array): Promise<Uint8Array> {
    // В реальной реализации используется приватный ключ узла
    const data = new Uint8Array(key.length + value.length);
    data.set(new TextEncoder().encode(key));
    data.set(value, key.length);
    
    return sha256(data);
  }

  private isRecordValid(record: DHTRecord): boolean {
    // Проверка срока действия записи (24 часа)
    const age = Date.now() - record.timestamp.getTime();
    return age < 24 * 60 * 60 * 1000;
  }

  private cleanupCache(): void {
    // Удаление устаревших записей
    for (const [key, record] of this.cache) {
      if (!this.isRecordValid(record)) {
        this.cache.delete(key);
      }
    }
  }

  private async findClosestPeers(key: string, count: number): Promise<PeerInfo[]> {
    if (!this.node) return [];

    const keyHash = this.hashKey(key);
    const peers: PeerInfo[] = [];

    try {
      // Использование Kademlia для поиска ближайших узлов
      const closestPeers = await this.node.peerRouting.getClosestPeers(keyHash);
      
      for await (const peer of closestPeers) {
        peers.push({
          id: peer.id.toString(),
          addresses: peer.multiaddrs.map(addr => addr.toString()),
          protocols: [],
          metadata: new Map(),
          lastSeen: new Date(),
        });

        if (peers.length >= count) break;
      }
    } catch (error) {
      console.error('Failed to find closest peers:', error);
    }

    return peers;
  }

  private async sendReplicationRequest(
    peerId: string,
    key: string,
    value: Uint8Array
  ): Promise<void> {
    // В реальной реализации отправка через протокол репликации
    console.log(`Replicating ${key} to ${peerId}`);
  }
}
