// This repo's tsconfig uses classic "node" module resolution, which doesn't understand
// firebase-admin's package.json `exports` map — 'firebase-admin/messaging' resolves fine at
// runtime (Node itself honors `exports`), but TypeScript can't find its real .d.ts through
// this resolution mode. This shim declares just the surface PushSenderService actually calls,
// so the real module still loads at runtime while TS gets accurate types for it.
declare module 'firebase-admin/messaging' {
  import type { App } from 'firebase-admin';

  export interface MulticastMessage {
    tokens: string[];
    notification?: { title?: string; body?: string };
    data?: Record<string, string>;
    apns?: { payload?: { aps?: Record<string, unknown> } };
    android?: { notification?: Record<string, unknown> };
  }

  export interface SendResponse {
    success: boolean;
    messageId?: string;
    error?: { code?: string; message?: string };
  }

  export interface BatchResponse {
    responses: SendResponse[];
    successCount: number;
    failureCount: number;
  }

  export interface Messaging {
    sendEachForMulticast(message: MulticastMessage): Promise<BatchResponse>;
  }

  export function getMessaging(app?: App): Messaging;
}
