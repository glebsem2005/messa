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
    const isL
