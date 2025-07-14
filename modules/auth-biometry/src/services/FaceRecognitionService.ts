import * as tf from '@tensorflow/tfjs';
import * as faceapi from '@vladmandic/face-api';
import type { FaceData, IFaceRecognitionService, FaceLandmark, BoundingBox } from '../types';

// Путь до моделей для Web
const MODEL_URL_WEB = '/models';
// Путь до моделей для React Native или fallback
const MODEL_URL_CDN = 'https://cdn.jsdelivr.net/gh/vladmandic/face-api/model';

export class FaceRecognitionService implements IFaceRecognitionService {
  private initialized = false;

  async initialize(): Promise<void> {
    if (this.initialized) return;

    try {
      // Сначала пробуем локально (public/models)
      await Promise.all([
        faceapi.nets.ssdMobilenetv1.loadFromUri(MODEL_URL_WEB),
        faceapi.nets.faceLandmark68Net.loadFromUri(MODEL_URL_WEB),
        faceapi.nets.faceRecognitionNet.loadFromUri(MODEL_URL_WEB),
      ]);
    } catch (e) {
      console.warn('⚠️ Local model loading failed, trying CDN fallback...');
      // Если не вышло — грузим с CDN
      await Promise.all([
        faceapi.nets.ssdMobilenetv1.loadFromUri(MODEL_URL_CDN),
        faceapi.nets.faceLandmark68Net.loadFromUri(MODEL_URL_CDN),
        faceapi.nets.faceRecognitionNet.loadFromUri(MODEL_URL_CDN),
      ]);
    }

    this.initialized = true;
  }

  async detectFace(imageData: Uint8Array): Promise<FaceData | null> {
    await this.initialize();

    try {
      const imgTensor = tf.browser.fromPixels(new ImageData(
        new Uint8ClampedArray(imageData),
        224, 224
      ));

      const detection = await faceapi
        .detectSingleFace(imgTensor as any)
        .withFaceLandmarks()
        .withFaceDescriptor();

      if (!detection) {
        imgTensor.dispose();
        return null;
      }

      const landmarks = this.extractLandmarks(detection.landmarks);
      const boundingBox = this.extractBoundingBox(detection.detection);
      const embeddings = new Float32Array(detection.descriptor);

      imgTensor.dispose();

      return {
        embeddings,
        landmarks,
        boundingBox,
        confidence: detection.detection.score,
      };
    } catch (error) {
      console.error('Face detection error:', error);
      return null;
    }
  }

  async compareFaces(face1: FaceData, face2: FaceData): Promise<number> {
    const distance = faceapi.euclideanDistance(
      Array.from(face1.embeddings),
      Array.from(face2.embeddings)
    );
    return Math.max(0, Math.min(100, (1 - distance) * 100));
  }

  async validateLiveness(frames: Uint8Array[]): Promise<boolean> {
    if (frames.length < 3) {
      throw new Error('At least 3 frames required for liveness detection');
    }

    const faceDataArray: FaceData[] = [];

    for (const frame of frames) {
      const faceData = await this.detectFace(frame);
      if (faceData) faceDataArray.push(faceData);
    }

    if (faceDataArray.length < frames.length * 0.8) return false;

    let totalMovement = 0;
    for (let i = 1; i < faceDataArray.length; i++) {
      totalMovement += this.calculateMovement(
        faceDataArray[i - 1].landmarks,
        faceDataArray[i].landmarks
      );
    }

    return totalMovement > 5;
  }

  async sendEmbeddingsToServer(embeddings: Float32Array): Promise<{ verified: boolean; message?: string }> {
    try {
      const response = await fetch('https://yourserver.com/api/biometry/verify-face', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ embeddings: Array.from(embeddings) }),
      });

      if (!response.ok) {
        throw new Error(`Server responded with status ${response.status}`);
      }

      const data = await response.json();
      return { verified: data.verified, message: data.message };
    } catch (error) {
      console.error('Error sending embeddings to server:', error);
      return { verified: false, message: error.message };
    }
  }

  private extractLandmarks(landmarks: faceapi.FaceLandmarks68): FaceLandmark[] {
    return [
      { x: landmarks.getLeftEye()[0].x, y: landmarks.getLeftEye()[0].y, type: 'eye_left' },
      { x: landmarks.getRightEye()[0].x, y: landmarks.getRightEye()[0].y, type: 'eye_right' },
      { x: landmarks.getNose()[0].x, y: landmarks.getNose()[0].y, type: 'nose' },
      { x: landmarks.getMouth()[0].x, y: landmarks.getMouth()[0].y, type: 'mouth_left' },
      { x: landmarks.getMouth()[6].x, y: landmarks.getMouth()[6].y, type: 'mouth_right' },
    ];
  }

  private extractBoundingBox(detection: faceapi.FaceDetection): BoundingBox {
    const box = detection.box;
    return { x: box.x, y: box.y, width: box.width, height: box.height };
  }

  private calculateMovement(landmarks1: FaceLandmark[], landmarks2: FaceLandmark[]): number {
    let total = 0;
    for (let i = 0; i < landmarks1.length; i++) {
      const dx = landmarks2[i].x - landmarks1[i].x;
      const dy = landmarks2[i].y - landmarks1[i].y;
      total += Math.sqrt(dx * dx + dy * dy);
    }
    return total / landmarks1.length;
  }
}
