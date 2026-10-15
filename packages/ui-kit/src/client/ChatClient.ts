import { v4 as uuid } from 'uuid';
import { io, Socket } from 'socket.io-client';
import {
  AttachmentViewUrl,
  ChannelDto,
  ChannelMemberDto,
  ChannelMemberRole,
  ChannelSyncResult,
  CreateChannelInput,
  DevicePlatform,
  DmBlockStatusDto,
  MessageDto,
  PresenceStatus,
  ReactionUpdatePayload,
  ReadReceiptDto,
  ReceiptUpdatePayload,
  RequestUploadResult,
  TenantMemberDto,
  TypingUpdatePayload,
  WsAck,
  WsClientEvent,
  WsServerEvent,
} from '@qennect/shared-types';
import { TypedEmitter } from './emitter';
import { ChatStorage } from './storage';
import { ChatClientConfig, ChatClientEvents, ConnectionState, LocalMessage } from './types';

const RECONNECT_BASE_DELAY_MS = 1000;
const RECONNECT_MAX_DELAY_MS = 30000;
const SEND_ACK_TIMEOUT_MS = 8000;

interface QueuedSend {
  clientMsgId: string;
  channelId: string;
  body: string;
  parentId?: string;
  attachmentIds: string[];
  createdAt: string;
}

/** Core chat SDK client: REST + WebSocket, reconnect/backoff, optimistic send with
 *  clientMsgId-keyed reconciliation, per-channel seq-cursor resync on reconnect, and a
 *  persisted outgoing queue so unsent messages survive an app restart. */
export class ChatClient {
  private readonly emitter = new TypedEmitter<ChatClientEvents>();
  private readonly storage: ChatStorage;
  private socket: Socket | null = null;
  private connectionState: ConnectionState = 'disconnected';
  private reconnectAttempt = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private manuallyDisconnected = false;

  private channels: ChannelDto[] = [];
  private messagesByChannel = new Map<string, LocalMessage[]>();
  private lastSeqByChannel = new Map<string, number>();
  private outgoingQueue: QueuedSend[] = [];
  private attachmentUrlCache = new Map<string, { url: string; expiresAt: number }>();

  constructor(private readonly config: ChatClientConfig) {
    this.storage = new ChatStorage(config.storageNamespace ?? config.tenantId);
  }

  on<K extends keyof ChatClientEvents>(event: K, handler: ChatClientEvents[K]): () => void {
    return this.emitter.on(event, handler);
  }

  getConnectionState(): ConnectionState {
    return this.connectionState;
  }

  get userId(): string {
    return this.config.userId;
  }

  getCachedChannels(): ChannelDto[] {
    return this.channels;
  }

  getCachedMessages(channelId: string): LocalMessage[] {
    return this.messagesByChannel.get(channelId) ?? [];
  }

  async connect(): Promise<void> {
    this.manuallyDisconnected = false;
    await this.hydrateFromCache();
    await this.openSocket();
  }

  disconnect(): void {
    this.manuallyDisconnected = true;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.socket?.disconnect();
    this.socket = null;
    this.setConnectionState('disconnected');
  }

  // ---------------------------------------------------------------------------------------
  // REST
  // ---------------------------------------------------------------------------------------

  async listChannels(): Promise<ChannelDto[]> {
    const channels = await this.request<ChannelDto[]>('GET', '/channels');
    this.channels = channels;
    await this.storage.setJson('channels', channels);
    this.emitter.emit('channelsUpdated', channels);
    return channels;
  }

  async createChannel(input: CreateChannelInput): Promise<ChannelDto> {
    const channel = await this.request<ChannelDto>('POST', '/channels', input);
    this.channels = [channel, ...this.channels.filter((c) => c.id !== channel.id)];
    await this.storage.setJson('channels', this.channels);
    this.emitter.emit('channelsUpdated', this.channels);
    return channel;
  }

