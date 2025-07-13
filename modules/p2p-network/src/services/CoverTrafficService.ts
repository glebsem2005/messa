import { v4 as uuidv4 } from 'uuid';
import type { ICoverTrafficService, CoverTrafficPacket } from '../types';

export class CoverTrafficService implements ICoverTrafficService {
  private intervalId: NodeJS.Timeout | null = null;
  private packetHistory: Map<string, Date> = new Map();
  private onCoverTrafficGenerated: ((packet: CoverTrafficPacket) => void) | null = null;

  start(interval: number): void {
    if (this.intervalId) {
      this.stop();
    }

    this.intervalId = setInterval(() => {
      const packet = this.generateCoverTraffic();
      if (this.onCoverTrafficGenerated) {
        this.onCoverTrafficGenerated(packet);
      }
    }, interval);

    // Очистка истории пакетов каждые 5 минут
    setInterval(() => this.cleanupHistory(), 5 * 60 * 1000);
  }

  stop(): void {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
  }

  wrapMessage(data: Uint8Array): CoverTrafficPacket {
    return {
      id: uuidv4(),
      type: 'real',
      payload: this.padData(data),
      timestamp: new Date(),
      ttl: 5,
    };
  }

  unwrapPacket(packet: CoverTrafficPacket): Uint8Array | null {
    // Проверка дубликатов
    if (this.packetHistory.has(packet.id)) {
      return null;
    }

    this.packetHistory.set(packet.id, new Date());

    // Проверка TTL
    if (packet.ttl <= 0) {
      return null;
    }

    // Возврат только реальных сообщений
    if (packet.type === 'real') {
      return this.unpadData(packet.payload);
    }

    return null;
  }

  generateCoverTraffic(): CoverTrafficPacket {
    // Генерация случайного размера от 100 до 1500 байт
    const size = Math.floor(Math.random() * 1400) + 100;
    const payload = new Uint8Array(size);
    crypto.getRandomValues(payload);

    return {
      id: uuidv4(),
      type: 'cover',
      payload,
      timestamp: new Date(),
      ttl: Math.floor(Math.random() * 5) + 1,
    };
  }

  onGenerated(callback: (packet: CoverTrafficPacket) => void): void {
    this.onCoverTrafficGenerated = callback;
  }

  // Добавление padding для унификации размера
  private padData(data: Uint8Array): Uint8Array {
    const blockSize = 256;
    const paddedSize = Math.ceil(data.length / blockSize) * blockSize;
    
    if (paddedSize === data.length) {
      // Добавляем еще один блок
      const padded = new Uint8Array(paddedSize + blockSize);
      padded.set(data);
      
      // Записываем размер оригинальных данных в последние 4 байта
      const view = new DataView(padded.buffer);
      view.setUint32(padded.length - 4, data.length, false);
      
      return padded;
    }

    const padded = new Uint8Array(paddedSize);
    padded.set(data);
    
    // Записываем размер оригинальных данных
    const view = new DataView(padded.buffer);
    view.setUint32(paddedSize - 4, data.length, false);
    
    return padded;
  }

  private unpadData(padded: Uint8Array): Uint8Array {
    if (padded.length < 4) {
      return padded;
    }

    // Читаем размер оригинальных данных
    const view = new DataView(padded.buffer, padded.byteOffset);
    const originalSize = view.getUint32(padded.length - 4, false);
    
    if (originalSize > padded.length - 4) {
      return padded;
    }

    return padded.slice(0, originalSize);
  }

  private cleanupHistory(): void {
    const now = Date.now();
    const maxAge = 5 * 60 * 1000; // 5 минут

    for (const [id, timestamp] of this.packetHistory) {
      if (now - timestamp.getTime() > maxAge) {
        this.packetHistory.delete(id);
      }
    }
  }

  // Статистика cover traffic
  getStats(): {
    totalPackets: number;
    coverPackets: number;
    realPackets: number;
    averageSize: number;
  } {
    // В реальной реализации собирается статистика
    return {
      totalPackets: 0,
      coverPackets: 0,
      realPackets: 0,
      averageSize: 0,
    };
  }

  // Адаптивная генерация cover traffic
  adaptiveGeneration(networkLoad: number): void {
    // Изменение частоты генерации в зависимости от нагрузки
    const baseInterval = 30000; // 30 секунд
    const adaptedInterval = baseInterval * (1 + networkLoad);
    
    this.stop();
    this.start(adaptedInterval);
  }

  // Mixing для дополнительной анонимности
  mixPackets(packets: CoverTrafficPacket[]): CoverTrafficPacket[] {
    // Перемешивание пакетов
    const mixed = [...packets];
    
    for (let i = mixed.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [mixed[i], mixed[j]] = [mixed[j], mixed[i]];
    }

    // Добавление случайной задержки
    return mixed.map(packet => ({
      ...packet,
      timestamp: new Date(packet.timestamp.getTime() + Math.random() * 1000),
    }));
  }
}
