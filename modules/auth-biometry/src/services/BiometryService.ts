import type { IBiometryService, FaceData } from '../types';
import { FaceRecognitionService } from './FaceRecognitionService';

export class BiometryService implements IBiometryService {
  private db: Float32Array[] = [];
  private recognizer = new FaceRecognitionService();

  async register(data: FaceData): Promise<void> {
    this.db.push(data.embeddings);
  }

  async authenticate(image: Uint8Array): Promise<boolean> {
    const data = await this.recognizer.detectFace(image);
    if (!data) return false;

    for (const stored of this.db) {
      const sim = await this.recognizer.compareFaces(
        {
          embeddings: stored,
          landmarks: [],
          boundingBox: { x: 0, y: 0, width: 0, height: 0 },
          confidence: 1,
        },
        data
      );
      if (sim > 90) return true;
    }

    return false;
  }
}

