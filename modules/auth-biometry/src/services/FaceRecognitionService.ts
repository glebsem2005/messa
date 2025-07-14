import * as tf from '@tensorflow/tfjs';
import * as faceapi from '@vladmandic/face-api';
import type { FaceData, IFaceRecognitionService, FaceLandmark, BoundingBox } from '../types';

export class FaceRecognitionService implements IFaceRecognitionService {
  private initialized = false;
  private loadModelsPromise: Promise<void> | null = null;
  private imageWidth = 224;
  private imageHeight = 224;

  async initialize(): Promise<void> {
    if (this.loadModelsPromise) return this.loadModelsPromise;
    this.loadModelsPromise = (async () => {
      // --- Setup TF backend per environment ---
      if (typeof navigator !== 'undefined' && navigator.product === 'ReactNative') {
        // React Native
        await import('@tensorflow/tfjs-react-native');
        await tf.ready();
        await tf.setBackend('rn-webgl');
      } else if (typeof process !== 'undefined' && process.versions?.electron) {
        // Electron / Node
        await import('@tensorflow/tfjs-node');
        await tf.setBackend('tensorflow');
      } else {
        // Web
        await tf.setBackend('webgl');
      }
      await tf.ready();

      // --- Load face-api models ---
      const modelPath = (typeof window !== 'undefined') ? '/models' : './models';

      // Загрузка легкого детектора и SSD для выбора в detectFace
      await Promise.all([
        faceapi.nets.tinyFaceDetector.loadFromUri(modelPath),
        faceapi.nets.ssdMobilenetv1.loadFromUri(modelPath),
        faceapi.nets.faceLandmark68Net.loadFromUri(modelPath),
        faceapi.nets.faceRecognitionNet.loadFromUri(modelPath),
      ]);

      this.initialized = true;
    })();
    return this.loadModelsPromise;
  }

  private decodeImage(imageData: Uint8Array | Buffer): tf.Tensor3D {
    if ((tf as any).node?.decodeImage && Buffer.isBuffer(imageData)) {
      // Electron / Node.js
      return (tf as any).node.decodeImage(imageData, 3);
    } else {
      // Web / React Native
      // Преобразуем Uint8Array в ImageData для fromPixels
      return tf.browser.fromPixels(
        new ImageData(
          new Uint8ClampedArray(imageData as Uint8Array),
          this.imageWidth,
          this.imageHeight
        )
      ) as tf.Tensor3D;
    }
  }

  async detectFace(imageData: Uint8Array | Buffer): Promise<FaceData | null> {
    await this.initialize();

    let tensor: tf.Tensor3D | null = null;

    try {
      tensor = this.decodeImage(imageData);

      // Автоматический выбор детектора: для RN — tiny, для Web/Electron — ssd
      const backend = tf.getBackend();
      const useTiny = backend === 'rn-webgl';

      const options = useTiny
        ? new faceapi.TinyFaceDetectorOptions({ inputSize: 160, scoreThreshold: 0.5 })
        : new faceapi.SsdMobilenetv1Options({ minConfidence: 0.5 });

      const detection = await faceapi
        .detectSingleFace(tensor, options)
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
      tensor?.dispose();
    }
  }

  async compareFaces(face1: FaceData, face2: FaceData): Promise<number> {
    const distance = faceapi.euclideanDistance(
      Array.from(face1.embeddings),
      Array.from(face2.embeddings)
    );

    const similarity = Math.max(0, Math.min(100, (1 - distance) * 100));
    return similarity;
  }

  async validateLiveness(frames: (Uint8Array | Buffer)[]): Promise<boolean> {
    if (frames.length < 3) {
      throw new Error('At least 3 frames required for liveness detection');
    }

    const faceDataArray: FaceData[] = [];

    for (const frame of frames) {
      const faceData = await this.detectFace(frame);
      if (faceData) {
        faceDataArray.push(faceData);
      }
    }

    if (faceDataArray.length < frames.length * 0.8) {
      return false;
    }

    let totalMovement = 0;
    for (let i = 1; i < faceDataArray.length; i++) {
      const movement = this.calculateMovement(
        faceDataArray[i - 1].landmarks,
        faceDataArray[i].landmarks
      );
      totalMovement += movement;
    }

    return totalMovement > 5;
  }

  async sendEmbeddingsToServer(embeddings: Float32Array): Promise<{ verified: boolean; message?: string }> {
    try {
      const response = await fetch('https://yourserver.com/api/biometry/verify-face', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          embeddings: Array.from(embeddings),
        }),
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
    return {
      x: box.x,
      y: box.y,
      width: box.width,
      height: box.height,
    };
  }

  private calculateMovement(landmarks1: FaceLandmark[], landmarks2: FaceLandmark[]): number {
    let totalDistance = 0;

    for (let i = 0; i < landmarks1.length; i++) {
      const dx = landmarks2[i].x - landmarks1[i].x;
      const dy = landmarks2[i].y - landmarks1[i].y;
      totalDistance += Math.sqrt(dx * dx + dy * dy);
    }

    return totalDistance / landmarks1.length;
  }
}
