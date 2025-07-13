import * as tf from '@tensorflow/tfjs';
import * as faceapi from '@vladmandic/face-api';
import type { FaceData, IFaceRecognitionService, FaceLandmark, BoundingBox } from '../types';

export class FaceRecognitionService implements IFaceRecognitionService {
  private initialized = false;
  private model: faceapi.SsdMobilenetv1 | null = null;

  async initialize(): Promise<void> {
    if (this.initialized) return;

    // Загрузка моделей для распознавания лиц
    await faceapi.nets.ssdMobilenetv1.loadFromUri('/models');
    await faceapi.nets.faceLandmark68Net.loadFromUri('/models');
    await faceapi.nets.faceRecognitionNet.loadFromUri('/models');
    
    this.initialized = true;
  }

  async detectFace(imageData: Uint8Array): Promise<FaceData | null> {
    await this.initialize();

    try {
      // Конвертация изображения в тензор
      const imgTensor = tf.browser.fromPixels(new ImageData(
        new Uint8ClampedArray(imageData),
        224, 224
      ));

      // Детекция лица
      const detection = await faceapi
        .detectSingleFace(imgTensor as any)
        .withFaceLandmarks()
        .withFaceDescriptor();

      if (!detection) {
        imgTensor.dispose();
        return null;
      }

      // Извлечение данных
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
    // Вычисление евклидова расстояния между эмбеддингами
    const distance = faceapi.euclideanDistance(
      Array.from(face1.embeddings),
      Array.from(face2.embeddings)
    );

    // Конвертация в процент схожести (0-100)
    const similarity = Math.max(0, Math.min(100, (1 - distance) * 100));
    return similarity;
  }

  async extractEmbeddings(imageData: Uint8Array): Promise<Float32Array> {
    const faceData = await this.detectFace(imageData);
    if (!faceData) {
      throw new Error('No face detected in image');
    }
    return faceData.embeddings;
  }

  async validateLiveness(frames: Uint8Array[]): Promise<boolean> {
    if (frames.length < 3) {
      throw new Error('At least 3 frames required for liveness detection');
    }

    const faceDataArray: FaceData[] = [];
    
    // Анализ каждого кадра
    for (const frame of frames) {
      const faceData = await this.detectFace(frame);
      if (faceData) {
        faceDataArray.push(faceData);
      }
    }

    if (faceDataArray.length < frames.length * 0.8) {
      return false; // Лицо не обнаружено в достаточном количестве кадров
    }

    // Проверка движения между кадрами
    let totalMovement = 0;
    for (let i = 1; i < faceDataArray.length; i++) {
      const movement = this.calculateMovement(
        faceDataArray[i - 1].landmarks,
        faceDataArray[i].landmarks
      );
      totalMovement += movement;
    }

    // Если есть движение, значит это живой человек
    return totalMovement > 5; // Порог движения в пикселях
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
