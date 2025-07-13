import sodium from 'libsodium-wrappers';
import { v4 as uuidv4 } from 'uuid';
import { ed25519 } from '@noble/curves/ed25519';
import { QuantumResistantCrypto } from '@messa/crypto-layer';
import type { 
  ISignalProtocolService, 
  PreKeyBundle, 
  EncryptedMessage,
  Session,
  ChainKey 
} from '../types';

export class SignalProtocolService implements ISignalProtocolService {
  private identityKeyPair: { publicKey: Uint8Array; privateKey: Uint8Array } | null = null;
  private registrationId: number;
  private sessions: Map<string, Session> = new Map();
  private preKeys: Map<number, Uint8Array> = new Map();
  private signedPreKey: { keyId: number; keyPair: any; signature: Uint8Array } | null = null;
  private qrc: QuantumResistantCrypto;

  constructor() {
    this.registrationId = Math.floor(Math.random() * 16383) + 1;
    this.qrc = new QuantumResistantCrypto();
  }

  async initialize(): Promise<void> {
    await sodium.ready;
    await this.qrc.initialize();
    
    // Генерация identity key pair
    this.identityKeyPair = {
      publicKey: ed25519.utils.randomPrivateKey(),
      privateKey: ed25519.utils.randomPrivateKey(),
    };
    
    // Генерация pre-keys
    await this.generatePreKeys();
    await this.generateSignedPreKey();
  }

  async initializeSession(userId: string, preKeyBundle: PreKeyBundle): Promise<void> {
    if (!this.identityKeyPair) {
      await this.initialize();
    }

    // Создание эфемерного ключа
    const ephemeralKeyPair = {
      publicKey: ed25519.utils.randomPrivateKey(),
      privateKey: ed25519.utils.randomPrivateKey(),
    };

    // X3DH key agreement
    const dh1 = await this.calculateDH(this.identityKeyPair!.privateKey, preKeyBundle.signedPreKey);
    const dh2 = await this.calculateDH(ephemeralKeyPair.privateKey, preKeyBundle.identityKey);
    const dh3 = await this.calculateDH(ephemeralKeyPair.privateKey, preKeyBundle.signedPreKey);

    let dh4: Uint8Array | undefined;
    if (preKeyBundle.preKey) {
      dh4 = await this.calculateDH(ephemeralKeyPair.privateKey, preKeyBundle.preKey);
    }

    // Создание master secret
    const masterSecret = await this.deriveMasterSecret(dh1, dh2, dh3, dh4);
    
    // Инициализация root key и chain keys
    const rootKey = await this.deriveRootKey(masterSecret);
    const chainKey = await this.deriveChainKey(rootKey);

    // Создание сессии
    const session: Session = {
      sessionId: uuidv4(),
      remoteIdentityKey: preKeyBundle.identityKey,
      rootKey,
      sendingChain: {
        key: chainKey,
        index: 0,
        messageKeys: new Map(),
      },
      receivingChains: new Map(),
      previousCounter: 0,
      remoteRegistrationId: preKeyBundle.registrationId,
    };

    this.sessions.set(userId, session);
  }

  async encryptMessage(recipientId: string, message: string): Promise<EncryptedMessage> {
    const session = this.sessions.get(recipientId);
    if (!session) {
      throw new Error('No session found for recipient');
    }

    // Получение или создание message key
    const messageKey = await this.deriveMessageKey(session.sendingChain.key);
    
    // Шифрование сообщения
    const nonce = sodium.randombytes_buf(sodium.crypto_secretbox_NONCEBYTES);
    const messageBytes = new TextEncoder().encode(message);
    const ciphertext = sodium.crypto_secretbox_easy(messageBytes, nonce, messageKey);

    // Объединение nonce и ciphertext
    const encryptedData = new Uint8Array(nonce.length + ciphertext.length);
    encryptedData.set(nonce);
    encryptedData.set(ciphertext, nonce.length);

    // Обновление chain key
    session.sendingChain.key = await this.advanceChainKey(session.sendingChain.key);
    session.sendingChain.index++;

    // Сохранение message key для возможной повторной отправки
    session.sendingChain.messageKeys.set(session.sendingChain.index - 1, messageKey);

    return {
      id: uuidv4(),
      conversationId: recipientId,
      senderId: 'self',
      ciphertext: encryptedData,
      timestamp: new Date(),
      messageType: 1, // Text message
    };
  }

  async decryptMessage(senderId: string, encrypted: EncryptedMessage): Promise<string> {
    const session = this.sessions.get(senderId);
    if (!session) {
      throw new Error('No session found for sender');
    }

    // Извлечение nonce и ciphertext
    const nonceLength = sodium.crypto_secretbox_NONCEBYTES;
    const nonce = encrypted.ciphertext.slice(0, nonceLength);
    const ciphertext = encrypted.ciphertext.slice(nonceLength);

    // Поиск подходящего receiving chain
    let messageKey: Uint8Array | undefined;
    
    // Попытка найти message key в существующих chains
    for (const [chainId, chain] of session.receivingChains) {
      if (chain.messageKeys.has(encrypted.messageType)) {
        messageKey = chain.messageKeys.get(encrypted.messageType);
        break;
      }
    }

    if (!messageKey) {
      // Если не найден, возможно нужно создать новый receiving chain
      // Это упрощенная версия, в реальной реализации здесь происходит ratchet
      const newChain = await this.createReceivingChain(session, encrypted.ephemeralPublicKey!);
      messageKey = await this.deriveMessageKey(newChain.key);
    }

    // Расшифровка сообщения
    const decrypted = sodium.crypto_secretbox_open_easy(ciphertext, nonce, messageKey);
    return new TextDecoder().decode(decrypted);
  }

