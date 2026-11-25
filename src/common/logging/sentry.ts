import * as Sentry from '@sentry/nestjs';
import { Logger } from '@nestjs/common';

const SENSITIVE_FIELD =
  /authorization|cookie|password|secret|token|api[-_]?key|otp|email|phone/i;

const URL_WITH_QUERY = /^(?:[a-z][a-z0-9+.-]*:\/\/|\/)[^\s?#]*[?#]\S*/i;

const stripQueryAndFragment = (value: string): string =>
  value.replace(/[?#].*$/, '');

const scrubValue = (value: unknown, key?: string): unknown => {
  if (key && SENSITIVE_FIELD.test(key)) {
    return '[Filtered]';
  }

  if (typeof value === 'string') {
    if (URL_WITH_QUERY.test(value)) {
      return stripQueryAndFragment(value);
    }
    return value;
  }

  if (Array.isArray(value)) {
    return value.map((item) => scrubValue(item));
  }

  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([k, v]) => [
        k,
        scrubValue(v, k),
      ]),
    );
  }

  return value;
};

export const scrubSentryEvent = <T extends Sentry.Event>(event: T): T => {
  if (event.request) {
    if (event.request.url) {
      event.request.url = stripQueryAndFragment(event.request.url);
    }
    if (event.request.query_string) {
      delete event.request.query_string;
    }
    if (event.request.headers) {
      event.request.headers = scrubValue(event.request.headers) as Record<
        string,
        string
      >;
    }
  }

  if (event.transaction) {
    event.transaction = scrubValue(event.transaction) as string;
  }

  if (event.message) {
    event.message = scrubValue(event.message) as string;
  }

  if (event.breadcrumbs) {
    event.breadcrumbs = scrubValue(event.breadcrumbs) as Sentry.Breadcrumb[];
  }

  return event;
};

export const initSentry = (): void => {
  const dsn = process.env.SENTRY_DSN;
  if (!dsn) {
    return;
  }

  Sentry.init({
    dsn,
    environment: process.env.NODE_ENV ?? 'development',
    tracesSampleRate: Number(process.env.SENTRY_TRACES_SAMPLE_RATE ?? 0.1),
    beforeSend: scrubSentryEvent,
  });

  Logger.log('Sentry initialized', 'Sentry');
};
