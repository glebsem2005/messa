import { MLS } from '@mls/core';
import { CryptoService } from '@messa/crypto';
import { P2PService } from '@messa/p2p';
import { StorageService } from '@messa/storage';
import { EventEmitter } from 'events';

export class ChannelService extends EventEmitter {
  private crypto: CryptoService;
  private p2p: P2PService;
  private storage: StorageService;
  private mls: MLS;
  
  constructor() {
    super();
    this.crypto = CryptoService.getInstance();
    this.p2p = new P2PService();
    this.storage = StorageService.getInstance();
    this.initializeMLS();
  }
  
  private async initializeMLS() {
    this.mls = new MLS({
      cipherSuite: 'MLS_256_DHKEM_X25519_AES256GCM_SHA256_Ed25519',
      credentials: await this.generateMLSCredentials()
    });
  }
  
  private async generateMLSCredentials() {
    const keyPair = await this.crypto.generateDilithiumKeyPair();
    const did = await this.storage.get('did');
    
    return {
      credentialType: 'basic',
      identity: did,
      signaturePublicKey: keyPair.publicKey
    };
  }
  
  async createChannel(params: {
    name: string;
    description?: string;
    isPrivate: boolean;
    maxSubscribers?: number;
  }): Promise<string> {
    const channelId = crypto.randomUUID();
    
    // Create MLS group for channel
    const group = await this.mls.createGroup();
    
    // Generate channel keys
    const channelKeys = await this.crypto.generateKyberKeyPair();
    
    const channel = {
      id: channelId,
      name: params.name,
      description: params.description,
      isPrivate: params.isPrivate,
      maxSubscribers: params.maxSubscribers || (params.isPrivate ? 1000 : Infinity),
      createdBy: await this.storage.get('did'),
      createdAt: Date.now(),
      groupId: group.id,
      publicKey: channelKeys.publicKey,
      privateKey: channelKeys.privateKey,
      subscriberCount: 0,
      isPremium: params.maxSubscribers && params.maxSubscribers > 1000
    };
    
    // Store channel data
    await this.storage.store(`channel:${channelId}`, channel);
    
    // Announce channel creation if public
    if (!params.isPrivate) {
      await this.p2p.sendMessage(
        'channel:announce',
        new TextEncoder().encode(JSON.stringify({
          id: channelId,
          name: params.name,
          description: params.description
        })),
        { padding: true }
      );
    }
    
    this.emit('channelCreated', channel);
    
    return channelId;
  }
  
  async subscribeToChannel(channelId: string, inviteKey?: Uint8Array) {
    const channel = await this.storage.get(`channel:${channelId}`);
    
    if (!channel) {
      throw new Error('Channel not found');
    }
    
    if (channel.isPrivate && !inviteKey) {
      throw new Error('Invite key required for private channel');
    }
    
    // Verify invite key if private
    if (channel.isPrivate) {
      const isValid = await this.verifyInviteKey(channelId, inviteKey!);
      if (!isValid) {
        throw new Error('Invalid invite key');
      }
    }
    
    // Check subscriber limit
    if (channel.subscriberCount >= channel.maxSubscribers) {
      throw new Error('Channel has reached maximum subscribers');
    }
    
    // Join MLS group
    const group = await this.mls.joinGroup(channel.groupId);
    
    // Subscribe to channel topic
    await this.p2p.node.services.pubsub.subscribe(`channel:${channelId}:messages`);
    
    // Update local subscription
    await this.storage.store(`subscription:${channelId}`, {
      channelId,
      subscribedAt: Date.now(),
      lastRead: Date.now()
    });
    
    // Increment subscriber count (anonymous)
    channel.subscriberCount++;
    await this.storage.store(`channel:${channelId}`, channel);
    
    this.emit('channelSubscribed', { channelId });
  }
  
  async publishToChannel(channelId: string, content: {
    text?: string;
    media?: Uint8Array;
    mediaType?: string;
  }) {
    const channel = await this.storage.get(`channel:${channelId}`);
    
    if (!channel) {
      throw new Error('Channel not found');
    }
    
    if (channel.createdBy !== await this.storage.get('did')) {
      throw new Error('Only channel owner can publish');
    }
    
    // Get MLS group
    const group = await this.mls.getGroup(channel.groupId);
    
    // Serialize content
    const message = {
      id: crypto.randomUUID(),
      channelId,
      content,
      timestamp: Date.now()
    };
    
    const messageBytes = new TextEncoder().encode(JSON.stringify(message));
    
    // Encrypt with MLS
    const ciphertext = await group.encrypt(messageBytes);
    
    // Publish to channel
    await this.p2p.sendMessage(
      `channel:${channelId}:messages`,
      ciphertext,
      { padding: true }
    );
    
    // Store message
    await this.storage.store(`channel:${channelId}:message:${message.id}`, message);
    
    this.emit('channelMessagePublished', message);
  }
  
  private async verifyInviteKey(channelId: string, inviteKey: Uint8Array): Promise<boolean> {
    const channel = await this.storage.get(`channel:${channelId}`);
    
    // Verify invite key signature
    try {
      const verified = await this.crypto.verifySignature(
        inviteKey,
        channel.publicKey,
        new TextEncoder().encode(channelId)
      );
      
      return verified;
    } catch (error) {
      return false;
    }
  }
  
  async generateInviteLink(channelId: string): Promise<string> {
    const channel = await this.storage.get(`channel:${channelId}`);
    
    if (!channel) {
      throw new Error('Channel not found');
    }
    
    if (channel.createdBy !== await this.storage.get('did')) {
      throw new Error('Only channel owner can generate invite links');
    }
    
    // Sign channel ID with private key
    const signature = await this.crypto.sign(
      new TextEncoder().encode(channelId),
      channel.privateKey
    );
    
    // Create invite data
    const inviteData = {
      channelId,
      signature: Array.from(signature),
      expires: Date.now() + (7 * 24 * 60 * 60 * 1000) // 7 days
    };
    
    // Encode as base64url
    const encoded = btoa(JSON.stringify(inviteData))
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=/g, '');
    
    return `messa://channel/invite/${encoded}`;
  }
}
