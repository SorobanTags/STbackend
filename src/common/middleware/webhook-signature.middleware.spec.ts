import { Logger, UnauthorizedException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Reflector } from "@nestjs/core";
import { Request, Response } from "express";
import { createHmac } from "crypto";
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

describe("WebhookSignatureMiddleware provider secrets", () => {
  beforeEach(() => {
    clearWebhookEnv();
  });

  afterEach(() => {
    clearWebhookEnv();
    Object.assign(process.env, originalWebhookEnv);
    jest.restoreAllMocks();
  });

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
