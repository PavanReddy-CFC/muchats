import { ChatClient } from './ChatClient';
import { DevicePlatform, MessageDto } from '@qennect/shared-types';

type Handler = (...args: unknown[]) => void;
type EmitFn = (event: string, payload: unknown, ack?: (response: unknown) => void) => void;

class FakeSocket {
  connected = false;
  handlers: Record<string, Handler> = {};
  emitMock = jest.fn<ReturnType<EmitFn>, Parameters<EmitFn>>();

  on(event: string, handler: Handler): void {
    this.handlers[event] = handler;
  }

  emit(event: string, payload: unknown, ack?: (response: unknown) => void): void {
    this.emitMock(event, payload, ack);
  }

  disconnect(): void {
    this.connected = false;
  }

  trigger(event: string, ...args: unknown[]): void {
    this.handlers[event]?.(...args);
  }
}

let lastSocket: FakeSocket;

jest.mock('socket.io-client', () => ({
  io: jest.fn(() => {
    lastSocket = new FakeSocket();
    return lastSocket;
  }),
}));

let clientCounter = 0;

// Each client gets its own storage namespace so tests never share cached/queued state
// through the AsyncStorage mock's module-level store.
function makeClient(): ChatClient {
  clientCounter += 1;
  return new ChatClient({
    baseUrl: 'http://localhost:3000',
    tenantId: 'tenant-1',
    userId: 'user-1',
    storageNamespace: `test-${clientCounter}`,
    getAccessToken: () => 'token',
  });
}

async function connectClient(client: ChatClient): Promise<FakeSocket> {
  await client.connect();
  const socket = lastSocket;
  socket.connected = true;
  socket.trigger('connect');
  await new Promise((resolve) => setTimeout(resolve, 0));
  return socket;
}

function fakeServerMessage(overrides: Partial<MessageDto> & { clientMsgId: string; channelId: string }): MessageDto {
  return {
    id: `srv-${overrides.clientMsgId}`,
    tenantId: 'tenant-1',
    authorId: 'user-1',
    seq: 1,
    body: 'hello',
    parentId: null,
    editedAt: null,
    deletedAt: null,
    createdAt: new Date().toISOString(),
    reactions: [],
    attachments: [],
    quoted: null,
    mentionedUserIds: [],
    ...overrides,
  };
}

