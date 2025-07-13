import { Kyber768 } from 'kyber-crystals';
import sodium from 'libsodium-wrappers';
import type { IKyberService, KyberKeyPair } from '../types';

export class KyberService implements IKyberService {
  private kyber: typeof Kyber768;

  constructor() {
    this.kyber = Kyber768;
  }

  async initialize(): Promise<void> {
    await sodium.ready;
  }

  async generateKeyPair(): Promise<KyberKeyPair> {
    await this.initialize();
    
    const keyPair = this.kyber.keypair();
    
    return {
      publicKey: new Uint8Array(keyPair.publicKey),
      privateKey: new Uint8Array(keyPair.privateKey),
    };
  }

  async encapsulate(publicKey: Uint8Array): Promise<{ 
    sharedSecret: Uint8Array; 
    ciphertext: Uint8Array;
  }> {
    const result = this.kyber.encapsulate(publicKey);
    
    return {
      sharedSecret: new Uint8Array(result.sharedSecret),
      ciphertext: new Uint8Array(result.ciphertext),
    };
  }

  async decapsulate(ciphertext: Uint8Array, privateKey: Uint8Array): Promise<Uint8Array> {
    const sharedSecret = this.kyber.decapsulate(ciphertext, privateKey);
    return new Uint8Array(sharedSecret);
  }

  // Гибридное шифрование с Kyber + AES
  async hybridEncrypt(
    data: Uint8Array, 
    recipientPublicKey: Uint8Array
  ): Promise<{ ciphertext: Uint8Array; encapsulatedKey: Uint8Array }> {
    // Генерация общего секрета через Kyber
    const { sharedSecret, ciphertext: encapsulatedKey } = await this.encapsulate(recipientPublicKey);
    
    // Использование общего секрета как ключа для AES
    const nonce = sodium.randombytes_buf(sodium.crypto_secretbox_NONCEBYTES);
    const encrypted = sodium.crypto_secretbox_easy(data, nonce, sharedSecret);
    
    // Объединение nonce и зашифрованных данных
    const ciphertext = new Uint8Array(nonce.length + encrypted.length);
    ciphertext.set(nonce);
    ciphertext.set(encrypted, nonce.length);
    
    return { ciphertext, encapsulatedKey };
  }

  async hybridDecrypt(
    ciphertext: Uint8Array,
    encapsulatedKey: Uint8Array,
    privateKey: Uint8Array
  ): Promise<Uint8Array> {
    // Восстановление общего секрета
    const sharedSecret = await this.decapsulate(encapsulatedKey, privateKey);
    
    // Извлечение nonce и зашифрованных данных
    const nonceLength = sodium.crypto_secretbox_NONCEBYTES;
    const nonce = ciphertext.slice(0, nonceLength);
    const encrypted = ciphertext.slice(nonceLength);
    
    // Расшифровка с использованием общего секрета
    return sodium.crypto_secretbox_open_easy(encrypted, nonce, sharedSecret);
  }

  // Метод для безопасного обмена ключами с прямой секретностью
  async generateEphemeralKeyExchange(
    staticPublicKey: Uint8Array
  ): Promise<{
    ephemeralKeyPair: KyberKeyPair;
    sharedSecret: Uint8Array;
    encapsulatedKey: Uint8Array;
  }> {
    // Генерация эфемерной пары ключей
    const ephemeralKeyPair = await this.generateKeyPair();
    
    // Создание общего секрета с использованием статического публичного ключа
    const { sharedSecret, ciphertext: encapsulatedKey } = await this.encapsulate(staticPublicKey);
    
    return {
      ephemeralKeyPair,
      sharedSecret,
      encapsulatedKey,
    };
  }

  // Безопасное удаление ключевого материала
  secureDelete(keyMaterial: Uint8Array): void {
    sodium.memzero(keyMaterial);
  }
}
