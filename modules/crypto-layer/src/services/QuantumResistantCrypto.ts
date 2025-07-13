import sodium from 'libsodium-wrappers';
import { KyberService } from './KyberService';
import { DilithiumService } from './DilithiumService';
import type { 
  IQuantumResistantCrypto, 
  KyberKeyPair, 
  DilithiumKeyPair 
} from '../types';

export class QuantumResistantCrypto implements IQuantumResistantCrypto {
  private kyber: KyberService;
  private dilithium: DilithiumService;

  constructor() {
    this.kyber = new KyberService();
    this.dilithium = new DilithiumService();
  }

  async initialize(): Promise<void> {
    await sodium.ready;
    await this.kyber.initialize();
    await this.dilithium.initialize();
  }

  async generateQuantumSafeKeyPair(): Promise<{ 
    encryption: KyberKeyPair; 
    signing: DilithiumKeyPair;
  }> {
    await this.initialize();
    
    const [encryption, signing] = await Promise.all([
      this.kyber.generateKeyPair(),
      this.dilithium.generateKeyPair(),
    ]);
    
    return { encryption, signing };
  }

  async hybridEncrypt(data: Uint8Array, recipientPublicKey: Uint8Array): Promise<Uint8Array> {
    // Гибридное шифрование: Kyber + ChaCha20-Poly1305
    
    // 1. Генерация общего секрета через Kyber
    const { sharedSecret, ciphertext: encapsulatedKey } = await this.kyber.encapsulate(recipientPublicKey);
    
    // 2. Использование KDF для получения ключей
    const kdfOutput = sodium.crypto_kdf_derive_from_key(
      64, // 32 байта для ключа + 32 байта для дополнительной энтропии
      1,
      'MESSAENC',
      sharedSecret
    );
    
    const encryptionKey = kdfOutput.slice(0, 32);
    const additionalData = kdfOutput.slice(32);
    
    // 3. Шифрование данных с AEAD
    const nonce = sodium.randombytes_buf(sodium.crypto_aead_chacha20poly1305_ietf_NPUBBYTES);
    const encrypted = sodium.crypto_aead_chacha20poly1305_ietf_encrypt(
      data,
      additionalData,
      null,
      nonce,
      encryptionKey
    );
    
    // 4. Сборка финального пакета
    // [encapsulatedKey.length (4 bytes)][encapsulatedKey][nonce][encrypted]
    const result = new Uint8Array(4 + encapsulatedKey.length + nonce.length + encrypted.length);
    const view = new DataView(result.buffer);
    
    let offset = 0;
    view.setUint32(offset, encapsulatedKey.length, false);
    offset += 4;
    
    result.set(encapsulatedKey, offset);
    offset += encapsulatedKey.length;
    
    result.set(nonce, offset);
    offset += nonce.length;
    
    result.set(encrypted, offset);
    
    // Очистка чувствительных данных
    sodium.memzero(sharedSecret);
    sodium.memzero(encryptionKey);
    
    return result;
  }

  async hybridDecrypt(encryptedData: Uint8Array, privateKey: Uint8Array): Promise<Uint8Array> {
    // Распаковка компонентов
    const view = new DataView(encryptedData.buffer, encryptedData.byteOffset);
    let offset = 0;
    
    const encapsulatedKeyLength = view.getUint32(offset, false);
    offset += 4;
    
    const encapsulatedKey = encryptedData.slice(offset, offset + encapsulatedKeyLength);
    offset += encapsulatedKeyLength;
    
    const nonceLength = sodium.crypto_aead_chacha20poly1305_ietf_NPUBBYTES;
    const nonce = encryptedData.slice(offset, offset + nonceLength);
    offset += nonceLength;
    
    const encrypted = encryptedData.slice(offset);
    
    // 1. Восстановление общего секрета
    const sharedSecret = await this.kyber.decapsulate(encapsulatedKey, privateKey);
    
    // 2. Вывод ключей через KDF
    const kdfOutput = sodium.crypto_kdf_derive_from_key(
      64,
      1,
      'MESSAENC',
      sharedSecret
    );
    
    const encryptionKey = kdfOutput.slice(0, 32);
    const additionalData = kdfOutput.slice(32);
    
    // 3. Расшифровка данных
    const decrypted = sodium.crypto_aead_chacha20poly1305_ietf_decrypt(
      null,
      encrypted,
      additionalData,
      nonce,
      encryptionKey
    );
    
    // Очистка чувствительных данных
    sodium.memzero(sharedSecret);
    sodium.memzero(encryptionKey);
    
    return decrypted;
  }

