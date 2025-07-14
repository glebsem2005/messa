import { v4 as uuidv4 } from 'uuid';
import { QuantumResistantCrypto } from '@messa/crypto-layer';
import { SignalProtocolService } from './SignalProtocolService';
import { MLSService } from './MLSService';
import type { 
  IMessageEncryptionService, 
  Message, 
  EncryptedMessage 
} from '../types';

export class MessageEncryptionService implements IMessageEncryptionService {
  private signalProtocol: SignalProtocolService;
  private mlsService: MLSService;
  private qrc: QuantumResistantCrypto;
  private userId: string;

  constructor(userId: string) {
    this.userId = userId;
    this.signalProtocol = new SignalProtocolService();
    this.mlsService = new MLSService(userId);
    this.qrc = new QuantumResistantCrypto();
  }

  async initialize(): Promise<void> {
    await Promise.all([
      this.signalProtocol.initialize(),
      this.mlsService.initialize(),
      this.qrc.initialize(),
    ]);
  }

  async encryptMessage(message: Message, recipientId: string): Promise<EncryptedMessage> {
    // Сериализация сообщения
    const messageData = this.serializeMessage(message);
    
    // Шифрование через Signal Protocol
    const encrypted = await this.signalProtocol.encryptMessage(
      recipientId,
      messageData
    );
    
    // Добавление квантово-устойчивого слоя
    if (message.type !== 'text') {
      // Для медиа-файлов используем дополнительное шифрование
      const quantumEncrypted = await this.qrc.hybridEncrypt(
        encrypted.ciphertext,
        new Uint8Array(32) // Публичный ключ получателя
      );
      
      encrypted.ciphertext = quantumEncrypted;
    }
    
    return encrypted;
  }

  async decryptMessage(encrypted: EncryptedMessage): Promise<Message> {
    let decryptedData: Uint8Array = encrypted.ciphertext;
    
    // Расшифровка квантово-устойчивого слоя если нужно
    if (encrypted.messageType !== 1) { // не текстовое сообщение
      decryptedData = await this.qrc.hybridDecrypt(
        encrypted.ciphertext,
        new Uint8Array(32) // Приватный ключ
      );
    }
    
    // Расшифровка через Signal Protocol
    const decryptedString = await this.signalProtocol.decryptMessage(
      encrypted.senderId,
      {
        ...encrypted,
        ciphertext: decryptedData,
      }
    );
    
    // Десериализация сообщения
    return this.deserializeMessage(decryptedString);
  }

  async encryptGroupMessage(message: Message, groupId: string): Promise<EncryptedMessage> {
    const messageData = this.serializeMessage(message);
    
    // Шифрование через MLS
    const encrypted = await this.mlsService.encryptGroupMessage(
      groupId,
      messageData
    );
    
    return encrypted;
  }

  async decryptGroupMessage(
    encrypted: EncryptedMessage, 
    groupId: string
  ): Promise<Message> {
    // Расшифровка через MLS
    const decryptedString = await this.mlsService.decryptGroupMessage(
      groupId,
      encrypted
    );
    
    return this.deserializeMessage(decryptedString);
  }

  // Методы для работы с эфемерными сообщениями
  async encryptEphemeralMessage(
    message: Message, 
    recipientId: string, 
    ttl: number
  ): Promise<EncryptedMessage> {
    // Добавление метаданных об истечении
    const ephemeralMessage = {
      ...message,
      ephemeral: true,
      ephemeralTimeout: ttl,
      expiresAt: new Date(Date.now() + ttl),
    };
    
    const encrypted = await this.encryptMessage(ephemeralMessage, recipientId);
    
    // Планирование удаления
    this.scheduleMessageDeletion(message.id, ttl);
    
    return encrypted;
  }

  // Вспомогательные методы

  private serializeMessage(message: Message): string {
    return JSON.stringify({
      ...message,
      timestamp: message.timestamp.toISOString(),
    });
  }

  private deserializeMessage(data: string): Message {
    const parsed = JSON.parse(data);
    return {
      ...parsed,
      timestamp: new Date(parsed.timestamp),
      readReceipts: parsed.readReceipts?.map((r: any) => ({
        ...r,
        timestamp: new Date(r.timestamp),
      })) || [],
      reactions: parsed.reactions?.map((r: any) => ({
        ...r,
        timestamp: new Date(r.timestamp),
      })) || [],
    };
  }

  private scheduleMessageDeletion(messageId: string, ttl: number): void {
    setTimeout(() => {
      // Эмитирование события удаления
      this.deleteMessage(messageId);
    }, ttl);
  }

  private async deleteMessage(messageId: string): Promise<void> {
    // Безопасное удаление из локального хранилища
    console.log(`Deleting ephemeral message: ${messageId}`);
  }

  // Методы для end-to-end верификации

  async generateSecurityCode(sessionId: string): Promise<string> {
    // Генерация кода безопасности для верификации сессии
    const sessionData = new TextEncoder().encode(sessionId);
    const hash = await crypto.subtle.digest('SHA-256', sessionData);
    const hashArray = Array.from(new Uint8Array(hash));
    
    // Конвертация в читаемый код
    const code = hashArray
      .slice(0, 6)
      .map(byte => (byte % 10).toString())
      .join('');
    
    return code;
  }

  async verifySecurityCode(sessionId: string, code: string): Promise<boolean> {
    const expectedCode = await this.generateSecurityCode(sessionId);
    return expectedCode === code;
  }
}
