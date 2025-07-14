import * as tf from '@tensorflow/tfjs';
import * as faceapi from '@vladmandic/face-api';
import type { FaceData, IFaceRecognitionService, FaceLandmark, BoundingBox } from '../types';

const MODEL_URL_LOCAL = '/models';
const MODEL_URL_CDN = 'https://cdn.jsdelivr.net/gh/vladmandic/face-api/model';

export class FaceRecognitionService implements IFaceRecognitionService {
  private initialized = false;

  async initialize(): Promise<void> {
    if (this.initialized) return;

    const modelUrl = typeof window !== 'undefined' ? MODEL_URL_LOCAL : MODEL_URL_CDN;

    try {
      await Promise.all([
        faceapi.nets.ssdMobilenetv1.loadFromUri(modelUrl),
        faceapi.nets.faceLandmark68Net.loadFromUri(modelUrl),
        faceapi.nets.faceRecognitionNet.loadFromUri(modelUrl),
      ]);
    } catch (error) {
      if (modelUrl === MODEL_URL_LOCAL) {
        console.warn('⚠️ Local model loading failed, trying CDN...');
        await Promise.all([
          faceapi.nets.ssdMobilenetv1.loadFromUri(MODEL_URL_CDN),
          faceapi.nets.faceLandmark68Net.loadFromUri(MODEL_URL_CDN),
          faceapi.nets.faceRecognitionNet.loadFromUri(MODEL_URL_CDN),
        ]);
      } else {
        throw error;
      }
    }

    this.initialized = true;
  }

  async detectFace(imageData: Uint8Array): Promise<FaceData | null> {
    await this.initialize();

    let imgTensor: tf.Tensor | null = null;
    try {
      imgTensor = tf.browser.fromPixels(
        new ImageData(new Uint8ClampedArray(imageData), 224, 224)
      );

      const detection = await faceapi
        .detectSingleFace(imgTensor as any)
        .withFaceLandmarks()
        .withFaceDescriptor();

      if (!detection) return null;

      const landmarks = this.extractLandmarks(detection.landmarks);
      const boundingBox = this.extractBoundingBox(detection.detection);
      const embeddings = new Float32Array(detection.descriptor);

      return {
        embeddings,
        landmarks,
        boundingBox,
        confidence: detection.detection.score,
      };
    } catch (error) {
      console.error('Face detection error:', error);
      return null;
    } finally {
      imgTensor?.dispose?.();
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
    if (frames.length < 3) throw new Error('At least 3 frames required');

    const faceDataArray: FaceData[] = [];
    for (const frame of frames) {
      const data = await this.detectFace(frame);
      if (data) faceDataArray.push(data);
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

      if (!response.ok) throw new Error(`Server error ${response.status}`);

      const data = await response.json();
      return { verified: data.verified, message: data.message };
    } catch (error) {
      console.error('Verification error:', error);
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
    return landmarks1.reduce((sum, point, i) => {
      const dx = landmarks2[i].x - point.x;
      const dy = landmarks2[i].y - point.y;
      return sum + Math.sqrt(dx * dx + dy * dy);
    }, 0) / landmarks1.length;
  }
}