  async quantumSafeSign(data: Uint8Array, privateKey: Uint8Array): Promise<Uint8Array> {
    // Добавление временной метки и nonce для защиты от replay-атак
    const timestamp = new Uint8Array(8);
    const timestampView = new DataView(timestamp.buffer);
    timestampView.setBigUint64(0, BigInt(Date.now()), false);
    
    const nonce = sodium.randombytes_buf(32);
    
    // Создание сообщения для подписи
    const messageToSign = new Uint8Array(data.length + timestamp.length + nonce.length);
    messageToSign.set(data);
    messageToSign.set(timestamp, data.length);
    messageToSign.set(nonce, data.length + timestamp.length);
    
    // Подпись с Dilithium
    const signature = await this.dilithium.sign(messageToSign, privateKey);
    
    // Сборка финального пакета
    // [signature][timestamp][nonce]
    const result = new Uint8Array(signature.length + timestamp.length + nonce.length);
    result.set(signature);
    result.set(timestamp, signature.length);
    result.set(nonce, signature.length + timestamp.length);
    
    return result;
  }

  async quantumSafeVerify(
    data: Uint8Array, 
    signaturePacket: Uint8Array, 
    publicKey: Uint8Array
  ): Promise<boolean> {
    try {
      // Минимальный размер: signature + timestamp + nonce
      if (signaturePacket.length < 2420 + 8 + 32) { // Dilithium3 signature size
        return false;
      }
      
      // Распаковка компонентов
      const signatureLength = 2420; // Размер подписи Dilithium3
      const signature = signaturePacket.slice(0, signatureLength);
      const timestamp = signaturePacket.slice(signatureLength, signatureLength + 8);
      const nonce = signaturePacket.slice(signatureLength + 8);
      
      // Проверка временной метки (максимум 5 минут)
      const timestampView = new DataView(timestamp.buffer, timestamp.byteOffset);
      const signatureTime = Number(timestampView.getBigUint64(0, false));
      const currentTime = Date.now();
      
      if (Math.abs(currentTime - signatureTime) > 5 * 60 * 1000) {
        return false;
      }
      
      // Восстановление подписанного сообщения
      const messageToVerify = new Uint8Array(data.length + timestamp.length + nonce.length);
      messageToVerify.set(data);
      messageToVerify.set(timestamp, data.length);
      messageToVerify.set(nonce, data.length + timestamp.length);
      
      // Верификация подписи
      return await this.dilithium.verify(messageToVerify, signature, publicKey);
    } catch {
      return false;
    }
  }

  // Метод для установления квантово-безопасного канала
  async establishQuantumSafeChannel(
    ourKeys: { encryption: KyberKeyPair; signing: DilithiumKeyPair },
    theirPublicKeys: { encryption: Uint8Array; signing: Uint8Array }
  ): Promise<{
    sharedSecret: Uint8Array;
    proof: Uint8Array;
  }> {
    // 1. Генерация эфемерного ключа Kyber
    const ephemeralKyber = await this.kyber.generateKeyPair();
    
    // 2. Создание общего секрета с их публичным ключом
    const { sharedSecret: secret1, ciphertext: encapsulated1 } = 
      await this.kyber.encapsulate(theirPublicKeys.encryption);
    
    // 3. Создание общего секрета с эфемерным ключом
    const { sharedSecret: secret2, ciphertext: encapsulated2 } = 
      await this.kyber.encapsulate(ephemeralKyber.publicKey);
    
    // 4. Комбинирование секретов через KDF
    const combinedSecret = new Uint8Array(secret1.length + secret2.length);
    combinedSecret.set(secret1);
    combinedSecret.set(secret2, secret1.length);
    
    const finalSecret = sodium.crypto_kdf_derive_from_key(
      32,
      1,
      'QCHANNEL',
      sodium.crypto_generichash(32, combinedSecret)
    );
    
    // 5. Создание доказательства установления канала
    const proofData = new Uint8Array(
      ephemeralKyber.publicKey.length + 
      encapsulated1.length + 
      encapsulated2.length
    );
    proofData.set(ephemeralKyber.publicKey);
    proofData.set(encapsulated1, ephemeralKyber.publicKey.length);
    proofData.set(encapsulated2, ephemeralKyber.publicKey.length + encapsulated1.length);
    
    const proof = await this.quantumSafeSign(proofData, ourKeys.signing.privateKey);
    
    // Очистка временных данных
    sodium.memzero(secret1);
    sodium.memzero(secret2);
    sodium.memzero(combinedSecret);
    this.kyber.secureDelete(ephemeralKyber.privateKey);
    
    return { sharedSecret: finalSecret, proof };
  }

  // Ротация ключей для прямой секретности
  async rotateKeys(
    currentSecret: Uint8Array,
    epoch: number
  ): Promise<Uint8Array> {
    // Использование HKDF для детерминированной ротации
    const info = new TextEncoder().encode(`MESSA_ROTATE_${epoch}`);
    const salt = sodium.randombytes_buf(32);
    
    // Extract
    const prk = sodium.crypto_auth(currentSecret, salt);
    
    // Expand
    const newSecret = sodium.crypto_kdf_derive_from_key(
      32,
      epoch,
      'ROTATION',
      prk
    );
    
    // Очистка старого секрета
    sodium.memzero(currentSecret);
    
    return newSecret;
  }
}
