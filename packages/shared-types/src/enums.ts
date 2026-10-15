export enum TenantRole {
  OWNER = 'OWNER',
  ADMIN = 'ADMIN',
  MEMBER = 'MEMBER',
}

export enum ChannelType {
  PUBLIC = 'PUBLIC',
  PRIVATE = 'PRIVATE',
  DM = 'DM',
}

export enum ChannelMemberRole {
  OWNER = 'OWNER',
  ADMIN = 'ADMIN',
  MODERATOR = 'MODERATOR',
  MEMBER = 'MEMBER',
}

export enum ChannelPostingPolicy {
  /** Any member may send messages (default). */
  EVERYONE = 'EVERYONE',
  /** Only channel ADMIN/OWNER (or a tenant community admin) may send; everyone else is
   *  read-only. Used for announcement-style channels. */
  ADMINS_ONLY = 'ADMINS_ONLY',
}

export enum PresenceStatus {
  ONLINE = 'ONLINE',
  AWAY = 'AWAY',
  OFFLINE = 'OFFLINE',
}

export enum DevicePlatform {
  IOS = 'IOS',
  ANDROID = 'ANDROID',
}
