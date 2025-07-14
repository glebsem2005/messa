import { v4 as uuidv4 } from 'uuid';
import { z } from 'zod';
import type { Message } from '../types';

export class MessageModel {
  static create(params: {
    conversationId: string;
    senderId: string;
    recipientId?: string;
    content: string;
    type?: Message['type'];
    ephemeral?: boolean;
    ephemeralTimeout?: number;
  }): Message {
    return {
      id: uuidv4(),
      conversationId: params.conversationId,
      senderId: params.senderId,
      recipientId: params.recipientId,
      content: params.content,
      timestamp: new Date(),
      type: params.type || 'text',
      encrypted: true,
      ephemeral: params.ephemeral || false,
      ephemeralTimeout: params.ephemeralTimeout,
      readReceipts: [],
      reactions: [],
    };
  }

  static validate(message: any): Message {
    const MessageSchema = z.object({
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

    return MessageSchema.parse(message);
  }

  static addReadReceipt(message: Message, userId: string): Message {
    // Проверка, что квитанция еще не добавлена
    const existingReceipt = message.readReceipts.find(r => r.userId === userId);
    if (existingReceipt) {
      return message;
    }

    return {
      ...message,
      readReceipts: [
        ...message.readReceipts,
        {
          userId,
          timestamp: new Date(),
        },
      ],
    };
  }

  static addReaction(message: Message, userId: string, emoji: string): Message {
    // Удаление предыдущей реакции пользователя
    const filteredReactions = message.reactions.filter(r => r.userId !== userId);

    return {
      ...message,
      reactions: [
        ...filteredReactions,
        {
          userId,
          emoji,
          timestamp: new Date(),
        },
      ],
    };
  }

  static removeReaction(message: Message, userId: string): Message {
    return {
      ...message,
      reactions: message.reactions.filter(r => r.userId !== userId),
    };
  }

  static isExpired(message: Message): boolean {
    if (!message.ephemeral || !message.ephemeralTimeout) {
      return false;
    }

    const expirationTime = message.timestamp.getTime() + message.ephemeralTimeout;
    return Date.now() > expirationTime;
  }

  static sanitizeContent(content: string): string {
    // Базовая санитизация контента
    return content
      .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
      .replace(/<iframe\b[^<]*(?:(?!<\/iframe>)<[^<]*)*<\/iframe>/gi, '')
      .trim();
  }

  static formatForDisplay(message: Message): {
    displayContent: string;
    formattedTime: string;
    isEdited: boolean;
  } {
    let displayContent = message.content;

    // Обработка разных типов сообщений
    switch (message.type) {
      case 'image':
        displayContent = '📷 Изображение';
        break;
      case 'video':
        displayContent = '🎥 Видео';
        break;
      case 'audio':
        displayContent = '🎵 Аудио';
        break;
      case 'file':
        displayContent = '📎 Файл';
        break;
    }

    // Форматирование времени
    const now = new Date();
    const messageDate = new Date(message.timestamp);
    const isToday = messageDate.toDateString() === now.toDateString();
    
    const formattedTime = isToday
      ? messageDate.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })
      : messageDate.toLocaleDateString('ru-RU', { 
          day: 'numeric', 
          month: 'short', 
          hour: '2-digit', 
          minute: '2-digit' 
        });

    return {
      displayContent,
      formattedTime,
      isEdited: false, // В будущем можно добавить поддержку редактирования
    };
  }

  static groupByDate(messages: Message[]): Map<string, Message[]> {
    const grouped = new Map<string, Message[]>();

    messages.forEach(message => {
      const date = new Date(message.timestamp).toDateString();
      const existing = grouped.get(date) || [];
      grouped.set(date, [...existing, message]);
    });

    return grouped;
  }
}
