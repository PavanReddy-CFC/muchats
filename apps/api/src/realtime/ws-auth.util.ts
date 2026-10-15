import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { Socket } from 'socket.io';
import { JwtAccessTokenClaims } from '@qennect/shared-types';

export async function authenticateSocket(
  socket: Socket,
  jwtService: JwtService,
  config: ConfigService,
): Promise<JwtAccessTokenClaims> {
  const token =
    (socket.handshake.auth?.token as string | undefined) ??
    (socket.handshake.headers.authorization?.toString().replace('Bearer ', '') as string | undefined);

  if (!token) throw new Error('Missing access token');

  return jwtService.verifyAsync<JwtAccessTokenClaims>(token, {
    secret: config.get<string>('JWT_ACCESS_SECRET'),
  });
}
