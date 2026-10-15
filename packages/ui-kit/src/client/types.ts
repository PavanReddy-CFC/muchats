import { ChannelDto, MessageDto, PresenceStatus } from '@qennect/shared-types';

export interface ChatClientConfig {
  /** REST base URL, e.g. https://api.example.com */
  baseUrl: string;
  /** Socket.IO URL; defaults to baseUrl if omitted */
  wsUrl?: string;
  /** Socket.IO handshake path; defaults to '/socket.io' — override when the server is
   *  reverse-proxied behind a path prefix (e.g. '/chat-api/socket.io'). */
  socketPath?: string;
  tenantId: string;
  /** The signed-in user's id, as returned by the host app's own auth/login (e.g. /auth/me). */
  userId: string;
  /** Called whenever the client needs a fresh access token (REST call or (re)connect). */
  getAccessToken: () => Promise<string> | string;
  /** Optional: distinct storage namespace so multiple accounts don't collide in AsyncStorage. */
  storageNamespace?: string;
}

export type ConnectionState = 'connecting' | 'connected' | 'disconnected' | 'reconnecting';

/** A message as tracked client-side: the server MessageDto plus local send state. */
export interface LocalMessage extends MessageDto {
  /** true until the server has acked/echoed this send back. */
  pending?: boolean;
  /** true if the send ultimately failed after retries and needs a manual retry. */
  failed?: boolean;
}

export interface ChatClientEvents {
  connectionState: (state: ConnectionState) => void;
  channelsUpdated: (channels: ChannelDto[]) => void;
  messagesUpdated: (channelId: string, messages: LocalMessage[]) => void;
  typing: (channelId: string, userId: string, isTyping: boolean) => void;
  presence: (userId: string, status: PresenceStatus, lastSeenAt: string) => void;
  readReceipt: (channelId: string, userId: string, seq: number) => void;
}

export type ChatClientEventName = keyof ChatClientEvents;
