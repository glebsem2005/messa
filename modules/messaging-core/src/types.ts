import { z } from 'zod';

export const MessageSchema = z.object({
  id: z.string().uuid(),
  conversationId: z.string(),
  senderId: z.string(),
  recipientId: z.string().optional(),
  content: z.string(),
  timestamp: z.date(),
  type: z.enum(['text', 'image', 'video', 'audio', 'file']),
  encrypted: z.boolean(),
  ephemeral: z.boolean().default(false),
  ephemeralTimeout: z.number().optional(),
  readReceipts: z.array(z.object({
    userId: z.string(),
    timestamp: z.date(),
  })).default([]),
  reactions: z.array(z.object({
    userId: z.string(),
    emoji: z.string(),
    timestamp: z.date(),
  })).default([]),
});

export type Message = z.infer<typeof MessageSchema>;

export interface EncryptedMessage {
  id: string;
  conversationId: string;
  senderId: string;
  ciphertext: Uint8Array;
  ephemeralPublicKey?: Uint8Array;
  timestamp: Date;
  messageType: number;
}

export interface ConversationKeys {
  identityKey: Uint8Array;
  signedPreKey: Uint8Array;
  oneTimePreKey?: Uint8Array;
}

export interface Session {
  sessionId: string;
  remoteIdentityKey: Uint8Array;
  rootKey: Uint8Array;
  sendingChain: ChainKey;
  receivingChains: Map<string, ChainKey>;
  previousCounter: number;
  remoteRegistrationId: number;
}

export interface ChainKey {
  key: Uint8Array;
  index: number;
  messageKeys: Map<number, Uint8Array>;
}

export interface PreKeyBundle {
  registrationId: number;
  deviceId: number;
  preKeyId: number;
  preKey: Uint8Array;
  signedPreKeyId: number;
  signedPreKey: Uint8Array;
  signedPreKeySignature: Uint8Array;
  identityKey: Uint8Array;
}

export interface GroupSession {
  groupId: string;
  epoch: number;
  treeHash: Uint8Array;
  members: GroupMember[];
  pendingProposals: Proposal[];
}

export interface GroupMember {
  userId: string;
  keyPackage: Uint8Array;
  credential: Uint8Array;
  addedBy: string;
  addedAt: Date;
}

export interface Proposal {
  id: string;
  type: 'add' | 'remove' | 'update';
  proposer: string;
  target?: string;
  data?: Uint8Array;
  timestamp: Date;
}

export interface ISignalProtocolService {
  initializeSession(userId: string, preKeyBundle: PreKeyBundle): Promise<void>;
  encryptMessage(recipientId: string, message: string): Promise<EncryptedMessage>;
  decryptMessage(senderId: string, encrypted: EncryptedMessage): Promise<string>;
  generatePreKeyBundle(): Promise<PreKeyBundle>;
  rotateSignedPreKey(): Promise<void>;
}

export interface IMLSService {
  createGroup(groupId: string, members: string[]): Promise<GroupSession>;
  addMember(groupId: string, userId: string): Promise<void>;
  removeMember(groupId: string, userId: string): Promise<void>;
  encryptGroupMessage(groupId: string, message: string): Promise<EncryptedMessage>;
  decryptGroupMessage(groupId: string, encrypted: EncryptedMessage): Promise<string>;
  processProposal(groupId: string, proposal: Proposal): Promise<void>;
}

export interface IMessageEncryptionService {
  encryptMessage(message: Message, recipientId: string): Promise<EncryptedMessage>;
  decryptMessage(encrypted: EncryptedMessage): Promise<Message>;
  encryptGroupMessage(message: Message, groupId: string): Promise<EncryptedMessage>;
  decryptGroupMessage(encrypted: EncryptedMessage, groupId: string): Promise<Message>;
}

export interface IForwardSecrecyService {
  rotateKeys(sessionId: string): Promise<void>;
  deleteOldMessageKeys(sessionId: string, beforeIndex: number): Promise<void>;
  establishRatchet(sessionId: string, theirPublicKey: Uint8Array): Promise<void>;
}
