import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { io, Socket } from 'socket.io-client';
import request from 'supertest';
import { v4 as uuid } from 'uuid';
import { WsClientEvent, WsServerEvent, WsAck, MessageDto } from '@qennect/shared-types';
import { AppModule } from '../../src/app.module';

describe('Realtime gateway (e2e)', () => {
  let app: INestApplication;
  let baseUrl: string;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
    await app.listen(0);
    const address = app.getHttpServer().address();
    baseUrl = `http://localhost:${address.port}`;
  });

  afterAll(async () => {
    await app.close();
  });

  async function registerUser(displayName: string) {
    const res = await request(app.getHttpServer())
      .post('/auth/register')
      .send({
        tenantSlug: `ws-${uuid().slice(0, 8)}`,
        email: `${uuid()}@example.com`,
        password: 'password123',
        displayName,
      })
      .expect(201);
    return res.body.accessToken as string;
  }

  function connect(token: string): Promise<Socket> {
    return new Promise((resolve, reject) => {
      const socket = io(baseUrl, { auth: { token }, transports: ['websocket'] });
      socket.on('connect', () => resolve(socket));
      socket.on('connect_error', reject);
    });
  }

  it('broadcasts a sent message to all members of the channel', async () => {
    const token = await registerUser('Alice');
    const socket = await connect(token);

    const channelRes = await request(app.getHttpServer())
      .post('/channels')
      .set('Authorization', `Bearer ${token}`)
      .send({ type: 'PUBLIC', name: 'general', memberUserIds: [] })
      .expect(201);

    const received = new Promise<MessageDto>((resolve) => {
      socket.on(WsServerEvent.MessageNew, resolve);
    });

    const ack = await new Promise<WsAck>((resolve) => {
      socket.emit(
        WsClientEvent.MessageSend,
        { clientMsgId: uuid(), channelId: channelRes.body.id, body: 'hello world', attachmentIds: [] },
        resolve,
      );
    });

    expect(ack.ok).toBe(true);
    const broadcast = await received;
    expect(broadcast.body).toBe('hello world');
    expect(broadcast.seq).toBe(1);

    socket.disconnect();
  });

  it('rejects an unauthenticated connection', async () => {
    await expect(
      new Promise((resolve, reject) => {
        const socket = io(baseUrl, { auth: {}, transports: ['websocket'] });
        socket.on('connect', () => reject(new Error('should not connect')));
        socket.on('connect_error', resolve);
        socket.on('disconnect', resolve);
      }),
    ).resolves.toBeDefined();
  });
});