  async generatePreKeyBundle(): Promise<PreKeyBundle> {
    if (!this.identityKeyPair || !this.signedPreKey) {
      await this.initialize();
    }

    // Выбор случайного one-time pre-key
    const preKeyIds = Array.from(this.preKeys.keys());
    const randomPreKeyId = preKeyIds[Math.floor(Math.random() * preKeyIds.length)];
    const preKey = this.preKeys.get(randomPreKeyId);

    return {
      registrationId: this.registrationId,
      deviceId: 1,
      preKeyId: randomPreKeyId,
      preKey: preKey!,
      signedPreKeyId: this.signedPreKey!.keyId,
      signedPreKey: this.signedPreKey!.keyPair.publicKey,
      signedPreKeySignature: this.signedPreKey!.signature,
      identityKey: this.identityKeyPair!.publicKey,
    };
  }

  async rotateSignedPreKey(): Promise<void> {
    await this.generateSignedPreKey();
    
    // Очистка старых pre-keys
    if (this.preKeys.size > 100) {
      const keysToDelete = Array.from(this.preKeys.keys()).slice(0, 50);
      keysToDelete.forEach(keyId => this.preKeys.delete(keyId));
    }
  }

  private async generatePreKeys(): Promise<void> {
    // Генерация 100 one-time pre-keys
    for (let i = 1; i <= 100; i++) {
      const keyPair = {
        publicKey: ed25519.utils.randomPrivateKey(),
        privateKey: ed25519.utils.randomPrivateKey(),
      };
      this.preKeys.set(i, keyPair.publicKey);
    }
  }

  private async generateSignedPreKey(): Promise<void> {
    const keyPair = {
      publicKey: ed25519.utils.randomPrivateKey(),
      privateKey: ed25519.utils.randomPrivateKey(),
    };

    // Подпись публичного ключа identity key
    const signature = ed25519.sign(keyPair.publicKey, this.identityKeyPair!.privateKey);

    this.signedPreKey = {
      keyId: Date.now() % 0xFFFFFF,
      keyPair,
      signature,
    };
  }

  private async calculateDH(privateKey: Uint8Array, publicKey: Uint8Array): Promise<Uint8Array> {
    // ECDH на curve25519
    const shared = ed25519.getSharedSecret(privateKey, publicKey);
    return new Uint8Array(shared);
  }

  private async deriveMasterSecret(
    dh1: Uint8Array,
    dh2: Uint8Array,
    dh3: Uint8Array,
    dh4?: Uint8Array
  ): Promise<Uint8Array> {
    // Конкатенация DH результатов
    const dhConcat = new Uint8Array(
      dh1.length + dh2.length + dh3.length + (dh4?.length || 0)
    );
    
    let offset = 0;
    dhConcat.set(dh1, offset);
    offset += dh1.length;
    dhConcat.set(dh2, offset);
    offset += dh2.length;
    dhConcat.set(dh3, offset);
    offset += dh3.length;
    
    if (dh4) {
      dhConcat.set(dh4, offset);
    }

    // HKDF для вывода master secret
    const salt = new TextEncoder().encode('Signal_MessageKeys_MasterSecret');
    return sodium.crypto_kdf_derive_from_key(32, 1, 'MASTER', 
      sodium.crypto_generichash(32, dhConcat, salt)
    );
  }

  private async deriveRootKey(masterSecret: Uint8Array): Promise<Uint8Array> {
    return sodium.crypto_kdf_derive_from_key(32, 1, 'ROOT_KEY', masterSecret);
  }

  private async deriveChainKey(rootKey: Uint8Array): Promise<Uint8Array> {
    return sodium.crypto_kdf_derive_from_key(32, 1, 'CHAIN_KY', rootKey);
  }

  private async deriveMessageKey(chainKey: Uint8Array): Promise<Uint8Array> {
    return sodium.crypto_kdf_derive_from_key(32, 1, 'MSG_KEY', chainKey);
  }

  private async advanceChainKey(chainKey: Uint8Array): Promise<Uint8Array> {
    const input = new TextEncoder().encode('advance');
    return sodium.crypto_auth(input, chainKey);
  }

  private async createReceivingChain(
    session: Session,
    theirEphemeralPublicKey: Uint8Array
  ): Promise<ChainKey> {
    // Double Ratchet: создание нового receiving chain
    const ourEphemeralKeyPair = {
      publicKey: ed25519.utils.randomPrivateKey(),
      privateKey: ed25519.utils.randomPrivateKey(),
    };

    const sharedSecret = await this.calculateDH(
      ourEphemeralKeyPair.privateKey,
      theirEphemeralPublicKey
    );

    const newRootKey = await this.deriveRootKey(sharedSecret);
    const newChainKey = await this.deriveChainKey(newRootKey);

    const chain: ChainKey = {
      key: newChainKey,
      index: 0,
      messageKeys: new Map(),
    };

    session.receivingChains.set(sodium.to_hex(theirEphemeralPublicKey), chain);
    session.rootKey = newRootKey;

    return chain;
  }
}
