import sodium from 'libsodium-wrappers';
import { z } from 'zod';
import type { DID, IIdentityService, BiometryAuthResult, ProofOfUniqueness } from '../types';
import { FaceRecognitionService } from './FaceRecognitionService';
import { ZKProofService } from './ZKProofService';
import { SecureStorage } from './SecureStorage';

export class IdentityService implements IIdentityService {
  private faceRecognition: FaceRecognitionService;
  private zkProof: ZKProofService;
  private storage: SecureStorage;
  private currentDID: DID | null = null;

  constructor() {
    this.faceRecognition = new FaceRecognitionService();
    this.zkProof = new ZKProofService();
    this.storage = new SecureStorage();
  }

  async initialize(): Promise<void> {
    await sodium.ready;
    await this.storage.initialize();
  }

  async createDID(): Promise<DID> {
    await this.initialize();

    // Генерация ключевой пары
    const keyPair = sodium.crypto_sign_keypair();
    const publicKeyHex = sodium.to_hex(keyPair.publicKey);
    
    // Генерация уникального идентификатора
    const randomBytes = sodium.randombytes_buf(16);
    const didId = `did:messa:${sodium.to_hex(randomBytes)}`;

    // Создание nullifier для анонимности
    const nullifier = sodium.to_hex(sodium.randombytes_buf(32));

    const did: DID = {
      id: didId,
      publicKey: publicKeyHex,
      createdAt: new Date(),
      photoHash: '', // Будет заполнено при привязке фото
      nullifier,
    };

    // Сохранение приватного ключа
    await this.storage.savePrivateKey(didId, keyPair.privateKey);
    
    this.currentDID = did;
    return did;
  }

  async bindPhotoToDID(did: string, photoData: Uint8Array): Promise<void> {
    // Проверка наличия лица на фото
    const faceData = await this.faceRecognition.detectFace(photoData);
    if (!faceData) {
      throw new Error('No face detected in photo');
    }

    // Проверка liveness (живое лицо)
    // В реальном приложении здесь должна быть серия кадров
    const isLive = true; // Временно упрощено

    if (!isLive) {
      throw new Error('Liveness check failed');
    }

    // Хеширование фото
    const photoHash = sodium.to_hex(
      sodium.crypto_generichash(32, photoData)
    );

    // Сохранение зашифрованных данных лица
    const encryptedFaceData = await this.storage.encryptData(
      new Uint8Array(faceData.embeddings.buffer)
    );
    
    await this.storage.saveFaceData(did, encryptedFaceData);
    
    // Обновление DID с хешем фото
    if (this.currentDID && this.currentDID.id === did) {
      this.currentDID.photoHash = photoHash;
    }

    // Генерация доказательства уникальности
    await this.generateProofOfUniqueness(photoHash);
  }

  async authenticateWithPhoto(photoInput: Uint8Array): Promise<BiometryAuthResult> {
    try {
      // Извлечение данных лица из входного фото
      const inputFaceData = await this.faceRecognition.detectFace(photoInput);
      if (!inputFaceData) {
        return { success: false, error: 'No face detected' };
      }

      // Получение всех сохраненных идентификаторов
      const allDIDs = await this.storage.getAllDIDs();

      for (const didId of allDIDs) {
        // Загрузка сохраненных данных лица
        const encryptedFaceData = await this.storage.getFaceData(didId);
        if (!encryptedFaceData) continue;

        const savedFaceData = await this.storage.decryptData(encryptedFaceData);
        const savedEmbeddings = new Float32Array(savedFaceData.buffer);

        // Сравнение лиц
        const similarity = await this.faceRecognition.compareFaces(
          { ...inputFaceData, embeddings: savedEmbeddings },
          inputFaceData
        );

        // Порог схожести 85%
        if (similarity >= 85) {
          const did = await this.storage.getDID(didId);
          this.currentDID = did;
          return { success: true, did };
        }
      }

      return { success: false, error: 'Authentication failed' };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  }

  async generateProofOfUniqueness(photoHash: string): Promise<ProofOfUniqueness> {
    // Генерация ZK-доказательства уникальности
    const proof = await this.zkProof.generateProof({
      photoHash,
      nullifier: this.currentDID?.nullifier || '',
      timestamp: Date.now(),
    });

    return proof;
  }

  async rotateNullifier(): Promise<void> {
    if (!this.currentDID) {
      throw new Error('No active DID');
    }

    // Генерация нового nullifier
    const newNullifier = sodium.to_hex(sodium.randombytes_buf(32));
    
    // Создание доказательства перехода
    await this.zkProof.generateTransitionProof(
      this.currentDID.nullifier,
      newNullifier
    );

    this.currentDID.nullifier = newNullifier;
    await this.storage.updateDID(this.currentDID);
  }

  async exportIdentity(): Promise<string> {
    if (!this.currentDID) {
      throw new Error('No active identity');
    }

    const privateKey = await this.storage.getPrivateKey(this.currentDID.id);
    const faceData = await this.storage.getFaceData(this.currentDID.id);

    const exportData = {
      did: this.currentDID,
      privateKey: sodium.to_base64(privateKey),
      faceData: faceData ? sodium.to_base64(faceData) : null,
      version: '1.0.0',
    };

    // Шифрование экспортируемых данных
    const encrypted = await this.storage.encryptData(
      new TextEncoder().encode(JSON.stringify(exportData))
    );

    return sodium.to_base64(encrypted);
  }

  async importIdentity(data: string): Promise<void> {
    try {
      const encrypted = sodium.from_base64(data);
      const decrypted = await this.storage.decryptData(encrypted);
      const exportData = JSON.parse(new TextDecoder().decode(decrypted));

      // Валидация данных
      const did = DIDSchema.parse(exportData.did);
      
      // Сохранение импортированных данных
      await this.storage.savePrivateKey(
        did.id,
        sodium.from_base64(exportData.privateKey)
      );

      if (exportData.faceData) {
        await this.storage.saveFaceData(
          did.id,
          sodium.from_base64(exportData.faceData)
        );
      }

      await this.storage.saveDID(did);
      this.currentDID = did;
    } catch (error) {
      throw new Error('Failed to import identity: ' + (error instanceof Error ? error.message : 'Unknown error'));
    }
  }
}