  /** Tenant members available to start a 1:1 chat or add to a new group with — backs the
   *  "New chat" / "New group" contact picker. Not cached: fetched fresh each time it's used. */
  async listTenantMembers(): Promise<TenantMemberDto[]> {
    return this.request<TenantMemberDto[]>('GET', '/tenancy/members');
  }

  async listChannelMembers(channelId: string): Promise<ChannelMemberDto[]> {
    return this.request<ChannelMemberDto[]>('GET', `/channels/${channelId}/members`);
  }

  async updateChannelMemberRole(channelId: string, userId: string, role: ChannelMemberRole): Promise<ChannelMemberDto> {
    return this.request<ChannelMemberDto>('PATCH', `/channels/${channelId}/members/${userId}`, { role });
  }

  async removeChannelMember(channelId: string, userId: string): Promise<void> {
    await this.request<void>('DELETE', `/channels/${channelId}/members/${userId}`);
  }

  async deleteChannel(channelId: string): Promise<void> {
    await this.request<void>('DELETE', `/channels/${channelId}`);
    this.channels = this.channels.filter((c) => c.id !== channelId);
    await this.storage.setJson('channels', this.channels);
    this.emitter.emit('channelsUpdated', this.channels);
  }

  /** Current read position of every member who has read at least one message — call once on
   *  opening a channel to seed ticks for messages read before this session started; live
   *  updates after that arrive via the 'readReceipt' event. */
  async listReadReceipts(channelId: string): Promise<ReadReceiptDto[]> {
    return this.request<ReadReceiptDto[]>('GET', `/messages/receipts?channelId=${channelId}`);
  }

  /** Self-service — either participant in a DM may block the other with no special role.
   *  Blocking someone stops *them* from sending to you; it does not stop you from sending. */
  async blockInDm(channelId: string): Promise<void> {
    await this.request<void>('POST', `/channels/${channelId}/block`);
  }

  async unblockInDm(channelId: string): Promise<void> {
    await this.request<void>('DELETE', `/channels/${channelId}/block`);
  }

  async getDmBlockStatus(channelId: string): Promise<DmBlockStatusDto> {
    return this.request<DmBlockStatusDto>('GET', `/channels/${channelId}/block-status`);
  }

  /** Registering a push token, listening for messages, and reading the tap-to-deep-link data
   *  payload is the host app's job (same split as image picking — see Composer's doc comment):
   *  this SDK stays push-library-agnostic rather than hard-depending on
   *  @react-native-firebase/messaging or expo-notifications. Call this once you have a fresh
   *  FCM token (on launch, and again whenever the OS reissues one); re-registering the same
   *  token is a safe no-op upsert. */
  async registerDeviceToken(token: string, platform: DevicePlatform): Promise<void> {
    await this.request<void>('POST', '/push/device-tokens', { token, platform });
  }

  /** Call on logout so a signed-out device stops receiving push for the account it just left. */
  async unregisterDeviceToken(token: string): Promise<void> {
    await this.request<void>('DELETE', `/push/device-tokens/${encodeURIComponent(token)}`);
  }

  async loadMessages(channelId: string, cursor?: number): Promise<LocalMessage[]> {
    const query = cursor !== undefined ? `?channelId=${channelId}&cursor=${cursor}` : `?channelId=${channelId}`;
    const messages = await this.request<MessageDto[]>('GET', `/messages${query}`);
    const merged = this.mergeMessages(channelId, messages);
    return merged;
  }

  // ---------------------------------------------------------------------------------------
  // Sending (optimistic + idempotent + queued)
  // ---------------------------------------------------------------------------------------

  async sendMessage(channelId: string, body: string, parentId?: string, attachmentIds: string[] = []): Promise<void> {
    const clientMsgId = uuid();
    const optimistic: LocalMessage = {
      id: `local:${clientMsgId}`,
      tenantId: this.config.tenantId,
      channelId,
      authorId: this.config.userId,
      clientMsgId,
      seq: -1,
      body,
      parentId: parentId ?? null,
      editedAt: null,
      deletedAt: null,
      createdAt: new Date().toISOString(),
      reactions: [],
      attachments: [],
      quoted: null,
      mentionedUserIds: [],
      pending: true,
    };
    this.appendLocalMessage(channelId, optimistic);

    const queued: QueuedSend = {
      clientMsgId,
      channelId,
      body,
      parentId,
      attachmentIds,
      createdAt: optimistic.createdAt,
    };
    this.outgoingQueue.push(queued);
    await this.persistQueue();

    await this.trySend(queued);
  }