describe('ChatClient', () => {
  it('shows an optimistic pending message immediately, then reconciles it in place on ack', async () => {
    const client = makeClient();
    const socket = await connectClient(client);

    socket.emitMock.mockImplementation((_event, payload, ack) => {
      ack?.({
        ok: true,
        data: fakeServerMessage({
          clientMsgId: (payload as { clientMsgId: string }).clientMsgId,
          channelId: 'ch1',
          body: 'hello world',
          seq: 5,
        }),
      });
    });

    const sendPromise = client.sendMessage('ch1', 'hello world');

    // The optimistic entry is appended synchronously, before the network round trip.
    const cached = client.getCachedMessages('ch1');
    expect(cached).toHaveLength(1);
    expect(cached[0].pending).toBe(true);
    expect(cached[0].body).toBe('hello world');

    await sendPromise;

    const after = client.getCachedMessages('ch1');
    expect(after).toHaveLength(1);
    expect(after[0].pending).toBe(false);
    expect(after[0].seq).toBe(5);
  });

  it('does not duplicate a message when the same clientMsgId is retried and later acked', async () => {
    const client = makeClient();
    const socket = await connectClient(client);

    socket.emitMock.mockImplementation((_event, _payload, ack) => {
      ack?.({ ok: false }); // first attempt "fails"
    });

    await client.sendMessage('ch1', 'retry me');
    expect(client.getCachedMessages('ch1')[0].failed).toBe(true);

    const clientMsgId = client.getCachedMessages('ch1')[0].clientMsgId;

    socket.emitMock.mockImplementation((_event, payload, ack) => {
      ack?.({
        ok: true,
        data: fakeServerMessage({ clientMsgId: (payload as { clientMsgId: string }).clientMsgId, channelId: 'ch1', seq: 9 }),
      });
    });
    await client.retryMessage('ch1', clientMsgId);

    const messages = client.getCachedMessages('ch1');
    expect(messages).toHaveLength(1);
    expect(messages[0].failed).toBe(false);
    expect(messages[0].seq).toBe(9);
  });

  it('queues a send made while disconnected and flushes it once the socket (re)connects', async () => {
    const client = makeClient();
    await client.connect();
    const socket = lastSocket;
    socket.connected = false; // still connecting

    await client.sendMessage('ch1', 'queued while offline');
    expect(client.getCachedMessages('ch1')[0].pending).toBe(true);
    expect(socket.emitMock).not.toHaveBeenCalledWith('message:send', expect.anything(), expect.anything());

    socket.emitMock.mockImplementation((event, payload, ack) => {
      if (event === 'message:send') {
        ack?.({
          ok: true,
          data: fakeServerMessage({
            clientMsgId: (payload as { clientMsgId: string }).clientMsgId,
            channelId: 'ch1',
            seq: 1,
          }),
        });
      } else {
        ack?.({ ok: true, data: { channelId: 'ch1', messages: [], latestSeq: 0 } });
      }
    });

    socket.connected = true;
    socket.trigger('connect');
    await new Promise((resolve) => setTimeout(resolve, 0));

    const messages = client.getCachedMessages('ch1');
    expect(messages).toHaveLength(1);
    expect(messages[0].pending).toBe(false);
  });

  it('uploadAttachment requests a presigned URL then PUTs the file bytes to it', async () => {
    const client = makeClient();

    const blob = { size: 1234 };
    const fetchMock = jest
      .spyOn(globalThis, 'fetch')
      // 1: POST /attachments/upload-url (via ChatClient.request)
      .mockResolvedValueOnce({
        ok: true,
        status: 201,
        json: async () => ({ attachmentId: 'att-1', uploadUrl: 'https://s3.example.com/put' }),
      } as Response)
      // 2: fetch(file.uri) to read the local file into a blob
      .mockResolvedValueOnce({ blob: async () => blob } as unknown as Response)
      // 3: PUT to the presigned URL
      .mockResolvedValueOnce({ ok: true, status: 200 } as Response);

    const attachmentId = await client.uploadAttachment({
      uri: 'file:///tmp/photo.jpg',
      fileName: 'photo.jpg',
      mimeType: 'image/jpeg',
      sizeBytes: 1234,
    });

    expect(attachmentId).toBe('att-1');
    expect(fetchMock).toHaveBeenNthCalledWith(1, 'http://localhost:3000/attachments/upload-url', expect.objectContaining({ method: 'POST' }));
    expect(fetchMock).toHaveBeenNthCalledWith(3, 'https://s3.example.com/put', expect.objectContaining({ method: 'PUT', body: blob }));

    fetchMock.mockRestore();
  });

  describe('read receipts + DM block', () => {
    it('listReadReceipts GETs the channel-scoped receipts endpoint', async () => {
      const client = makeClient();
      const fetchMock = jest.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => [{ userId: 'u2', seq: 4, updatedAt: '2026-01-01T00:00:00.000Z' }],
      } as Response);

      const result = await client.listReadReceipts('ch1');

      expect(fetchMock).toHaveBeenCalledWith(
        'http://localhost:3000/messages/receipts?channelId=ch1',
        expect.objectContaining({ method: 'GET' }),
      );
      expect(result).toEqual([{ userId: 'u2', seq: 4, updatedAt: '2026-01-01T00:00:00.000Z' }]);
      fetchMock.mockRestore();
    });

    it('blockInDm / unblockInDm / getDmBlockStatus hit the channel block endpoints', async () => {
      const client = makeClient();
      const fetchMock = jest
        .spyOn(globalThis, 'fetch')
        .mockResolvedValueOnce({ ok: true, status: 204, json: async () => undefined } as Response)
        .mockResolvedValueOnce({ ok: true, status: 204, json: async () => undefined } as Response)
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => ({ blockedByMe: true, blockedMe: false }),
        } as Response);

      await client.blockInDm('ch1');
      await client.unblockInDm('ch1');
      const status = await client.getDmBlockStatus('ch1');

      expect(fetchMock).toHaveBeenNthCalledWith(1, 'http://localhost:3000/channels/ch1/block', expect.objectContaining({ method: 'POST' }));
      expect(fetchMock).toHaveBeenNthCalledWith(2, 'http://localhost:3000/channels/ch1/block', expect.objectContaining({ method: 'DELETE' }));
      expect(fetchMock).toHaveBeenNthCalledWith(3, 'http://localhost:3000/channels/ch1/block-status', expect.objectContaining({ method: 'GET' }));
      expect(status).toEqual({ blockedByMe: true, blockedMe: false });
      fetchMock.mockRestore();
    });
  });

  describe('push device tokens', () => {
    it('registerDeviceToken POSTs the token + platform', async () => {
      const client = makeClient();
      const fetchMock = jest.spyOn(globalThis, 'fetch').mockResolvedValueOnce({ ok: true, status: 204, json: async () => undefined } as Response);

      await client.registerDeviceToken('fcm-token-1', DevicePlatform.ANDROID);

      expect(fetchMock).toHaveBeenCalledWith(
        'http://localhost:3000/push/device-tokens',
        expect.objectContaining({ method: 'POST', body: JSON.stringify({ token: 'fcm-token-1', platform: DevicePlatform.ANDROID }) }),
      );
      fetchMock.mockRestore();
    });

    it('unregisterDeviceToken DELETEs the URL-encoded token', async () => {
      const client = makeClient();
      const fetchMock = jest.spyOn(globalThis, 'fetch').mockResolvedValueOnce({ ok: true, status: 204, json: async () => undefined } as Response);

      await client.unregisterDeviceToken('fcm token/with-slash');

      expect(fetchMock).toHaveBeenCalledWith(
        'http://localhost:3000/push/device-tokens/fcm%20token%2Fwith-slash',
        expect.objectContaining({ method: 'DELETE' }),
      );
      fetchMock.mockRestore();
    });
  });
});
