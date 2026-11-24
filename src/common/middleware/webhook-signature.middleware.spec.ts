import { createHmac } from 'crypto';
import { ConfigService } from '@nestjs/config';
import { ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { WebhookSignatureMiddleware } from './webhook-signature.middleware';

const SECRET = 'test-secret-123';

function makeMiddleware(secret = SECRET) {
  const config = {
    get: (key: string) => (key === 'WEBHOOK_SECRET' ? secret : undefined),
  } as unknown as ConfigService;
  const reflector = {} as Reflector;
  return new WebhookSignatureMiddleware(config, reflector);
}

function sign(body: Buffer, secret = SECRET) {
  return 'sha256=' + createHmac('sha256', secret).update(body).digest('hex');
}

function makeReq(overrides: Record<string, unknown> = {}) {
  return {
    method: 'POST',
    originalUrl: '/api/v1/webhooks/test',
    headers: {},
    rawBody: Buffer.from('{"event":"test"}'),
    ...overrides,
  } as unknown as Parameters<WebhookSignatureMiddleware['use']>[0];
}

describe('WebhookSignatureMiddleware', () => {
  describe('skip flag — @SkipWebhookSignature() opt-out', () => {
    it('calls next() without verifying when _webhookSignatureSkipped is true', () => {
      const mw = makeMiddleware();
      const req = makeReq({ _webhookSignatureSkipped: true });
      const next = jest.fn();

      mw.use(req, {} as never, next);

      expect(next).toHaveBeenCalledTimes(1);
    });

    it('does NOT skip when _webhookSignatureSkipped is falsy', () => {
      const mw = makeMiddleware();
      const req = makeReq({ _webhookSignatureSkipped: false });
      const next = jest.fn();

      expect(() => mw.use(req, {} as never, next)).toThrow(UnauthorizedException);
      expect(next).not.toHaveBeenCalled();
    });
  });

  describe('non-skipped routes', () => {
    it('throws UnauthorizedException when no signature header is present', () => {
      const mw = makeMiddleware();
      const req = makeReq();
      expect(() => mw.use(req, {} as never, jest.fn())).toThrow(UnauthorizedException);
    });

    it('calls next() when signature is valid (sha256= prefix)', () => {
      const mw = makeMiddleware();
      const body = Buffer.from('{"event":"test"}');
      const req = makeReq({
        headers: { 'x-webhook-signature': sign(body) },
        rawBody: body,
      });
      const next = jest.fn();
      mw.use(req, {} as never, next);
      expect(next).toHaveBeenCalledTimes(1);
    });

    it('throws ForbiddenException when signature is invalid', () => {
      const mw = makeMiddleware();
      const req = makeReq({
        headers: { 'x-webhook-signature': 'sha256=deadbeef00000000000000000000000000000000000000000000000000000000' },
      });
      expect(() => mw.use(req, {} as never, jest.fn())).toThrow(ForbiddenException);
    });
  });
});
