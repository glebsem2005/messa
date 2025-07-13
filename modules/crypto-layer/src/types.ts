export interface KyberKeyPair {
  publicKey: Uint8Array;
  privateKey: Uint8Array;
}

export interface DilithiumKeyPair {
  publicKey: Uint8Array;
  privateKey: Uint8Array;
}

export interface KyberEncrypted {
  ciphertext: Uint8Array;
  encapsulatedKey: Uint8Array;
}

export interface DilithiumSignature {
  signature: Uint8Array;
  message: Uint8Array;
}

export interface ZKProof {
  proof: {
    a: string;
    b: string;
    c: string;
  };
  publicSignals: string[];
}

export interface QuantumKeyExchange {
  ephemeralPublicKey: Uint8Array;
  staticPublicKey: Uint8Array;
  signature: Uint8Array;
  timestamp: number;
}

export interface IKyberService {
  generateKeyPair(): Promise<KyberKeyPair>;
  encapsulate(publicKey: Uint8Array): Promise<{ sharedSecret: Uint8Array; ciphertext: Uint8Array }>;
  decapsulate(ciphertext: Uint8Array, privateKey: Uint8Array): Promise<Uint8Array>;
}

export interface IDilithiumService {
  generateKeyPair(): Promise<DilithiumKeyPair>;
  sign(message: Uint8Array, privateKey: Uint8Array): Promise<Uint8Array>;
  verify(message: Uint8Array, signature: Uint8Array, publicKey: Uint8Array): Promise<boolean>;
}

export interface IZKSNARKService {
  generateProof(witness: any, circuit: string): Promise<ZKProof>;
  verifyProof(proof: ZKProof, publicInputs: string[]): Promise<boolean>;
  setupCircuit(circuitPath: string): Promise<void>;
}

export interface IQuantumResistantCrypto {
  generateQuantumSafeKeyPair(): Promise<{ 
    encryption: KyberKeyPair; 
    signing: DilithiumKeyPair;
  }>;
  hybridEncrypt(data: Uint8Array, recipientPublicKey: Uint8Array): Promise<Uint8Array>;
  hybridDecrypt(encryptedData: Uint8Array, privateKey: Uint8Array): Promise<Uint8Array>;
  quantumSafeSign(data: Uint8Array, privateKey: Uint8Array): Promise<Uint8Array>;
  quantumSafeVerify(data: Uint8Array, signature: Uint8Array, publicKey: Uint8Array): Promise<boolean>;
}
