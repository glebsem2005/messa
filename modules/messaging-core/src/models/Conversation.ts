import { v4 as uuidv4 } from 'uuid';
import type { Message } from '../types';

export interface Conversation {
  id: string;
  type: 'direct' | 'group' | 'channel';
  name?: string;
  participants: string[];
  lastMessage?: Message;
  unreadCount: number;
  isPinned: boolean;
  isMuted: boolean;
  createdAt: Date;
  updatedAt: Date;
  metadata?: ConversationMetadata;
}

export interface ConversationMetadata {
  avatar?: string;
  description?: string;
  isEncrypted: boolean;
  encryptionType?: 'signal' | 'mls';
  ephemeralTimeout?: number;
  customNotificationSound?: string;
}

export class ConversationModel {
  static create(params: {
    type: Conversation['type'];
    name?: string;
    participants: string[];
    metadata?: Partial<ConversationMetadata>;
  }): Conversation {
    return {
      id: uuidv4(),
      type: params.type,
      name: params.name,
      participants: params.participants,
      unreadCount: 0,
      isPinned: false,
      isMuted: false,
      createdAt: new Date(),
      updatedAt: new Date(),
      metadata: {
        isEncrypted: true,
        encryptionType: params.type === 'direct' ? 'signal' : 'mls',
        ...params.metadata,
      },
    };
  }

  static updateLastMessage(conversation: Conversation, message: Message): Conversation {
    return {
      ...conversation,
      lastMessage: message,
      updatedAt: new Date(),
    };
  }

  static incrementUnread(conversation: Conversation): Conversation {
    return {
      ...conversation,
      unreadCount: conversation.unreadCount + 1,
    };
  }

  static markAsRead(conversation: Conversation): Conversation {
    return {
      ...conversation,
      unreadCount: 0,
    };
  }

  static togglePin(conversation: Conversation): Conversation {
    return {
      ...conversation,
      isPinned: !conversation.isPinned,
    };
  }

  static toggleMute(conversation: Conversation): Conversation {
    return {
      ...conversation,
      isMuted: !conversation.isMuted,
    };
  }

  static addParticipant(conversation: Conversation, userId: string): Conversation {
    if (conversation.participants.includes(userId)) {
      return conversation;
    }

    return {
      ...conversation,
      participants: [...conversation.participants, userId],
      updatedAt: new Date(),
    };
  }

  static removeParticipant(conversation: Conversation, userId: string): Conversation {
    return {
      ...conversation,
      participants: conversation.participants.filter(p => p !== userId),
      updatedAt: new Date(),
    };
  }

  static getDisplayName(conversation: Conversation, currentUserId: string): string {
    if (conversation.name) {
      return conversation.name;
    }

    if (conversation.type === 'direct') {
      // Для прямых чатов показываем имя собеседника
      const otherParticipant = conversation.participants.find(p => p !== currentUserId);
      return otherParticipant || 'Неизвестный пользователь';
    }

    // Для групп без названия показываем список участников
    const otherParticipants = conversation.participants.filter(p => p !== currentUserId);
    return otherParticipants.slice(0, 3).join(', ') + 
      (otherParticipants.length > 3 ? ` +${otherParticipants.length - 3}` : '');
  }

  static sortByActivity(conversations: Conversation[]): Conversation[] {
    return [...conversations].sort((a, b) => {
      // Закрепленные чаты всегда сверху
      if (a.isPinned && !b.isPinned) return -1;
      if (!a.isPinned && b.isPinned) return 1;

      // Сортировка по времени последнего сообщения
      const aTime = a.lastMessage?.timestamp.getTime() || a.updatedAt.getTime();
      const bTime = b.lastMessage?.timestamp.getTime() || b.updatedAt.getTime();
      
      return bTime - aTime;
    });
  }

  static filterBySearch(conversations: Conversation[], query: string): Conversation[] {
    const lowerQuery = query.toLowerCase();
    
    return conversations.filter(conv => {
      // Поиск по названию
      if (conv.name?.toLowerCase().includes(lowerQuery)) {
        return true;
      }

      // Поиск по последнему сообщению
      if (conv.lastMessage?.content.toLowerCase().includes(lowerQuery)) {
        return true;
      }

      // Поиск по участникам
      return conv.participants.some(p => p.toLowerCase().includes(lowerQuery));
    });
  }

  static getUnreadCount(conversations: Conversation[]): number {
    return conversations.reduce((total, conv) => {
      return total + (conv.isMuted ? 0 : conv.unreadCount);
    }, 0);
  }
}
