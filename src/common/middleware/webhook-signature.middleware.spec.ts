import {
  ForbiddenException,
  InternalServerErrorException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import { NextFunction, Request, Response } from 'express';
import { createHmac } from 'crypto';
import { WebhookSignatureMiddleware } from './webhook-signature.middleware';

const rawBody = Buffer.from('webhook payload');
const defaultSecret = 'default-secret';

function signature(secret: string, body = rawBody): string {
  return createHmac('sha256', secret).update(body).digest('hex');
}

function createMiddleware(secrets: Record<string, string>) {
  const config = {
    get: jest.fn((key: string) => secrets[key]),
  } as unknown as ConfigService;
  const middleware = new WebhookSignatureMiddleware(config, new Reflector());
  const next = jest.fn() as NextFunction;

  return { middleware, next };
}

function createRequest(
  headers: Record<string, string>,
  body: Buffer | undefined,
  originalUrl = '/api/v1/webhooks/provider/events',
): Request & { rawBody?: Buffer } {
  return {
    method: 'POST',
    originalUrl,
    headers,
    rawBody: body,
  } as Request & { rawBody?: Buffer };
}

describe('WebhookSignatureMiddleware', () => {
  it('rejects a request without a signature header', () => {
    const { middleware, next } = createMiddleware({
      WEBHOOK_SECRET: defaultSecret,
    });

    expect(() =>
      middleware.use(createRequest({}, rawBody), {} as Response, next),
    ).toThrow(UnauthorizedException);
    expect(next).not.toHaveBeenCalled();
  });

  it.each([
    ['x-webhook-signature', (hex: string) => `sha256=${hex}`],
    ['x-webhook-signature', (hex: string) => hex],
    ['x-hub-signature-256', (hex: string) => `sha256=${hex}`],
  ])('accepts a valid signature from %s', (header, format) => {
    const { middleware, next } = createMiddleware({
      WEBHOOK_SECRET: defaultSecret,
    });
    const headers = { [header]: format(signature(defaultSecret)) };

    middleware.use(createRequest(headers, rawBody), {} as Response, next);

    expect(next).toHaveBeenCalledTimes(1);
  });

  it('accepts a Stripe v1 signature', () => {
    const { middleware, next } = createMiddleware({
      WEBHOOK_SECRET: defaultSecret,
    });
    const headers = {
      'stripe-signature': `t=12345,v1=${signature(defaultSecret)}`,
    };

    middleware.use(createRequest(headers, rawBody), {} as Response, next);

    expect(next).toHaveBeenCalledTimes(1);
  });

  it('prefers the provider-specific secret over the default', () => {
    const providerSecret = 'stripe-secret';
    const { middleware, next } = createMiddleware({
      WEBHOOK_SECRET: defaultSecret,
      WEBHOOK_SECRET_STRIPE: providerSecret,
    });
    const headers = {
      'x-webhook-signature': `sha256=${signature(providerSecret)}`,
    };

    middleware.use(
      createRequest(headers, rawBody, '/api/v1/webhooks/stripe/events'),
      {} as Response,
      next,
    );

    expect(next).toHaveBeenCalledTimes(1);
  });

  it('rejects requests when the raw body is unavailable', () => {
    const { middleware, next } = createMiddleware({
      WEBHOOK_SECRET: defaultSecret,
    });
    const headers = {
      'x-webhook-signature': `sha256=${signature(defaultSecret)}`,
    };

    expect(() =>
      middleware.use(createRequest(headers, undefined), {} as Response, next),
    ).toThrow(InternalServerErrorException);
    expect(next).not.toHaveBeenCalled();
  });

  it('accepts an empty raw body when its signature is valid', () => {
    const { middleware, next } = createMiddleware({
      WEBHOOK_SECRET: defaultSecret,
    });
    const emptyBody = Buffer.alloc(0);
    const headers = {
      'x-webhook-signature': `sha256=${signature(defaultSecret, emptyBody)}`,
    };

    middleware.use(createRequest(headers, emptyBody), {} as Response, next);

    expect(next).toHaveBeenCalledTimes(1);
  });

  it.each(['a'.repeat(63), 'z'.repeat(64)])(
    'rejects malformed hex signatures without calling next',
    (hex) => {
      const { middleware, next } = createMiddleware({
        WEBHOOK_SECRET: defaultSecret,
      });

      expect(() =>
        middleware.use(
          createRequest(
            { 'x-webhook-signature': `sha256=${hex}` },
            rawBody,
          ),
          {} as Response,
          next,
        ),
      ).toThrow(ForbiddenException);
      expect(next).not.toHaveBeenCalled();
    },
  );
});
