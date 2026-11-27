import { UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHmac } from 'crypto';
import { SmsCallbackSignatureGuard } from './sms-callback-signature.guard';

describe('SmsCallbackSignatureGuard', () => {
  let guard: SmsCallbackSignatureGuard;
  const SECRET = 'test-webhook-secret';

  const createContext = (req: Record<string, unknown>) => ({
    switchToHttp: () => ({ getRequest: () => req }),
  }) as any;

  beforeEach(() => {
    const mockConfig = {
      get: jest.fn((key: string) => {
        if (key === 'SMS_CALLBACK_SECRET') return SECRET;
        if (key === 'WEBHOOK_SECRET') return SECRET;
        return undefined;
      }),
    } as unknown as ConfigService;
    guard = new SmsCallbackSignatureGuard(mockConfig);
  });

  const makeSignedRequest = (body: string, secret = SECRET) => ({
    method: 'POST',
    originalUrl: '/api/v1/notifications/sms/callback',
    headers: {
      'x-webhook-signature': `sha256=${createHmac('sha256', secret).update(Buffer.from(body)).digest('hex')}`,
    },
    rawBody: Buffer.from(body),
  });

  it('passes a correctly signed request', () => {
    const req = makeSignedRequest(JSON.stringify({ id: 'sms-1', status: 'DELIVERED' }));
    expect(guard.canActivate(createContext(req))).toBe(true);
  });

  it('rejects with 401 when the signature header is missing', () => {
    const req = {
      method: 'POST',
      originalUrl: '/api/v1/notifications/sms/callback',
      headers: {},
      rawBody: Buffer.from('{}'),
    };
    expect(() => guard.canActivate(createContext(req))).toThrow(UnauthorizedException);
  });

  it('rejects with 401 when the signature is wrong', () => {
    const req = {
      method: 'POST',
      originalUrl: '/api/v1/notifications/sms/callback',
      headers: { 'x-webhook-signature': 'sha256=' + '0'.repeat(64) },
      rawBody: Buffer.from(JSON.stringify({ id: 'sms-1', status: 'DELIVERED' })),
    };
    expect(() => guard.canActivate(createContext(req))).toThrow(UnauthorizedException);
  });

  it('rejects with 401 when the signature was computed with a different secret', () => {
    const req = makeSignedRequest(JSON.stringify({ id: 'sms-1', status: 'DELIVERED' }), 'attacker-secret');
    expect(() => guard.canActivate(createContext(req))).toThrow(UnauthorizedException);
  });

  it('rejects with 401 when rawBody is unavailable', () => {
    const req = {
      method: 'POST',
      originalUrl: '/api/v1/notifications/sms/callback',
      headers: { 'x-webhook-signature': 'sha256=' + 'a'.repeat(64) },
    };
    expect(() => guard.canActivate(createContext(req))).toThrow(UnauthorizedException);
  });
});
