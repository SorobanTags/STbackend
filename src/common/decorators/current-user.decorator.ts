import { createParamDecorator, ExecutionContext, UnauthorizedException } from '@nestjs/common';

export function resolveCurrentUser(data: string | undefined, ctx: ExecutionContext): unknown {
  const request = ctx.switchToHttp().getRequest();
  const user    = request.user;
  if (!user) {
    throw new UnauthorizedException('No authenticated user found on request');
  }
  return data ? user[data] : user;
}

export const CurrentUser = createParamDecorator(resolveCurrentUser);
