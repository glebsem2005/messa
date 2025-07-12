import { SignalProtocolStore, SessionBuilder, SessionCipher } from '@signalapp/libsignal-client';
import { MLS } from '@mls/core';
import { CryptoService } from '@messa/crypto';
import { P2PService } from '@messa/p2p';
import { StorageService } from '@messa/storage';
import { EventEmitter } from 'events';

export class ChatService extends EventEmitter {
  private crypto: CryptoService;
  private p2p: P2PService;
  private storage: StorageService;
  private signalStore: SignalProtocolStore;
  private mls: MLS;
  
  constructor() {
    super();
    this.crypto = CryptoService.getInstance();
    this.p2p = new P2PService();
    this.storage = StorageService.getInstance();
    this.initializeProtocols();
  }
  
  private async initializeProtocols() {
    // Initialize Signal Protocol store
    this.signalStore = new SignalProtocolStore();
    
    // Initialize MLS
    this.mls = new MLS({
      cipherSuite: 'MLS_256_DHKEM_X25519_AES256GCM_SHA256_Ed25519',
      credentials: await this.generateMLSCredentials()
    });
  }
  
  private async generateMLSCredentials() {
    const keyPair = await this.crypto.generateDilithiumKeyPair();
    return {
      credentialType: 'basic',
      identity: await this.storage.get('did'),
      signaturePublicKey: keyPair.publicKey
    };
  }
  
  // One-to-one messaging with Signal Protocol
  async sendDirectMessage(
    recipientDID: string,
    content: {
      text?: string;
      media?: Uint8Array;
      mediaType?: string;
    }
  ) {
    // Build session if not exists
    const sessionExists = await this.signalStore.containsSession(recipientDID);
    
    if (!sessionExists) {
      await this.buildSession(recipientDID);
    }
    
    // Serialize content
    const message = JSON.stringify(content);
    const messageBytes = new TextEncoder().encode(message);
    
    // Encrypt with Signal Protocol
    const sessionCipher = new SessionCipher(this.signalStore, recipientDID);
    const ciphertext = await sessionCipher.encrypt(messageBytes);
    
    // Add post-quantum layer
    const recipientKyberKey = await this.fetchRecipientKyberKey(recipientDID);
    const pqEncrypted = await this.crypto.encryptMessage(
      ciphertext,
      recipientKyberKey.classical,
      recipientKyberKey.kyber
    );
    
    // Send via P2P
    await this.p2p.sendMessage(
      `chat:${recipientDID}`,
      pqEncrypted.ciphertext,
      { padding: true }
    );
    
    // Store message locally
    await this.storeMessage({
      id: crypto.randomUUID(),
      from: await this.storage.get('did'),
      to: recipientDID,
      content,
      timestamp: Date.now(),
      status: 'sent'
    });
    
    this.emit('messageSent', { to: recipientDID, content });
  }
  
  // Group messaging with MLS
  async sendGroupMessage(
    groupId: string,
    content: {
      text?: string;
      media?: Uint8Array;
      mediaType?: string;
    }
  ) {
    const group = await this.mls.getGroup(groupId);
    
    if (!group) {
      throw new Error('Not a member of this group');
    }
    
    // Serialize content
    const message = JSON.stringify(content);
    const messageBytes = new TextEncoder().encode(message);
    
    // Encrypt with MLS
    const ciphertext = await group.encrypt(messageBytes);
    
    // Broadcast to group members
    await this.p2p.sendMessage(
      `group:${groupId}`,
      ciphertext,
      { padding: true }
    );
    
    // Store message locally
    await this.storeMessage({
      id: crypto.randomUUID(),
      from: await this.storage.get('did'),
      to: groupId,
      content,
      timestamp: Date.now(),
      status: 'sent',
      isGroup: true
    });
    
    this.emit('groupMessageSent', { groupId, content });
  }
  
  // Voice/Video calls via WebRTC
  async initiateCall(
    recipientDID: string,
    type: 'voice' | 'video'
  ): Promise<RTCPeerConnection> {
    const pc = new RTCPeerConnection({
      iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'turn:relay.messa.io:3478', username: 'user', credential: 'pass' }
      ]
    });
    
    // Add local stream
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: true,
      video: type === 'video'
    });
    
    stream.getTracks().forEach(track => {
      pc.addTrack(track, stream);
    });
    
    // Create offer
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    
    // Encrypt and send offer
    const encryptedOffer = await this.encryptSignalingData(recipientDID, offer);
    
    await this.p2p.sendMessage(
      `call:${recipientDID}`,
      encryptedOffer,
      { padding: false }
    );
    
    return pc;
  }
  
  private async buildSession(recipientDID: string) {
    // Fetch recipient's bundle
    const bundle = await this.fetchRecipientBundle(recipientDID);
    
    // Build Signal session
    const sessionBuilder = new SessionBuilder(this.signalStore, recipientDID);
    await sessionBuilder.processPreKeyBundle(bundle);
  }
  
  private async fetchRecipientBundle(did: string): Promise<any> {
    // Query DHT for recipient's bundle
    const peers = await this.p2p.discoverPeers(did);
    
    for (const peer of peers) {
      try {
        const bundle = await this.p2p.node.request(
          peer,
          'bundle',
          { did }
        );
        
        if (bundle) return bundle;
      } catch (error) {
        continue;
      }
    }
    
    throw new Error('Could not fetch recipient bundle');
  }
  
  private async fetchRecipientKyberKey(did: string): Promise<any> {
    // Similar to fetchRecipientBundle but for Kyber keys
    const peers = await this.p2p.discoverPeers(did);
    
    for (const peer of peers) {
      try {
        const keys = await this.p2p.node.request(
          peer,
          'kyber-keys',
          { did }
        );
        
        if (keys) return keys;
      } catch (error) {
        continue;
      }
    }
    
    throw new Error('Could not fetch recipient Kyber keys');
  }
  
  private async encryptSignalingData(
    recipientDID: string,
    data: any
  ): Promise<Uint8Array> {
    const serialized = JSON.stringify(data);
    const bytes = new TextEncoder().encode(serialized);
    
    // Use existing session for encryption
    const sessionCipher = new SessionCipher(this.signalStore, recipientDID);
    return sessionCipher.encrypt(bytes);
  }
  
  private async storeMessage(message: any) {
    await this.storage.store(`message:${message.id}`, message);
    
    // Update conversation index
    const conversationId = message.isGroup ? message.to : 
      [message.from, message.to].sort().join(':');
    
    const conversation = await this.storage.get(`conversation:${conversationId}`) || {
      id: conversationId,
      participants: message.isGroup ? [] : [message.from, message.to],
      lastMessage: null,
      unreadCount: 0
    };
    
    conversation.lastMessage = message;
    conversation.updatedAt = Date.now();
    
    await this.storage.store(`conversation:${conversationId}`, conversation);
  }
}
