export interface ZKProof {
  proof: {
    pi_a: string[];
    pi_b: string[][];
    pi_c: string[];
    protocol: string;
    curve: string;
  };
  publicSignals: string[];
}

export interface PrivacyProof {
  type: ProofType;
  proof: ZKProof;
  metadata: ProofMetadata;
  timestamp: Date;
}

export type ProofType = 
  | 'identity'
  | 'membership'
  | 'range'
  | 'ownership'
  | 'uniqueness'
  | 'nullifier';

export interface ProofMetadata {
  circuit: string;
  version: string;
  publicInputs: Record<string, any>;
  commitments?: string[];
}

export interface AnonymitySet {
  id: string;
  members: string[];
  merkleRoot: string;
  size: number;
  createdAt: Date;
}

export interface PrivateCredential {
  id: string;
  type: string;
  value: any;
  salt: string;
  commitment: string;
}

export interface IZKPrivacyService {
  // Доказательства идентичности
  proveIdentity(credential: PrivateCredential): Promise<PrivacyProof>;
  verifyIdentity(proof: PrivacyProof): Promise<boolean>;
  
  // Доказательства членства
  proveMembership(element: string, set: AnonymitySet): Promise<PrivacyProof>;
  verifyMembership(proof: PrivacyProof, set: AnonymitySet): Promise<boolean>;
  
  // Доказательства диапазона
  proveRange(value: number, min: number, max: number): Promise<PrivacyProof>;
  verifyRange(proof: PrivacyProof, min: number, max: number): Promise<boolean>;
  
  // Nullifier для предотвращения двойного использования
  generateNullifier(secret: string, externalNullifier: string): Promise<string>;
  checkNullifier(nullifier: string): Promise<boolean>;
  
  // Анонимные учетные данные
  issueCredential(type: string, value: any): Promise<PrivateCredential>;
  presentCredential(credential: PrivateCredential, attributes: string[]): Promise<PrivacyProof>;
}

export interface IAnonymitySetService {
  createSet(members: string[]): Promise<AnonymitySet>;
  addMember(setId: string, member: string): Promise<void>;
  removeMember(setId: string, member: string): Promise<void>;
  getMerkleProof(setId: string, member: string): Promise<string[]>;
  updateMerkleRoot(setId: string): Promise<void>;
}

export interface IProofGenerator {
  generateProof(circuit: string, witness: any, provingKey: any): Promise<ZKProof>;
  generateWitness(inputs: Record<string, any>): Promise<any>;
  loadCircuit(name: string): Promise<any>;
  loadProvingKey(circuit: string): Promise<any>;
}

export interface IProofVerifier {
  verifyProof(proof: ZKProof, verificationKey: any): Promise<boolean>;
  loadVerificationKey(circuit: string): Promise<any>;
  validatePublicInputs(inputs: string[], constraints: any): boolean;
}

export interface CircuitConfig {
  name: string;
  path: string;
  version: string;
  constraints: number;
  publicInputs: string[];
  privateInputs: string[];
}
