import { Ed25519Provider } from 'did-provider-ed25519';
import { DID } from 'dids';
import { getResolver } from 'key-did-resolver';
import * as snarkjs from 'snarkjs';
import { CryptoService } from '@messa/crypto';
import { BiometricService } from './biometric-service';

export class DIDService {
  private crypto: CryptoService;
  private biometric: BiometricService;
  
  constructor() {
    this.crypto = CryptoService.getInstance();
    this.biometric = new BiometricService();
  }
  
  async createDID(photoData: Uint8Array): Promise<{
    did: string;
    nullifier: string;
    proof: any;
  }> {
    // Verify face in photo
    const faceDetected = await this.biometric.detectFace(photoData);
    if (!faceDetected) {
      throw new Error('No face detected in photo');
    }
    
    // Generate unique nullifier from photo
    const photoHash = await this.biometric.generatePhotoHash(photoData);
    const nullifier = await this.generateNullifier(photoHash);
    
    // Create DID
    const seed = crypto.getRandomValues(new Uint8Array(32));
    const provider = new Ed25519Provider(seed);
    const did = new DID({ provider, resolver: getResolver() });
    await did.authenticate();
    
    // Generate zero-knowledge proof of uniqueness
    const proof = await this.generateUniquenessProof(photoHash, nullifier);
    
    // Store encrypted photo for future auth
    await this.biometric.storeEncryptedPhoto(did.id, photoData);
    
    return {
      did: did.id,
      nullifier,
      proof
    };
  }
  
  private async generateNullifier(photoHash: Uint8Array): Promise<string> {
    // Use zk-SNARK to generate nullifier
    const circuit = await snarkjs.groth16.setup(
      'circuits/uniqueness.r1cs',
      'circuits/uniqueness.zkey'
    );
    
    const witness = {
      photoHash: Array.from(photoHash),
      secret: Array.from(crypto.getRandomValues(new Uint8Array(32)))
    };
    
    const { proof, publicSignals } = await snarkjs.groth16.prove(
      circuit.zkey,
      witness
    );
    
    return publicSignals[0]; // nullifier
  }
  
  private async generateUniquenessProof(
    photoHash: Uint8Array,
    nullifier: string
  ): Promise<any> {
    // Generate proof that this nullifier corresponds to the photo hash
    // without revealing the photo itself
    const input = {
      photoHash: Array.from(photoHash),
      nullifier: nullifier
    };
    
    const { proof } = await snarkjs.groth16.prove(
      'circuits/uniqueness_proof.zkey',
      input
    );
    
    return proof;
  }
}
