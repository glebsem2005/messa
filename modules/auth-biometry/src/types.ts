export type BoundingBox = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export type FaceLandmark = {
  x: number;
  y: number;
  type: 'eye_left' | 'eye_right' | 'nose' | 'mouth_left' | 'mouth_right';
};

export type FaceData = {
  embeddings: Float32Array;
  landmarks: FaceLandmark[];
  boundingBox: BoundingBox;
  confidence: number;
};

export interface IFaceRecognitionService {
  initialize(): Promise<void>;
  detectFace(image: Uint8Array): Promise<FaceData | null>;
  extractEmbeddings(image: Uint8Array): Promise<Float32Array>;
  compareFaces(a: FaceData, b: FaceData): Promise<number>;
  validateLiveness(frames: Uint8Array[]): Promise<boolean>;
}

export interface IBiometryService {
  register(faceData: FaceData): Promise<void>;
  authenticate(image: Uint8Array): Promise<boolean>;
}
