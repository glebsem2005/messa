import * as faceapi from '@vladmandic/face-api';
import { CryptoService } from '@messa/crypto';
import { StorageService } from '@messa/storage';

export class BiometricService {
  private crypto: CryptoService;
  private storage: StorageService;
  private modelLoaded = false;
  
  constructor() {
    this.crypto = CryptoService.getInstance();
    this.storage = StorageService.getInstance();
    this.loadModels();
  }
  
  private async loadModels() {
    await faceapi.nets.ssdMobilenetv1.loadFromUri('/models');
    await faceapi.nets.faceLandmark68Net.loadFromUri('/models');
    await faceapi.nets.faceRecognitionNet.loadFromUri('/models');
    this.modelLoaded = true;
  }
  
  async detectFace(photoData: Uint8Array): Promise<boolean> {
    if (!this.modelLoaded) await this.loadModels();
    
    const img = await this.uint8ArrayToImage(photoData);
    const detections = await faceapi.detectAllFaces(img);
    
    return detections.length > 0;
  }
  
  async generatePhotoHash(photoData: Uint8Array): Promise<Uint8Array> {
    if (!this.modelLoaded) await this.loadModels();
    
    const img = await this.uint8ArrayToImage(photoData);
    const detection = await faceapi
      .detectSingleFace(img)
      .withFaceLandmarks()
      .withFaceDescriptor();
    
    if (!detection) {
      throw new Error('No face detected');
    }
    
    // Use face descriptor as unique identifier
    const descriptor = new Uint8Array(detection.descriptor);
    return crypto.subtle.digest('SHA-256', descriptor);
  }
  
  async storeEncryptedPhoto(did: string, photoData: Uint8Array): Promise<void> {
    // Generate encryption key from photo itself
    const photoKey = await this.deriveKeyFromPhoto(photoData);
    
    // Encrypt photo with derived key
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const encrypted = await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv },
      photoKey,
      photoData
    );
    
    // Store encrypted photo locally
    await this.storage.store(`photo:${did}`, {
      encrypted: new Uint8Array(encrypted),
      iv
    });
  }
  
  async authenticateWithPhoto(
    did: string,
    photoData: Uint8Array
  ): Promise<boolean> {
    try {
      // Derive key from provided photo
      const photoKey = await this.deriveKeyFromPhoto(photoData);
      
      // Retrieve encrypted photo
      const stored = await this.storage.get(`photo:${did}`);
      if (!stored) return false;
      
      // Try to decrypt stored photo with derived key
      const decrypted = await crypto.subtle.decrypt(
        { name: 'AES-GCM', iv: stored.iv },
        photoKey,
        stored.encrypted
      );
      
      // Compare face descriptors
      const storedHash = await this.generatePhotoHash(new Uint8Array(decrypted));
      const providedHash = await this.generatePhotoHash(photoData);
      
      return this.compareHashes(storedHash, providedHash);
    } catch (error) {
      return false;
    }
  }
  
  private async deriveKeyFromPhoto(photoData: Uint8Array): Promise<CryptoKey> {
    const hash = await this.generatePhotoHash(photoData);
    
    return crypto.subtle.importKey(
      'raw',
      hash.slice(0, 32), // Use first 32 bytes as key
      { name: 'AES-GCM' },
      false,
      ['encrypt', 'decrypt']
    );
  }
  
  private compareHashes(hash1: Uint8Array, hash2: Uint8Array): boolean {
    if (hash1.length !== hash2.length) return false;
    
    let diff = 0;
    for (let i = 0; i < hash1.length; i++) {
      diff |= hash1[i] ^ hash2[i];
    }
    
    return diff === 0;
  }
  
  private async uint8ArrayToImage(data: Uint8Array): Promise<HTMLImageElement> {
    const blob = new Blob([data], { type: 'image/jpeg' });
    const url = URL.createObjectURL(blob);
    const img = new Image();
    
    return new Promise((resolve, reject) => {
      img.onload = () => {
        URL.revokeObjectURL(url);
        resolve(img);
      };
      img.onerror = reject;
      img.src = url;
    });
  }
}
