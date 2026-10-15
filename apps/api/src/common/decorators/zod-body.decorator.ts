import {
  BadRequestException,
  createParamDecorator,
  ExecutionContext,
} from '@nestjs/common';
import { ZodSchema } from 'zod';

export function ZodBody(schema: ZodSchema): ParameterDecorator {
  return createParamDecorator((_data: unknown, ctx: ExecutionContext) => {
    const request = ctx.switchToHttp().getRequest();
    const result = schema.safeParse(request.body);
    if (!result.success) {
      throw new BadRequestException(result.error.issues.map((i) => ({
        path: i.path.join('.'),
        message: i.message,
      })));
    }
    return result.data;
  })();
}

export function ZodQuery(schema: ZodSchema): ParameterDecorator {
  return createParamDecorator((_data: unknown, ctx: ExecutionContext) => {
    const request = ctx.switchToHttp().getRequest();
    const result = schema.safeParse(request.query);
    if (!result.success) {
      throw new BadRequestException(result.error.issues.map((i) => ({
        path: i.path.join('.'),
        message: i.message,
      })));
    }
    return result.data;
  })();
}
