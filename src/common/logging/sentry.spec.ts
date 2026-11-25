import { scrubSentryEvent } from './sentry';

describe('scrubSentryEvent', () => {
  it('filters nested request.headers.authorization', () => {
    const event = {
      request: {
        headers: {
          authorization: 'Bearer super-secret-token',
          'content-type': 'application/json',
        },
      },
    } as any;

    const result = scrubSentryEvent(event);

    expect(result.request.headers.authorization).toBe('[Filtered]');
    expect(result.request.headers['content-type']).toBe('application/json');
  });

  it('strips the query string from request.url', () => {
    const event = {
      request: {
        url: 'https://example.com/api/v1/auth/verify-otp?code=123456',
      },
    } as any;

    const result = scrubSentryEvent(event);

    expect(result.request.url).toBe(
      'https://example.com/api/v1/auth/verify-otp',
    );
  });

  it('strips the query string from a breadcrumb data URL', () => {
    const event = {
      breadcrumbs: [
        {
          category: 'http',
          data: {
            to: '/api/v1/auth/verify-otp?code=123456',
          },
        },
      ],
    } as any;

    const result = scrubSentryEvent(event);

    expect(result.breadcrumbs[0].data.to).toBe('/api/v1/auth/verify-otp');
  });

  it('leaves a plain non-URL string unchanged', () => {
    const event = {
      message: 'Something went wrong while processing the request',
    } as any;

    const result = scrubSentryEvent(event);

    expect(result.message).toBe(
      'Something went wrong while processing the request',
    );
  });

  it('preserves filtering for authorization, cookie, and password keys', () => {
    const event = {
      request: {
        headers: {
          authorization: 'Bearer abc',
          cookie: 'session=abc',
        },
        data: {
          password: 'hunter2',
        },
      },
    } as any;

    const result = scrubSentryEvent(event);

    expect(result.request.headers.authorization).toBe('[Filtered]');
    expect(result.request.headers.cookie).toBe('[Filtered]');
    expect(result.request.data.password).toBe('[Filtered]');
  });
});
