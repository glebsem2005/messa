import sodium from 'libsodium-wrappers';
import { Kyber } from '@dashlane/pqc-kyber';
import { Dilithium } from '@dashlane/pqc-dilithium';
import { generateKeyPair as generateSignalKeyPair } from '@signalapp/libsignal-client';

export class CryptoService {
  private static instance: CryptoService;
  private kyber: typeof Kyber;
  private dilithium: typeof Dilithium;
  
  private constructor() {
    this.initializeCrypto();
  }
  
  static getInstance(): CryptoService {
    if (!CryptoService.instance) {
      CryptoService.instance = new CryptoService();
    }
    return CryptoService.instance;
  }
  
  private async initializeCrypto() {
    await sodium.ready;
    // Initialize post-quantum crypto
    this.kyber = await import('@dashlane/pqc-kyber').then(m => m.Kyber);
    this.dilithium = await import('@dashlane/pqc-dilithium').then(m => m.Dilithium);
  }
  
  // Signal Protocol for 1:1 messages
  async generateSignalKeyPair() {
    return generateSignalKeyPair();
  }
  
  // Post-quantum key exchange
  async generateKyberKeyPair() {
    const keyPair = await this.kyber.keypair();
    return {
      publicKey: keyPair.publicKey,
      privateKey: keyPair.privateKey
    };
  }
  
  // Post-quantum signatures
  async generateDilithiumKeyPair() {
    const keyPair = await this.dilithium.keypair();
    return {
      publicKey: keyPair.publicKey,
      privateKey: keyPair.privateKey
    };
  }
  
  // Hybrid encryption (classical + post-quantum)
  async encryptMessage(
    plaintext: Uint8Array,
    recipientPublicKey: Uint8Array,
    recipientKyberPublicKey: Uint8Array
  ): Promise<{
    ciphertext: Uint8Array;
    ephemeralPublicKey: Uint8Array;
    kyberCiphertext: Uint8Array;
  }> {
    // Classical ECDH
    const ephemeralKeyPair = sodium.crypto_box_keypair();
    const classicalSharedSecret = sodium.crypto_box_beforenm(
      recipientPublicKey,
      ephemeralKeyPair.privateKey
    );
    
    // Post-quantum KEM
    const kyberEncapsulation = await this.kyber.encapsulate(recipientKyberPublicKey);
    
    // Combine secrets
    const combinedSecret = sodium.crypto_generichash(
      32,
      new Uint8Array([...classicalSharedSecret, ...kyberEncapsulation.sharedSecret])
    );
    
    // Encrypt with combined key
    const nonce = sodium.randombytes_buf(sodium.crypto_secretbox_NONCEBYTES);
    const ciphertext = sodium.crypto_secretbox_easy(plaintext, nonce, combinedSecret);
    
    return {
      ciphertext: new Uint8Array([...nonce, ...ciphertext]),
      ephemeralPublicKey: ephemeralKeyPair.publicKey,
      kyberCiphertext: kyberEncapsulation.ciphertext
    };
  }
  
  // Forward secrecy with key rotation
  async rotateKeys(currentKeyPair: any): Promise<any> {
    const newKeyPair = await this.generateKyberKeyPair();
    const signature = await this.dilithium.sign(
      newKeyPair.publicKey,
      currentKeyPair.privateKey
    );
    
    return {
      newKeyPair,
      signature,
      timestamp: Date.now()
    };
