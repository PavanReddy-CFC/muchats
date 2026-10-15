import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import {
  ConnectedSocket,
  MessageBody,
  OnGatewayConnection,
  OnGatewayDisconnect,
  OnGatewayInit,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import {
  ChannelSyncRequest,
  EditMessageInputSchema,
  JwtAccessTokenClaims,
  MessageDto,
  ReactionInputSchema,
  ReadReceiptInputSchema,
  SendMessageInputSchema,
  WsAck,
  WsClientEvent,
  WsServerEvent,
} from '@qennect/shared-types';
import { authenticateSocket } from './ws-auth.util';
import { PresenceService } from './presence.service';
import { WsRateLimiterService } from './ws-rate-limiter.service';
import { ChannelsService } from '../channels/channels.service';
import { MessagesService } from '../messages/messages.service';
import { PushSenderService } from '../push/push-sender.service';

interface AuthedSocket extends Socket {
  data: { claims: JwtAccessTokenClaims };
}

export function channelRoom(tenantId: string, channelId: string): string {
  return `tenant:${tenantId}:channel:${channelId}`;
}

function tenantRoom(tenantId: string): string {
  return `tenant:${tenantId}`;
}

// The Socket.IO handshake path is set on the server as a whole by RedisIoAdapter in main.ts
// (derived from API_PREFIX), not per-gateway here — there's only one gateway in this app, so
// a server-wide path is equivalent and keeps the prefix logic in one place.
@WebSocketGateway({ cors: { origin: '*' } })
export class RealtimeGateway implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer()
  server!: Server;

  private readonly logger = new Logger(RealtimeGateway.name);

  constructor(
    private readonly jwtService: JwtService,
    private readonly config: ConfigService,
    private readonly presence: PresenceService,
    private readonly rateLimiter: WsRateLimiterService,
    private readonly channelsService: ChannelsService,
    private readonly messagesService: MessagesService,
    private readonly pushSender: PushSenderService,
  ) {}

  /** Auth runs as a handshake middleware — NOT in handleConnection — so an unauthenticated
   *  client never sees a 'connect' event at all (only 'connect_error'). handleConnection runs
   *  after the engine.io transport handshake already succeeded, which is too late: the client
   *  would briefly observe 'connect' before being kicked. */
  afterInit(server: Server): void {
    server.use(async (socket, next) => {
      try {
        const claims = await authenticateSocket(socket, this.jwtService, this.config);
        (socket as AuthedSocket).data.claims = claims;
        next();
      } catch (err) {
        this.logger.warn(`WS auth failed: ${(err as Error).message}`);
        next(err as Error);
      }
    });
  }

  async handleConnection(socket: Socket): Promise<void> {
    const claims = (socket as AuthedSocket).data.claims;

    await socket.join(tenantRoom(claims.tenantId));
    const channels = await this.channelsService.listForUser(claims.tenantId, claims.sub);
    await Promise.all(channels.map((c) => socket.join(channelRoom(claims.tenantId, c.id))));

    await this.presence.heartbeat(claims.tenantId, claims.sub);
    this.server.to(tenantRoom(claims.tenantId)).emit(WsServerEvent.PresenceUpdate, {
      userId: claims.sub,
      status: 'ONLINE',
      lastSeenAt: new Date().toISOString(),
    });
  }

  async handleDisconnect(socket: Socket): Promise<void> {
    const claims = (socket as AuthedSocket).data?.claims;
    if (!claims) return;
    await this.presence.markOffline(claims.tenantId, claims.sub);
    this.server.to(tenantRoom(claims.tenantId)).emit(WsServerEvent.PresenceUpdate, {
      userId: claims.sub,
      status: 'OFFLINE',
      lastSeenAt: new Date().toISOString(),
    });
  }

  @SubscribeMessage(WsClientEvent.MessageSend)
  async onMessageSend(
    @ConnectedSocket() socket: AuthedSocket,
    @MessageBody() body: unknown,
  ): Promise<WsAck> {
    const { tenantId, sub: userId } = socket.data.claims;
    const parsed = SendMessageInputSchema.safeParse(body);
    if (!parsed.success) return { ok: false, error: 'Invalid payload' };

    const allowed = await this.rateLimiter.allow(tenantId, userId);
    if (!allowed) return { ok: false, error: 'Rate limit exceeded' };

    try {
      const message = await this.messagesService.send(tenantId, userId, parsed.data);
      await socket.join(channelRoom(tenantId, message.channelId));
      this.server.to(channelRoom(tenantId, message.channelId)).emit(WsServerEvent.MessageNew, message);
      void this.pushSender.notifyNewMessage(tenantId, message); // fire-and-forget, see its own doc comment
      return { ok: true, data: message };
    } catch (err) {
      return { ok: false, error: (err as Error).message };
    }
  }

  @SubscribeMessage(WsClientEvent.MessageEdit)
  async onMessageEdit(@ConnectedSocket() socket: AuthedSocket, @MessageBody() body: unknown): Promise<WsAck> {
    const { tenantId, sub: userId } = socket.data.claims;
    const parsed = EditMessageInputSchema.safeParse(body);
    if (!parsed.success) return { ok: false, error: 'Invalid payload' };

    try {
      const message = await this.messagesService.edit(tenantId, userId, parsed.data);
      this.server.to(channelRoom(tenantId, message.channelId)).emit(WsServerEvent.MessageEdited, message);
      return { ok: true, data: message };
    } catch (err) {
      return { ok: false, error: (err as Error).message };
    }
  }

  @SubscribeMessage(WsClientEvent.MessageDelete)
  async onMessageDelete(
    @ConnectedSocket() socket: AuthedSocket,
    @MessageBody() body: { messageId: string },
  ): Promise<WsAck> {
    const { tenantId, sub: userId } = socket.data.claims;
    try {
      const message = await this.messagesService.softDelete(tenantId, userId, body.messageId);
      this.server.to(channelRoom(tenantId, message.channelId)).emit(WsServerEvent.MessageDeleted, message);
      return { ok: true, data: message };
    } catch (err) {
      return { ok: false, error: (err as Error).message };
    }
  }

  @SubscribeMessage(WsClientEvent.TypingStart)
  onTypingStart(
    @ConnectedSocket() socket: AuthedSocket,
    @MessageBody() body: { channelId: string },
  ): void {
    const { tenantId, sub: userId } = socket.data.claims;
    socket.to(channelRoom(tenantId, body.channelId)).emit(WsServerEvent.TypingUpdate, {
      channelId: body.channelId,
      userId,
      isTyping: true,
    });
  }

  @SubscribeMessage(WsClientEvent.TypingStop)
  onTypingStop(
    @ConnectedSocket() socket: AuthedSocket,
    @MessageBody() body: { channelId: string },
  ): void {
    const { tenantId, sub: userId } = socket.data.claims;
    socket.to(channelRoom(tenantId, body.channelId)).emit(WsServerEvent.TypingUpdate, {
      channelId: body.channelId,
      userId,
      isTyping: false,
    });
  }

  @SubscribeMessage(WsClientEvent.ReceiptRead)
  async onReceiptRead(@ConnectedSocket() socket: AuthedSocket, @MessageBody() body: unknown): Promise<WsAck> {
    const { tenantId, sub: userId } = socket.data.claims;
    const parsed = ReadReceiptInputSchema.safeParse(body);
    if (!parsed.success) return { ok: false, error: 'Invalid payload' };

    try {
      await this.messagesService.markRead(tenantId, userId, parsed.data.channelId, parsed.data.seq);
      this.server.to(channelRoom(tenantId, parsed.data.channelId)).emit(WsServerEvent.ReceiptUpdate, {
        channelId: parsed.data.channelId,
        userId,
        seq: parsed.data.seq,
      });
      return { ok: true };
    } catch (err) {
      return { ok: false, error: (err as Error).message };
    }
  }

  @SubscribeMessage(WsClientEvent.ReactionAdd)
  async onReactionAdd(@ConnectedSocket() socket: AuthedSocket, @MessageBody() body: unknown): Promise<WsAck> {
    return this.onReaction(socket, body);
  }

  @SubscribeMessage(WsClientEvent.ReactionRemove)
  async onReactionRemove(@ConnectedSocket() socket: AuthedSocket, @MessageBody() body: unknown): Promise<WsAck> {
    return this.onReaction(socket, body);
  }

  /** Reactions toggle (add if absent, remove if present) — both events route here. */
  private async onReaction(socket: AuthedSocket, body: unknown): Promise<WsAck> {
    const { tenantId, sub: userId } = socket.data.claims;
    const parsed = ReactionInputSchema.safeParse(body);
    if (!parsed.success) return { ok: false, error: 'Invalid payload' };

    try {
      const result = await this.messagesService.react(tenantId, userId, parsed.data);
      this.server.to(channelRoom(tenantId, result.channelId)).emit(WsServerEvent.ReactionUpdate, {
        messageId: parsed.data.messageId,
        channelId: result.channelId,
        emoji: parsed.data.emoji,
        userId,
        added: result.added,
      });
      return { ok: true, data: result };
    } catch (err) {
      return { ok: false, error: (err as Error).message };
    }
  }

  @SubscribeMessage(WsClientEvent.ChannelSync)
  async onChannelSync(
    @ConnectedSocket() socket: AuthedSocket,
    @MessageBody() body: ChannelSyncRequest,
  ): Promise<WsAck> {
    const { tenantId, sub: userId } = socket.data.claims;
    try {
      const result = await this.messagesService.listSince(tenantId, userId, body.channelId, body.lastSeq);
      await socket.join(channelRoom(tenantId, body.channelId));
      return { ok: true, data: { channelId: body.channelId, ...result } };
    } catch (err) {
      return { ok: false, error: (err as Error).message };
    }
  }

  /** Called from REST (admin moderation delete) to fan out the same event a WS-initiated
   *  delete would produce, so connected clients stay in sync either way. */
  broadcastMessageDeleted(tenantId: string, message: MessageDto): void {
    this.server.to(channelRoom(tenantId, message.channelId)).emit(WsServerEvent.MessageDeleted, message);
  }

  /** Called from REST (POST /messages) so a message sent over HTTP reaches connected
   *  clients exactly as a WS-initiated one does. The sender is typically NOT in the
   *  channel room here — they fell back to REST precisely because they have no socket —
   *  so this emits to the room rather than via a socket, and the sender reconciles from
   *  the HTTP response instead. */
  broadcastMessageNew(tenantId: string, message: MessageDto): void {
    this.server.to(channelRoom(tenantId, message.channelId)).emit(WsServerEvent.MessageNew, message);
    void this.pushSender.notifyNewMessage(tenantId, message); // fire-and-forget, see its own doc comment
  }
}