  /** Uploads an image (or any file) to storage and returns its attachmentId, ready to pass to
   *  `sendMessage`'s `attachmentIds`. Picking the file is the host app's responsibility — this
   *  SDK stays platform-picker-agnostic (see Composer's `onPickImage` prop). */
  async uploadAttachment(file: { uri: string; fileName: string; mimeType: string; sizeBytes: number }): Promise<string> {
    const { attachmentId, uploadUrl } = await this.request<RequestUploadResult>('POST', '/attachments/upload-url', {
      fileName: file.fileName,
      mimeType: file.mimeType,
      sizeBytes: file.sizeBytes,
    });

    const fileResponse = await fetch(file.uri);
    const blob = await fileResponse.blob();
    const putResponse = await fetch(uploadUrl, {
      method: 'PUT',
      headers: { 'Content-Type': file.mimeType },
      body: blob,
    });
    if (!putResponse.ok) throw new Error(`Upload failed: ${putResponse.status}`);

    return attachmentId;
  }

  /** Presigned view URLs expire; memoized per attachment id and re-fetched once stale. */
  async getAttachmentViewUrl(attachmentId: string): Promise<string> {
    const cached = this.attachmentUrlCache.get(attachmentId);
    if (cached && cached.expiresAt > Date.now()) return cached.url;

    const result = await this.request<AttachmentViewUrl>('GET', `/attachments/${attachmentId}`);
    this.attachmentUrlCache.set(attachmentId, {
      url: result.url,
      expiresAt: Date.now() + (result.expiresInSeconds - 30) * 1000, // refresh a bit early
    });
    return result.url;
  }

  async retryMessage(channelId: string, clientMsgId: string): Promise<void> {
    const queued = this.outgoingQueue.find((q) => q.clientMsgId === clientMsgId && q.channelId === channelId);
    if (!queued) return;
    this.updateLocalMessage(channelId, clientMsgId, { failed: false, pending: true });
    await this.trySend(queued);
  }

  private async trySend(queued: QueuedSend): Promise<void> {
    if (!this.socket?.connected) return; // will flush on (re)connect

    const ack = await this.emitWithAck<WsAck<MessageDto>>(WsClientEvent.MessageSend, {
      clientMsgId: queued.clientMsgId,
      channelId: queued.channelId,
      body: queued.body,
      parentId: queued.parentId,
      attachmentIds: queued.attachmentIds,
    });

    if (ack?.ok && ack.data) {
      this.reconcileMessage(queued.channelId, ack.data);
      this.removeFromQueue(queued.clientMsgId);
    } else {
      this.updateLocalMessage(queued.channelId, queued.clientMsgId, { pending: false, failed: true });
    }
  }

  private async flushOutgoingQueue(): Promise<void> {
    for (const queued of [...this.outgoingQueue]) {
      await this.trySend(queued);
    }
  }

  private async removeFromQueue(clientMsgId: string): Promise<void> {
    this.outgoingQueue = this.outgoingQueue.filter((q) => q.clientMsgId !== clientMsgId);
    await this.persistQueue();
  }

  private async persistQueue(): Promise<void> {
    await this.storage.setJson('outgoingQueue', this.outgoingQueue);
  }

  // ---------------------------------------------------------------------------------------
  // Other actions
  // ---------------------------------------------------------------------------------------

  setTyping(channelId: string, isTyping: boolean): void {
    this.socket?.emit(isTyping ? WsClientEvent.TypingStart : WsClientEvent.TypingStop, { channelId });
  }

  async markRead(channelId: string, seq: number): Promise<void> {
    await this.emitWithAck(WsClientEvent.ReceiptRead, { channelId, seq });
  }

