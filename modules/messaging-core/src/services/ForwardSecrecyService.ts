import sodium from 'libsodium-wrappers';
import { QuantumResistantCrypto } from '@messa/crypto-layer';
import type { IForwardSecrecyService, Session, ChainKey } from '../types';

export class ForwardSecrecyService implements IForwardSecrecyService {
  private sessions: Map<string, Session> = new Map();
  private qrc: QuantumResistantCrypto;
  private rotationInterval: number = 100; // Ротация после 100 сообщений

  constructor() {
    this.qrc = new QuantumResistantCrypto();
  }

  async initialize(): Promise<void> {
    await sodium.ready;
    await this.qrc.initialize();
  }

  async rotateKeys(sessionId: string): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new Error('Session not found');
    }

    // Double Ratchet: ротация ключей
    const newRootKey = await this.performRatchetStep(session.rootKey);
    
    // Создание новых chain keys
    const newSendingChain = await this.deriveNewChainKey(newRootKey, 'sending');
    const newReceivingChain = await this.deriveNewChainKey(newRootKey, 'receiving');

    // Обновление сессии
    session.rootKey = newRootKey;
    session.sendingChain = {
      key: newSendingChain,
      index: 0,
      messageKeys: new Map(),
    };
    
    // Сохранение старых receiving chains для обработки out-of-order сообщений
    const chainId = sodium.to_hex(session.sendingChain.key);
    session.receivingChains.set(chainId, session.sendingChain);

    // Очистка старых ключей
    this.cleanupOldKeys(session);
  }

  async deleteOldMessageKeys(sessionId: string, beforeIndex: number): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (!session) return;

    // Удаление ключей сообщений до указанного индекса
    for (const [index, key] of session.sendingChain.messageKeys) {
      if (index < beforeIndex) {
        sodium.memzero(key);
        session.sendingChain.messageKeys.delete(index);
      }
    }

    // Удаление из receiving chains
    for (const chain of session.receivingChains.values()) {
      for (const [index, key] of chain.messageKeys) {
        if (index < beforeIndex) {
          sodium.memzero(key);
          chain.messageKeys.delete(index);
        }
      }
    }
  }

  async establishRatchet(sessionId: string, theirPublicKey: Uint8Array): Promise<void> {
    // Инициализация Double Ratchet с публичным ключом собеседника
    const ourKeyPair = await this.generateKeyPair();
    
    // Diffie-Hellman для создания общего секрета
    const sharedSecret = await this.performDH(ourKeyPair.privateKey, theirPublicKey);
    
    // Создание root key
    const rootKey = await this.kdf(sharedSecret, 'ROOT_KEY');
    
    // Создание начальных chain keys
    const sendingChain = await this.deriveNewChainKey(rootKey, 'sending');
    const receivingChain = await this.deriveNewChainKey(rootKey, 'receiving');

    // Создание новой сессии
    const session: Session = {
      sessionId,
      remoteIdentityKey: theirPublicKey,
      rootKey,
      sendingChain: {
        key: sendingChain,
        index: 0,
        messageKeys: new Map(),
      },
      receivingChains: new Map(),
      previousCounter: 0,
      remoteRegistrationId: 0,
    };

    this.sessions.set(sessionId, session);
  }

  // Методы для работы с квантово-устойчивой прямой секретностью

  async performQuantumRatchet(sessionId: string): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (!session) return;

    // Использование квантово-устойчивых алгоритмов для ротации
    const newSecret = await this.qrc.rotateKeys(session.rootKey, session.sendingChain.index);
    session.rootKey = newSecret;

    // Автоматическая ротация после определенного количества сообщений
    if (session.sendingChain.index % this.rotationInterval === 0) {
      await this.rotateKeys(sessionId);
    }
  }

  // Вспомогательные методы

  private async performRatchetStep(currentRootKey: Uint8Array): Promise<Uint8Array> {
    // Ratchet step: создание нового root key
    const input = new TextEncoder().encode('RATCHET_STEP');
    const newRootKey = await this.hmac(currentRootKey, input);
    
    // Очистка старого ключа
    sodium.memzero(currentRootKey);
    
    return newRootKey;
  }

  private async deriveNewChainKey(rootKey: Uint8Array, type: 'sending' | 'receiving'): Promise<Uint8Array> {
    const info = new TextEncoder().encode(`CHAIN_KEY_${type.toUpperCase()}`);
    return this.kdf(rootKey, info);
  }

  private async generateKeyPair(): Promise<{ publicKey: Uint8Array; privateKey: Uint8Array }> {
    const keyPair = sodium.crypto_box_keypair();
    return {
      publicKey: keyPair.publicKey,
      privateKey: keyPair.privateKey,
    };
  }

  private async performDH(privateKey: Uint8Array, publicKey: Uint8Array): Promise<Uint8Array> {
    return sodium.crypto_scalarmult(privateKey, publicKey);
  }

  private async kdf(inputKey: Uint8Array, info: Uint8Array | string): Promise<Uint8Array> {
    const infoBytes = typeof info === 'string' ? new TextEncoder().encode(info) : info;
    return sodium.crypto_kdf_derive_from_key(
      32,
      1,
      'MESSAFS',
      inputKey
    );
  }

  private async hmac(key: Uint8Array, data: Uint8Array): Promise<Uint8Array> {
    return sodium.crypto_auth(data, key);
  }

  private cleanupOldKeys(session: Session): void {
    // Удаление старых receiving chains (держим максимум 5)
    if (session.receivingChains.size > 5) {
      const chains = Array.from(session.receivingChains.entries());
      chains.sort((a, b) => a[1].index - b[1].index);
      
      // Удаляем самые старые
      const toDelete = chains.slice(0, chains.length - 5);
      for (const [chainId, chain] of toDelete) {
        // Безопасное удаление ключей
        sodium.memzero(chain.key);
        for (const key of chain.messageKeys.values()) {
          sodium.memzero(key);
        }
        session.receivingChains.delete(chainId);
      }
    }
  }

  // Методы для проверки состояния прямой секретности

  async getSecrecyState(sessionId: string): Promise<{
    messagesUntilRotation: number;
    chainLength: number;
    oldKeysCount: number;
  }> {
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new Error('Session not found');
    }

    const messagesUntilRotation = this.rotationInterval - (session.sendingChain.index % this.rotationInterval);
    const chainLength = session.sendingChain.index;
    let oldKeysCount = session.sendingChain.messageKeys.size;
    
    for (const chain of session.receivingChains.values()) {
      oldKeysCount += chain.messageKeys.size;
    }

    return {
      messagesUntilRotation,
      chainLength,
      oldKeysCount,
    };
  }

  async forceKeyRotation(sessionId: string): Promise<void> {
    // Принудительная ротация ключей
    await this.rotateKeys(sessionId);
    
    // Удаление всех старых ключей сообщений
    const session = this.sessions.get(sessionId);
    if (session) {
      await this.deleteOldMessageKeys(sessionId, session.sendingChain.index);
    }
  }
}
