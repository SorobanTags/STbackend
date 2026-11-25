import { validateEnv } from './env.validation';

const VALID_STELLAR_KEY = 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF';

/** Minimal set of required environment variables. */
const minimalValid: Record<string, string> = {
  JWT_SECRET: 'supersecretkey1234',
  JWT_REFRESH_SECRET: 'refreshsecretkey5678',
  DATABASE_URL: 'postgresql://user:pass@localhost:5432/db',
  STELLAR_RPC_URL: 'https://soroban-testnet.stellar.org',
  STELLAR_HORIZON_URL: 'https://horizon-testnet.stellar.org',
  ADMIN_STELLAR_ADDRESS: VALID_STELLAR_KEY,
  TREASURY_STELLAR_ADDRESS: VALID_STELLAR_KEY,
  SMTP_HOST: 'smtp.gmail.com',
  SMTP_PORT: '587',
  SMTP_USER: 'user@example.com',
  SMTP_PASS: 'password',
  EMAIL_FROM: 'noreply@sorobanlard.com',
  CAPTCHA_SECRET_KEY: 'captchasecret',
  WEBHOOK_SECRET: 'webhooksecret',
};

describe('validateEnv', () => {
  it('passes with a valid minimal config', () => {
    expect(() => validateEnv({ ...minimalValid })).not.toThrow();
  });

  it('throws when JWT_SECRET is missing', () => {
    const cfg = { ...minimalValid };
    delete cfg['JWT_SECRET'];
    expect(() => validateEnv(cfg)).toThrow(/JWT_SECRET/);
  });

  it('throws when JWT_SECRET is too short (< 16 chars)', () => {
    expect(() => validateEnv({ ...minimalValid, JWT_SECRET: 'short' })).toThrow(
      /JWT_SECRET/,
    );
  });

  it('throws when DATABASE_URL is missing', () => {
    const cfg = { ...minimalValid };
    delete cfg['DATABASE_URL'];
    expect(() => validateEnv(cfg)).toThrow(/DATABASE_URL/);
  });

  it('throws when PORT is non-numeric', () => {
    expect(() => validateEnv({ ...minimalValid, PORT: 'abc' })).toThrow(/PORT/);
  });

  it('throws when ADMIN_STELLAR_ADDRESS is not a valid Stellar key', () => {
    expect(() =>
      validateEnv({ ...minimalValid, ADMIN_STELLAR_ADDRESS: 'INVALIDKEY' }),
    ).toThrow(/ADMIN_STELLAR_ADDRESS/);
  });

  it('throws when EMAIL_FROM is not a valid email', () => {
    expect(() =>
      validateEnv({ ...minimalValid, EMAIL_FROM: 'not-an-email' }),
    ).toThrow(/EMAIL_FROM/);
  });

  it('returns merged config object on success', () => {
    const result = validateEnv({ ...minimalValid });
    expect(result).toMatchObject({ DATABASE_URL: minimalValid.DATABASE_URL });
  });
});
