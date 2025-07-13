import sodium from 'libsodium-wrappers';
import { v4 as uuidv4 } from 'uuid';
import { QuantumResistantCrypto } from '@messa/crypto-layer';
import type { 
  IMLSService, 
  GroupSession, 
  GroupMember, 
  Proposal, 
  EncryptedMessage 
} from '../types';

export class MLSService implements IMLSService {
  private groups: Map<string, GroupSession> = new Map();
  private keyPackages: Map<string, Uint8Array> = new Map();
  private credentials: Map<string, Uint8Array> = new Map();
  private qrc: QuantumResistantCrypto;
  private userId: string;

  constructor(userId: string) {
    this.userId = userId;
    this.qrc = new QuantumResistantCrypto();
  }

  async initialize(): Promise<void> {
    await sodium.ready;
    await this.qrc.initialize();
    
    // Генерация начального key package
    const keyPackage = await this.generateKeyPackage();
    this.keyPackages.set(this.userId, keyPackage);
    
    // Генерация credential
    const credential = await this.generateCredential();
    this.credentials.set(this.userId, credential);
  }

  async createGroup(groupId: string, memberIds: string[]): Promise<GroupSession> {
    if (this.groups.has(groupId)) {
      throw new Error('Group already exists');
    }

    // Создание начального состояния группы
    const members: GroupMember[] = [];
    
    // Добавление создателя
    members.push({
      userId: this.userId,
      keyPackage: this.keyPackages.get(this.userId)!,
      credential: this.credentials.get(this.userId)!,
      addedBy: this.userId,
      addedAt: new Date(),
    });

    // Добавление остальных участников
    for (const memberId of memberIds) {
      if (memberId === this.userId) continue;
      
      const keyPackage = await this.fetchKeyPackage(memberId);
      const credential = await this.fetchCredential(memberId);
      
      members.push({
        userId: memberId,
        keyPackage,
        credential,
        addedBy: this.userId,
        addedAt: new Date(),
      });
    }

    // Создание дерева ratchet tree
    const treeHash = await this.computeTreeHash(members);

    const groupSession: GroupSession = {
      groupId,
      epoch: 0,
      treeHash,
      members,
      pendingProposals: [],
    };

    this.groups.set(groupId, groupSession);
    
    // Отправка welcome сообщений новым участникам
    await this.sendWelcomeMessages(groupSession, memberIds);
    
    return groupSession;
  }

  async addMember(groupId: string, userId: string): Promise<void> {
    const group = this.groups.get(groupId);
    if (!group) {
      throw new Error('Group not found');
    }

    // Проверка, что пользователь еще не в группе
    if (group.members.some(m => m.userId === userId)) {
      throw new Error('User already in group');
    }

    // Создание proposal для добавления
    const proposal: Proposal = {
      id: uuidv4(),
      type: 'add',
      proposer: this.userId,
      target: userId,
      data: await this.fetchKeyPackage(userId),
      timestamp: new Date(),
    };

    group.pendingProposals.push(proposal);
    
    // Автоматическое применение proposal (в реальной системе может требовать консенсус)
    await this.processProposal(groupId, proposal);
  }

  async removeMember(groupId: string, userId: string): Promise<void> {
    const group = this.groups.get(groupId);
    if (!group) {
      throw new Error('Group not found');
    }

    // Создание proposal для удаления
    const proposal: Proposal = {
      id: uuidv4(),
      type: 'remove',
      proposer: this.userId,
      target: userId,
      timestamp: new Date(),
    };

    group.pendingProposals.push(proposal);
    await this.processProposal(groupId, proposal);
  }

  async encryptGroupMessage(groupId: string, message: string): Promise<EncryptedMessage> {
    const group = this.groups.get(groupId);
    if (!group) {
      throw new Error('Group not found');
    }

    // Получение группового ключа для текущей эпохи
    const groupKey = await this.deriveGroupKey(group);
    
    // Шифрование сообщения
    const messageBytes = new TextEncoder().encode(message);
    const nonce = sodium.randombytes_buf(sodium.crypto_aead_chacha20poly1305_ietf_NPUBBYTES);
    
    // Добавление аутентифицированных данных (epoch, sender)
    const aad = new TextEncoder().encode(JSON.stringify({
      epoch: group.epoch,
      sender: this.userId,
      timestamp: Date.now(),
    }));
    
    const ciphertext = sodium.crypto_aead_chacha20poly1305_ietf_encrypt(
      messageBytes,
      aad,
      null,
      nonce,
      groupKey
    );

    // Объединение nonce, aad length, aad и ciphertext
    const aadLengthBuffer = new ArrayBuffer(4);
    new DataView(aadLengthBuffer).setUint32(0, aad.length, false);
    
    const encryptedData = new Uint8Array(
      nonce.length + 4 + aad.length + ciphertext.length
    );
    
    let offset = 0;
    encryptedData.set(nonce, offset);
    offset += nonce.length;
    
    encryptedData.set(new Uint8Array(aadLengthBuffer), offset);
    offset += 4;
    
    encryptedData.set(aad, offset);
    offset += aad.length;
    
    encryptedData.set(ciphertext, offset);

    return {
      id: uuidv4(),
      conversationId: groupId,
      senderId: this.userId,
      ciphertext: encryptedData,
      timestamp: new Date(),
      messageType: 2, // Group message
    };
  }

