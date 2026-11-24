import {
  ExecutionContext,
  ForbiddenException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import { createHmac } from 'crypto';
import { NextFunction, Request, Response } from 'express';
import { SkipWebhookSignature } from '../decorators/skip-webhook-signature.decorator';
import { WebhookSkipGuard } from '../guards/webhook-skip.guard';
import { WebhookSignatureMiddleware } from './webhook-signature.middleware';

describe('WebhookSignatureMiddleware', () => {
  const secret = 'test-webhook-secret';
  const rawBody = Buffer.from('{"event":"test"}');
  let middleware: WebhookSignatureMiddleware;
  const reflector = new Reflector();

  const createRequest = (signature?: string) =>
    ({
      headers: signature ? { 'x-webhook-signature': signature } : {},
      method: 'POST',
      originalUrl: '/api/v1/webhooks/provider',
      rawBody,
    }) as Request & { rawBody: Buffer };

  const sign = (body: Buffer) =>
    createHmac('sha256', secret).update(body).digest('hex');

  beforeEach(() => {
    const config = {
      get: jest.fn((key: string) =>
        key === 'WEBHOOK_SECRET' ? secret : undefined,
      ),
    } as unknown as ConfigService;
    middleware = new WebhookSignatureMiddleware(config, reflector);
  });

  it('accepts a valid HMAC-SHA256 signature and calls next', () => {
    const req = createRequest(sign(rawBody));
    const next = jest.fn() as NextFunction;

    middleware.use(req, {} as Response, next);

    expect(next).toHaveBeenCalledTimes(1);
  });

  it('rejects an invalid signature', () => {
    const req = createRequest('0'.repeat(64));
    const next = jest.fn() as NextFunction;

    expect(() => middleware.use(req, {} as Response, next)).toThrow(
      ForbiddenException,
    );
    expect(next).not.toHaveBeenCalled();
  });

  it('rejects a missing signature', () => {
    const req = createRequest();
    const next = jest.fn() as NextFunction;

    expect(() => middleware.use(req, {} as Response, next)).toThrow(
      UnauthorizedException,
    );
    expect(next).not.toHaveBeenCalled();
  });

  it('bypasses signature verification for a route marked with the skip decorator', () => {
    class TestWebhookController {
      @SkipWebhookSignature()
      ping() {}
    }

    const req = createRequest() as Request & {
      rawBody: Buffer;
      _webhookSignatureSkipped?: boolean;
    };
    const context = {
      getHandler: () => TestWebhookController.prototype.ping,
      getClass: () => TestWebhookController,
      switchToHttp: () => ({ getRequest: () => req }),
    };
    const skipGuard = new WebhookSkipGuard(reflector);
    const next = jest.fn() as NextFunction;

    expect(skipGuard.canActivate(context as ExecutionContext)).toBe(true);
    middleware.use(req, {} as Response, next);

    expect(req._webhookSignatureSkipped).toBe(true);
    expect(next).toHaveBeenCalledTimes(1);
  });
});
