import { MessageDto } from './messages';
import { PresenceStatus } from './enums';

/** Events emitted client -> server */
export enum WsClientEvent {
  MessageSend = 'message:send',
  MessageEdit = 'message:edit',
  MessageDelete = 'message:delete',
  TypingStart = 'typing:start',
  TypingStop = 'typing:stop',
  ReceiptRead = 'receipt:read',
  ReactionAdd = 'reaction:add',
  ReactionRemove = 'reaction:remove',
  ChannelSync = 'channel:sync', // client asks server to replay from lastSeq
}

/** Events emitted server -> client */
export enum WsServerEvent {
  MessageNew = 'message:new',
  MessageEdited = 'message:edited',
  MessageDeleted = 'message:deleted',
  TypingUpdate = 'typing:update',
  PresenceUpdate = 'presence:update',
  ReceiptUpdate = 'receipt:update',
  ReactionUpdate = 'reaction:update',
  SyncResult = 'channel:sync:result',
  Error = 'error',
}

export interface WsAck<T = unknown> {
  ok: boolean;
  data?: T;
  error?: string;
}

export interface TypingUpdatePayload {
  channelId: string;
  userId: string;
  isTyping: boolean;
}

export interface PresenceUpdatePayload {
  userId: string;
  status: PresenceStatus;
  lastSeenAt: string;
}

export interface ReceiptUpdatePayload {
  channelId: string;
  userId: string;
  seq: number;
}

export interface ReactionUpdatePayload {
  messageId: string;
  channelId: string;
  emoji: string;
  userId: string;
  added: boolean;
}

export interface ChannelSyncRequest {
  channelId: string;
  lastSeq: number;
}

export interface ChannelSyncResult {
  channelId: string;
  messages: MessageDto[];
  latestSeq: number;
}
