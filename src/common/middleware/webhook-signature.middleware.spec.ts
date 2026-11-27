import {
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

  it('prefers the provider-specific secret over the default', () => 

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

  it("accepts a valid HMAC-SHA256 signature and calls next", () => {
    const req = createRequest(sign(rawBody));
    const next = jest.fn() as NextFunction;

    middleware.use(req, {} as Response, next);

    expect(next).toHaveBeenCalledTimes(1);
  });

});
