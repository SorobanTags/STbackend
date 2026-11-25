import {
  ExecutionContext,
  ForbiddenException,
  Logger,
  UnauthorizedException,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Reflector } from "@nestjs/core";
import { createHmac } from "crypto";
import { NextFunction, Request, Response } from "express";
import { SkipWebhookSignature } from "../decorators/skip-webhook-signature.decorator";
import { WebhookSkipGuard } from "../guards/webhook-skip.guard";
import { WebhookSignatureMiddleware } from "./webhook-signature.middleware";

const originalWebhookEnv = Object.fromEntries(
  Object.entries(process.env).filter(
    ([key]) => key === "WEBHOOK_SECRET" || key.startsWith("WEBHOOK_SECRET_"),
  ),
);

function clearWebhookEnv() {
  for (const key of Object.keys(process.env)) {
    if (key === "WEBHOOK_SECRET" || key.startsWith("WEBHOOK_SECRET_")) {
      delete process.env[key];
    }
  }
}

function createConfig(secrets: Record<string, string | undefined> = {}) {
  return {
    get: jest.fn((key: string) => secrets[key]),
  } as unknown as ConfigService;
}

function signedRequest(url: string, secret: string) {
  const rawBody = Buffer.from("webhook payload");
  return {
    originalUrl: url,
    method: "POST",
    headers: {
      "x-webhook-signature": createHmac("sha256", secret)
        .update(rawBody)
        .digest("hex"),
    },
    rawBody,
  } as unknown as Request & { rawBody: Buffer };
}

describe("WebhookSignatureMiddleware", () => {
  const secret = "test-webhook-secret";
  const rawBody = Buffer.from('{"event":"test"}');
  let middleware: WebhookSignatureMiddleware;
  const reflector = new Reflector();

  const createRequest = (signature?: string) =>
    ({
      headers: signature ? { "x-webhook-signature": signature } : {},
      method: "POST",
      originalUrl: "/api/v1/webhooks/provider",
      rawBody,
    }) as Request & { rawBody: Buffer };

  const sign = (body: Buffer) =>
    createHmac("sha256", secret).update(body).digest("hex");

  beforeEach(() => {
    clearWebhookEnv();
    const config = {
      get: jest.fn((key: string) =>
        key === "WEBHOOK_SECRET" ? secret : undefined,
      ),
    } as unknown as ConfigService;
    middleware = new WebhookSignatureMiddleware(config, reflector);
  });

  afterEach(() => {
    clearWebhookEnv();
    Object.assign(process.env, originalWebhookEnv);
    jest.restoreAllMocks();
  });

  it("accepts a valid HMAC-SHA256 signature and calls next", () => {
    const req = createRequest(sign(rawBody));
    const next = jest.fn() as NextFunction;

    middleware.use(req, {} as Response, next);

    expect(next).toHaveBeenCalledTimes(1);
  });

  it("rejects an invalid signature", () => {
    const req = createRequest("0".repeat(64));
    const next = jest.fn() as NextFunction;

    expect(() => middleware.use(req, {} as Response, next)).toThrow(
      ForbiddenException,
    );
    expect(next).not.toHaveBeenCalled();
  });

  it("rejects a missing signature", () => {
    const req = createRequest();
    const next = jest.fn() as NextFunction;

    expect(() => middleware.use(req, {} as Response, next)).toThrow(
      UnauthorizedException,
    );
    expect(next).not.toHaveBeenCalled();
  });

  it("bypasses signature verification for a route marked with the skip decorator", () => {
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

  describe("skip flag — @SkipWebhookSignature() opt-out", () => {
    it("calls next() without verifying when _webhookSignatureSkipped is true", () => {
      const req = createRequest() as Request & {
        rawBody: Buffer;
        _webhookSignatureSkipped?: boolean;
      };
      req._webhookSignatureSkipped = true;
      const next = jest.fn() as NextFunction;

      middleware.use(req, {} as Response, next);

      expect(next).toHaveBeenCalledTimes(1);
    });

    it("does NOT skip when _webhookSignatureSkipped is falsy", () => {
      const req = createRequest() as Request & {
        rawBody: Buffer;
        _webhookSignatureSkipped?: boolean;
      };
      req._webhookSignatureSkipped = false;
      const next = jest.fn() as NextFunction;

      expect(() => middleware.use(req, {} as Response, next)).toThrow(
        UnauthorizedException,
      );
      expect(next).not.toHaveBeenCalled();
    });
  });

  describe("non-skipped routes", () => {
    it("throws UnauthorizedException when no signature header is present", () => {
      const req = createRequest();
      expect(() => middleware.use(req, {} as Response, jest.fn())).toThrow(
        UnauthorizedException,
      );
    });

    it("calls next() when signature is valid (sha256= prefix)", () => {
      const body = Buffer.from('{"event":"test"}');
      const req = createRequest("sha256=" + sign(body));
      (req as Request & { rawBody: Buffer }).rawBody = body;
      const next = jest.fn() as NextFunction;
      middleware.use(req, {} as Response, next);
      expect(next).toHaveBeenCalledTimes(1);
    });

    it("throws ForbiddenException when signature is invalid", () => {
      const req = createRequest(
        "sha256=deadbeef00000000000000000000000000000000000000000000000000000000",
      );
      expect(() => middleware.use(req, {} as Response, jest.fn())).toThrow(
        ForbiddenException,
      );
    });
  });

  describe("WebhookSignatureMiddleware provider secrets", () => {
    it("warns when neither a default nor provider secret is configured", () => {
      const warn = jest
        .spyOn(Logger.prototype, "warn")
        .mockImplementation(() => undefined);

      new WebhookSignatureMiddleware(createConfig(), new Reflector());

      expect(warn).toHaveBeenCalledWith(
        expect.stringContaining("All webhook requests will be rejected."),
      );
    });

    it("logs configured providers and accepts a provider-only secret", () => {
      process.env.WEBHOOK_SECRET_STRIPE = "stripe-secret";
      const log = jest
        .spyOn(Logger.prototype, "log")
        .mockImplementation(() => undefined);
      const warn = jest
        .spyOn(Logger.prototype, "warn")
        .mockImplementation(() => undefined);
      const middleware = new WebhookSignatureMiddleware(
        createConfig({ WEBHOOK_SECRET_STRIPE: "stripe-secret" }),
        new Reflector(),
      );
      const next = jest.fn();

      middleware.use(
        signedRequest("/api/v1/webhooks/stripe", "stripe-secret"),
        {} as Response,
        next,
      );

      expect(log).toHaveBeenCalledWith(
        "Provider-specific webhook secrets configured for: stripe",
      );
      expect(warn).not.toHaveBeenCalled();
      expect(next).toHaveBeenCalledTimes(1);
    });

    it("names an unknown provider when no matching or default secret exists", () => {
      const middleware = new WebhookSignatureMiddleware(
        createConfig(),
        new Reflector(),
      );
      const request = signedRequest("/api/v1/webhooks/unknown", "unused");
      let thrown: unknown;

      try {
        middleware.use(request, {} as Response, jest.fn());
      } catch (error) {
        thrown = error;
      }

      expect(thrown).toBeInstanceOf(UnauthorizedException);
      if (thrown instanceof UnauthorizedException) {
        expect(thrown.message).toContain('provider "unknown"');
      }
    });
  });
  });
});
