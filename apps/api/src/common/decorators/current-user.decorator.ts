import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { JwtAccessTokenClaims } from '@qennect/shared-types';

export interface RequestUser extends JwtAccessTokenClaims {}

export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): RequestUser => {
    const request = ctx.switchToHttp().getRequest();
    return request.user;
  },
);