  async decryptGroupMessage(groupId: string, encrypted: EncryptedMessage): Promise<string> {
    const group = this.groups.get(groupId);
    if (!group) {
      throw new Error('Group not found');
    }

    // Извлечение компонентов
    const nonceLength = sodium.crypto_aead_chacha20poly1305_ietf_NPUBBYTES;
    let offset = 0;
    
    const nonce = encrypted.ciphertext.slice(offset, offset + nonceLength);
    offset += nonceLength;
    
    const aadLength = new DataView(
      encrypted.ciphertext.buffer,
      encrypted.ciphertext.byteOffset + offset
    ).getUint32(0, false);
    offset += 4;
    
    const aad = encrypted.ciphertext.slice(offset, offset + aadLength);
    offset += aadLength;
    
    const ciphertext = encrypted.ciphertext.slice(offset);

    // Проверка эпохи из AAD
    const aadData = JSON.parse(new TextDecoder().decode(aad));
    if (aadData.epoch !== group.epoch) {
      throw new Error('Message from different epoch');
    }

    // Получение группового ключа
    const groupKey = await this.deriveGroupKey(group);
    
    // Расшифровка
    const decrypted = sodium.crypto_aead_chacha20poly1305_ietf_decrypt(
      null,
      ciphertext,
      aad,
      nonce,
      groupKey
    );

    return new TextDecoder().decode(decrypted);
  }

  async processProposal(groupId: string, proposal: Proposal): Promise<void> {
    const group = this.groups.get(groupId);
    if (!group) {
      throw new Error('Group not found');
    }

    switch (proposal.type) {
      case 'add':
        if (!proposal.target || !proposal.data) {
          throw new Error('Invalid add proposal');
        }
        
        // Добавление нового участника
        const credential = await this.fetchCredential(proposal.target);
        group.members.push({
          userId: proposal.target,
          keyPackage: proposal.data,
          credential,
          addedBy: proposal.proposer,
          addedAt: new Date(),
        });
        
        // Обновление эпохи
        await this.updateEpoch(group);
        
        // Отправка welcome сообщения
        await this.sendWelcomeMessages(group, [proposal.target]);
        break;

      case 'remove':
        if (!proposal.target) {
          throw new Error('Invalid remove proposal');
        }
        
        // Удаление участника
        group.members = group.members.filter(m => m.userId !== proposal.target);
        
        // Обновление эпохи
        await this.updateEpoch(group);
        break;

      case 'update':
        // Обновление key package участника
        const memberIndex = group.members.findIndex(
          m => m.userId === proposal.proposer
        );
        
        if (memberIndex >= 0 && proposal.data) {
          group.members[memberIndex].keyPackage = proposal.data;
          await this.updateEpoch(group);
        }
        break;
    }

    // Удаление обработанного proposal
    group.pendingProposals = group.pendingProposals.filter(p => p.id !== proposal.id);
  }

  private async generateKeyPackage(): Promise<Uint8Array> {
    // Генерация ключей для MLS
    const keys = await this.qrc.generateQuantumSafeKeyPair();
    
    // Создание key package
    const keyPackage = {
      version: 1,
      cipherSuite: 'MESSA_MLS_128_DHKEMX25519_AES128GCM_SHA256_Ed25519',
      initKey: Array.from(keys.encryption.publicKey),
      leafNode: {
        encryptionKey: Array.from(keys.encryption.publicKey),
        signatureKey: Array.from(keys.signing.publicKey),
        credential: Array.from(this.credentials.get(this.userId) || new Uint8Array()),
        capabilities: ['mls10', 'psk', 'removal'],
        lifetime: {
          notBefore: Date.now(),
          notAfter: Date.now() + 30 * 24 * 60 * 60 * 1000, // 30 дней
        },
      },
      extensions: [],
    };

    // Подпись key package
    const serialized = new TextEncoder().encode(JSON.stringify(keyPackage));
    const signature = await this.qrc.quantumSafeSign(serialized, keys.signing.privateKey);
    
    // Объединение package и подписи
    const result = new Uint8Array(serialized.length + signature.length + 4);
    const view = new DataView(result.buffer);
    
    view.setUint32(0, serialized.length, false);
    result.set(serialized, 4);
    result.set(signature, 4 + serialized.length);
    
    return result;
  }