  async toggleReaction(messageId: string, emoji: string): Promise<void> {
    await this.emitWithAck(WsClientEvent.ReactionAdd, { messageId, emoji });
  }

  // ---------------------------------------------------------------------------------------
  // Socket lifecycle
  // ---------------------------------------------------------------------------------------

  private async openSocket(): Promise<void> {
    this.setConnectionState(this.reconnectAttempt > 0 ? 'reconnecting' : 'connecting');
    const token = await this.config.getAccessToken();

    this.socket = io(this.config.wsUrl ?? this.config.baseUrl, {
      auth: { token },
      transports: ['websocket'],
      reconnection: false, // we drive reconnect ourselves for full control over resync order
      path: this.config.socketPath ?? '/socket.io',
    });

    this.socket.on('connect', () => this.handleConnected());
    this.socket.on('disconnect', () => this.handleDisconnected());
    this.socket.on('connect_error', () => this.handleDisconnected());

    this.socket.on(WsServerEvent.MessageNew, (message: MessageDto) => this.reconcileMessage(message.channelId, message));
    this.socket.on(WsServerEvent.MessageEdited, (message: MessageDto) => this.reconcileMessage(message.channelId, message));
    this.socket.on(WsServerEvent.MessageDeleted, (message: MessageDto) => this.reconcileMessage(message.channelId, message));
    this.socket.on(WsServerEvent.TypingUpdate, (payload: TypingUpdatePayload) => {
      this.emitter.emit('typing', payload.channelId, payload.userId, payload.isTyping);
    });
    this.socket.on(WsServerEvent.PresenceUpdate, (payload: { userId: string; status: PresenceStatus; lastSeenAt: string }) => {
      this.emitter.emit('presence', payload.userId, payload.status, payload.lastSeenAt);
    });
    this.socket.on(WsServerEvent.ReceiptUpdate, (payload: ReceiptUpdatePayload) => {
      this.emitter.emit('readReceipt', payload.channelId, payload.userId, payload.seq);
    });
    this.socket.on(WsServerEvent.ReactionUpdate, (payload: ReactionUpdatePayload) => {
      // Reaction counts are refetched lazily by the UI (re-list messages); this event is
      // primarily a "something changed" signal for the conversation screen to re-render.
      void payload;
    });
  }

  private async handleConnected(): Promise<void> {
    this.reconnectAttempt = 0;
    this.setConnectionState('connected');
    await this.resyncAllChannels();
    await this.flushOutgoingQueue();
  }

