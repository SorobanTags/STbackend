import { ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { resolveCurrentUser } from './current-user.decorator';

/** Build a minimal ExecutionContext stub whose HTTP request carries `user`. */
function makeCtx(user: unknown): ExecutionContext {
  return {
    switchToHttp: () => ({
      getRequest: () => ({ user }),
    }),
  } as unknown as ExecutionContext;
}

describe('CurrentUser decorator (Issue #19)', () => {
  it('returns the full user object when no property name is passed', () => {
    const user = { id: 'u1', email: 'a@b.com', role: 'STUDENT' };
    expect(resolveCurrentUser(undefined, makeCtx(user))).toEqual(user);
  });

  it('returns only the requested field when a property name is passed', () => {
    const user = { id: 'u1', email: 'a@b.com' };
    expect(resolveCurrentUser('id', makeCtx(user))).toBe('u1');
  });

  it('throws UnauthorizedException when request.user is undefined', () => {
    expect(() => resolveCurrentUser(undefined, makeCtx(undefined))).toThrow(
      UnauthorizedException,
    );
  });

  it('throws UnauthorizedException when request.user is null', () => {
    expect(() => resolveCurrentUser(undefined, makeCtx(null))).toThrow(
      UnauthorizedException,
    );
  });
});
