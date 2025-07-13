import { z } from 'zod';

export const DIDSchema = z.object({
  id: z.string().startsWith('did:messa:'),
  publicKey: z.string(),
  createdAt: z.date(),
  photoHash: z.string(),
  nullifier: z.string(),
});

export type DID = z.infer<typeof DIDSchema>;

export interface FaceData {
  embeddings: Float32Array;
  landmarks: FaceLandmark[];
  boundingBox: BoundingBox;
  confidence: number;
}

export interface FaceLandmark {
  x: number;
  y: number;
  type: 'eye_left' | 'eye_right' | 'nose' | 'mouth_left' | 'mouth_right';
}

export interface BoundingBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface BiometryAuthResult {
  success: boolean;
  did?: DID;
  error?: string;
}

export interface ProofOfUniqueness {
  proof: string;
  publicSignals: string[];
  timestamp: number;
}

export interface IIdentityService {
  createDID(): Promise<DID>;
  bindPhotoToDID(did: string, photoData: Uint8Array): Promise<void>;
  authenticateWithPhoto(photoInput: Uint8Array): Promise<BiometryAuthResult>;
  generateProofOfUniqueness(photoHash: string): Promise<ProofOfUniqueness>;
  rotateNullifier(): Promise<void>;
  exportIdentity(): Promise<string>;
  importIdentity(data: string): Promise<void>;
}

export interface IFaceRecognitionService {
  detectFace(imageData: Uint8Array): Promise<FaceData | null>;
  compareFaces(face1: FaceData, face2: FaceData): Promise<number>;
  extractEmbeddings(imageData: Uint8Array): Promise<Float32Array>;
  validateLiveness(frames: Uint8Array[]): Promise<boolean>;
}
