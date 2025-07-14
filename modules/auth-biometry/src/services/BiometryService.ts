import { FaceRecognitionService } from './FaceRecognitionService';
import { IdentityService } from './IdentityService';
import type { BiometryAuthResult, DID } from '../types';

export class BiometryService {
  private faceRecognition: FaceRecognitionService;
  private identityService: IdentityService;
  private platform: 'web' | 'mobile' | 'desktop';

  constructor() {
    this.faceRecognition = new FaceRecognitionService();
    this.identityService = new IdentityService();
    this.platform = this.detectPlatform();
  }

  async initialize(): Promise<void> {
    await this.identityService.initialize();
    await this.faceRecognition.initialize();
  }

  async register(photoData: Uint8Array): Promise<DID> {
    // Создание нового DID
    const did = await this.identityService.createDID();
    
    // Привязка фото к DID
    await this.identityService.bindPhotoToDID(did.id, photoData);
    
    return did;
  }

  async login(photoData: Uint8Array): Promise<BiometryAuthResult> {
    return this.identityService.authenticateWithPhoto(photoData);
  }

  async checkCameraPermissions(): Promise<boolean> {
    try {
      if (this.platform === 'web' || this.platform === 'desktop') {
        const result = await navigator.permissions.query({ name: 'camera' as PermissionName });
        return result.state === 'granted';
      }
      
      // Для мобильных платформ проверка через Capacitor/React Native
      return true;
    } catch {
      return false;
    }
  }

  async requestCameraPermissions(): Promise<boolean> {
    try {
      if (this.platform === 'web' || this.platform === 'desktop') {
        const stream = await navigator.mediaDevices.getUserMedia({ video: true });
        stream.getTracks().forEach(track => track.stop());
        return true;
      }
      
      // Для мобильных платформ
      return true;
    } catch {
      return false;
    }
  }

  private detectPlatform(): 'web' | 'mobile' | 'desktop' {
    if (typeof window === 'undefined') {
      return 'desktop';
    }

    // Проверка React Native
    if (typeof navigator !== 'undefined' && navigator.product === 'ReactNative') {
      return 'mobile';
    }

    // Проверка Electron
    if (typeof process !== 'undefined' && process.versions && process.versions.electron) {
      return 'desktop';
    }

    // Проверка мобильного браузера
    const userAgent = navigator.userAgent || navigator.vendor || (window as any).opera;
    if (/android/i.test(userAgent) || /iPad|iPhone|iPod/.test(userAgent)) {
      return 'mobile';
    }

    return 'web';
  }

  getPlatform(): string {
    return this.platform;
  }
}