  private handleDisconnected(): void {
    if (this.manuallyDisconnected) return;
    this.setConnectionState('disconnected');
    this.scheduleReconnect();
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer) return;
    const delay = Math.min(RECONNECT_BASE_DELAY_MS * 2 ** this.reconnectAttempt, RECONNECT_MAX_DELAY_MS);
    this.reconnectAttempt += 1;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      if (!this.manuallyDisconnected) this.openSocket();
    }, delay);
  }

  private async resyncAllChannels(): Promise<void> {
    for (const [channelId, lastSeq] of this.lastSeqByChannel.entries()) {
      const ack = await this.emitWithAck<WsAck<ChannelSyncResult>>(WsClientEvent.ChannelSync, {
        channelId,
        lastSeq,
      });
      if (ack?.ok && ack.data) {
        this.mergeMessages(channelId, ack.data.messages);
        this.lastSeqByChannel.set(channelId, ack.data.latestSeq);
      }
    }
  }

  private emitWithAck<T>(event: string, payload: unknown): Promise<T | undefined> {
    const socket = this.socket;
    return new Promise((resolve) => {
      if (!socket?.connected) return resolve(undefined);
      const timeout = setTimeout(() => resolve(undefined), SEND_ACK_TIMEOUT_MS);
      socket.emit(event, payload, (ack: T) => {
        clearTimeout(timeout);
        resolve(ack);
      });
    });
  }

  // ---------------------------------------------------------------------------------------
  // Local state helpers
  // ---------------------------------------------------------------------------------------

  private async hydrateFromCache(): Promise<void> {
    const [channels, queue] = await Promise.all([
      this.storage.getJson<ChannelDto[]>('channels'),
      this.storage.getJson<QueuedSend[]>('outgoingQueue'),
    ]);
    if (channels) {
      this.channels = channels;
      this.emitter.emit('channelsUpdated', channels);
    }
    if (queue) {
      this.outgoingQueue = queue;
      for (const q of queue) {
        this.appendLocalMessage(q.channelId, {
          id: `local:${q.clientMsgId}`,
          tenantId: this.config.tenantId,
          channelId: q.channelId,
          authorId: this.config.userId,
          clientMsgId: q.clientMsgId,
          seq: -1,
          body: q.body,
          parentId: q.parentId ?? null,
          editedAt: null,
          deletedAt: null,
          createdAt: q.createdAt,
          reactions: [],
          attachments: [],
          quoted: null,
          mentionedUserIds: [],
          pending: true,
        });
      }
    }
  }

  private mergeMessages(channelId: string, incoming: MessageDto[]): LocalMessage[] {
    for (const message of incoming) {
      this.reconcileMessage(channelId, message, false);
      if (message.seq > (this.lastSeqByChannel.get(channelId) ?? 0)) {
        this.lastSeqByChannel.set(channelId, message.seq);
      }
    }
    this.emitChannelMessages(channelId);
    return this.getCachedMessages(channelId);
  }

  /** Reconciles a server message into the local list: replaces the matching optimistic
   *  entry (same clientMsgId) in place if present, otherwise upserts by server id. This is
   *  what makes retried/duplicate acks and the WS echo of our own send idempotent client-side. */
  private reconcileMessage(channelId: string, message: MessageDto, notify = true): void {
    const list = this.messagesByChannel.get(channelId) ?? [];
    const pendingIndex = list.findIndex((m) => m.clientMsgId === message.clientMsgId);
    const next = [...list];

    if (pendingIndex >= 0) {
      next[pendingIndex] = { ...message, pending: false, failed: false };
    } else {
      const existingIndex = next.findIndex((m) => m.id === message.id);
      if (existingIndex >= 0) {
        next[existingIndex] = { ...message };
      } else {
        next.push({ ...message });
      }
    }

    next.sort((a, b) => a.seq - b.seq);
    this.messagesByChannel.set(channelId, next);
    if (message.seq > (this.lastSeqByChannel.get(channelId) ?? 0)) {
      this.lastSeqByChannel.set(channelId, message.seq);
    }
    if (notify) this.emitChannelMessages(channelId);
  }

  private appendLocalMessage(channelId: string, message: LocalMessage): void {
    const list = this.messagesByChannel.get(channelId) ?? [];
    this.messagesByChannel.set(channelId, [...list, message]);
    this.emitChannelMessages(channelId);
  }

  private updateLocalMessage(channelId: string, clientMsgId: string, patch: Partial<LocalMessage>): void {
    const list = this.messagesByChannel.get(channelId) ?? [];
    this.messagesByChannel.set(
      channelId,
      list.map((m) => (m.clientMsgId === clientMsgId ? { ...m, ...patch } : m)),
    );
    this.emitChannelMessages(channelId);
  }

  private emitChannelMessages(channelId: string): void {
    this.emitter.emit('messagesUpdated', channelId, this.getCachedMessages(channelId));
  }

  private setConnectionState(state: ConnectionState): void {
    this.connectionState = state;
    this.emitter.emit('connectionState', state);
  }

  private async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const token = await this.config.getAccessToken();
    const res = await fetch(`${this.config.baseUrl}${path}`, {
      method,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    if (!res.ok) {
      const errBody = await res.json().catch(() => ({ message: res.statusText }));
      throw new Error(errBody.message ?? `Request failed: ${res.status}`);
    }
    if (res.status === 204) return undefined as T;
    return res.json() as Promise<T>;
  }
}