  private async generateCredential(): Promise<Uint8Array> {
    // Credential содержит идентификационную информацию
    const credential = {
      credentialType: 'basic',
      identity: this.userId,
      timestamp: Date.now(),
    };

    return new TextEncoder().encode(JSON.stringify(credential));
  }

  private async fetchKeyPackage(userId: string): Promise<Uint8Array> {
    // В реальной системе это запрос к серверу или DHT
    // Для примера генерируем случайный
    return crypto.getRandomValues(new Uint8Array(256));
  }

  private async fetchCredential(userId: string): Promise<Uint8Array> {
    // В реальной системе это запрос к серверу или DHT
    const credential = {
      credentialType: 'basic',
      identity: userId,
      timestamp: Date.now(),
    };

    return new TextEncoder().encode(JSON.stringify(credential));
  }

  private async computeTreeHash(members: GroupMember[]): Promise<Uint8Array> {
    // Вычисление хеша дерева Ratchet Tree
    const leaves = members.map(m => m.keyPackage);
    
    if (leaves.length === 0) {
      return new Uint8Array(32);
    }

    // Построение дерева Меркла
    let currentLevel = leaves;
    
    while (currentLevel.length > 1) {
      const nextLevel: Uint8Array[] = [];
      
      for (let i = 0; i < currentLevel.length; i += 2) {
        if (i + 1 < currentLevel.length) {
          const combined = new Uint8Array(
            currentLevel[i].length + currentLevel[i + 1].length
          );
          combined.set(currentLevel[i]);
          combined.set(currentLevel[i + 1], currentLevel[i].length);
          
          const hash = sodium.crypto_generichash(32, combined);
          nextLevel.push(hash);
        } else {
          nextLevel.push(currentLevel[i]);
        }
      }
      
      currentLevel = nextLevel;
    }

    return currentLevel[0];
  }

  private async deriveGroupKey(group: GroupSession): Promise<Uint8Array> {
    // Вывод группового ключа из tree hash и epoch
    const context = new TextEncoder().encode(
      `MESSA_GROUP_KEY:${group.groupId}:${group.epoch}`
    );
    
    const combined = new Uint8Array(group.treeHash.length + context.length);
    combined.set(group.treeHash);
    combined.set(context, group.treeHash.length);
    
    return sodium.crypto_kdf_derive_from_key(
      32,
      group.epoch,
      'GROUPKEY',
      sodium.crypto_generichash(32, combined)
    );
  }

  private async updateEpoch(group: GroupSession): Promise<void> {
    // Увеличение эпохи
    group.epoch++;
    
    // Пересчет tree hash
    group.treeHash = await this.computeTreeHash(group.members);
    
    // Уведомление всех участников об обновлении
    // В реальной системе здесь отправляются commit сообщения
  }

  private async sendWelcomeMessages(group: GroupSession, newMembers: string[]): Promise<void> {
    // Отправка welcome сообщений новым участникам
    // Welcome содержит групповые секреты и состояние дерева
    
    for (const memberId of newMembers) {
      if (memberId === this.userId) continue;
      
      const welcomeData = {
        groupId: group.groupId,
        epoch: group.epoch,
        treeHash: Array.from(group.treeHash),
        members: group.members.map(m => ({
          userId: m.userId,
          keyPackage: Array.from(m.keyPackage),
        })),
        groupSecrets: await this.exportGroupSecrets(group),
      };
      
      // Шифрование welcome для конкретного получателя
      // В реальной системе используется ключ из key package получателя
      const encrypted = await this.qrc.hybridEncrypt(
        new TextEncoder().encode(JSON.stringify(welcomeData)),
        crypto.getRandomValues(new Uint8Array(32)) // Заглушка для публичного ключа
      );
      
      // Отправка welcome (в реальной системе через сеть)
      console.log(`Welcome message for ${memberId}:`, encrypted);
    }
  }

  private async exportGroupSecrets(group: GroupSession): Promise<any> {
    // Экспорт групповых секретов для welcome сообщения
    return {
      epochSecret: Array.from(crypto.getRandomValues(new Uint8Array(32))),
      confirmationKey: Array.from(crypto.getRandomValues(new Uint8Array(32))),
      membershipKey: Array.from(crypto.getRandomValues(new Uint8Array(32))),
    };
  }
}
