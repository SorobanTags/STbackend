// sms-callback-signature.guard.ts
// Guard that verifies the HMAC-SHA256 signature on inbound SMS gateway
// delivery-callback requests. Reuses the same timing-safe comparison logic
// as WebhookSignatureMiddleware.
//
// The SMS gateway (Africa's Talking) signs requests with the shared secret
// configured via SMS_CALLBACK_SECRET (falling back to WEBHOOK_SECRET).
// The expected signature must arrive in the X-Webhook-Signature header
// (or X-AT-Signature for Africa's Talking).
//
// Requests with a missing or invalid signature are rejected with 401.

import {
  CanActivate,
  ExecutionContext,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Request } from 'express';
import { createHmac, timingSafeEqual } from 'crypto';

/** Header names checked in preference order. */
const SIGNATURE_HEADERS = [
  'x-webhook-signature',
  'x-at-signature',       // Africa's Talking specific
  'x-hub-signature-256',
] as const;

function extractHex(raw: string): string {
  return raw.startsWith('sha256=') ? raw.slice(7) : raw;
}

function safeCompare(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  try {
    return timingSafeEqual(Buffer.from(a, 'hex'), Buffer.from(b, 'hex'));
  } catch {
    return false;
  }
}

@Injectable()
export class SmsCallbackSignatureGuard implements CanActivate {
  private readonly logger = new Logger(SmsCallbackSignatureGuard.name);

  constructor(private readonly config: ConfigService) {}

  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<Request & { rawBody?: Buffer }>();

    // 1. Find signature header
    let rawSignature: string | undefined;
    for (const header of SIGNATURE_HEADERS) {
      const value = req.headers[header];
      if (typeof value === 'string' && value.length > 0) {
        rawSignature = value;
        break;
      }
    }

    if (!rawSignature) {
      this.logger.warn(`SMS callback missing signature header — ${req.method} ${req.originalUrl}`);
      throw new UnauthorizedException('SMS callback signature is required.');
    }

    // 2. Resolve secret — prefer SMS_CALLBACK_SECRET, fall back to WEBHOOK_SECRET
    const secret =
      this.config.get<string>('SMS_CALLBACK_SECRET') ??
      this.config.get<string>('WEBHOOK_SECRET');

    if (!secret) {
      this.logger.error('Neither SMS_CALLBACK_SECRET nor WEBHOOK_SECRET is configured.');
      throw new UnauthorizedException('SMS callback endpoint is not configured.');
    }

    // 3. Require rawBody (needs { rawBody: true } in NestFactory.create)
    const body = req.rawBody;
    if (!body || body.length === 0) {
      this.logger.error('rawBody unavailable for SMS callback signature verification.');
      throw new UnauthorizedException('SMS callback signature verification failed.');
    }

    // 4. Compute expected HMAC and compare
    const expectedHex = createHmac('sha256', secret).update(body).digest('hex');
    const receivedHex = extractHex(rawSignature);

    if (!safeCompare(expectedHex, receivedHex)) {
      this.logger.warn(
        `Invalid SMS callback signature — method=${req.method} path=${req.originalUrl}`,
      );
      throw new UnauthorizedException('SMS callback signature verification failed.');
    }

    this.logger.debug(`SMS callback signature verified — path=${req.originalUrl}`);
    return true;
  }
}
