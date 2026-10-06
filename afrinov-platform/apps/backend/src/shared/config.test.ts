// Unit tests for environment configuration validation.
//
// loadConfig() is the fail-fast guard that runs at server startup. These
// tests pin the security contract:
//   - DATABASE_URL is always required.
//   - JWT_SECRET is required; known-insecure placeholders are rejected in
//     production but tolerated (for local dev) in test/development.
//   - PORT must be a valid port number.
//   - Defaults are applied for optional fields (HOST, LOG_LEVEL, NODE_ENV).
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { loadConfig, ConfigError } from './config.js';

const savedEnv = { ...process.env };

function setEnv(env: Record<string, string | undefined>) {
  for (const [k, v] of Object.entries(env)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
}

beforeEach(() => {
  setEnv({
    DATABASE_URL: 'postgresql://user:pass@localhost:5432/testdb',
    JWT_SECRET: 'a-strong-random-secret-value',
    NODE_ENV: 'test',
    PORT: '3100',
    HOST: '0.0.0.0',
    LOG_LEVEL: 'info',
  });
});

afterEach(() => {
  setEnv(savedEnv);
});

describe('loadConfig', () => {
  it('loads a valid configuration with all fields populated', () => {
    const cfg = loadConfig();
    expect(cfg.nodeEnv).toBe('test');
    expect(cfg.databaseUrl).toBe('postgresql://user:pass@localhost:5432/testdb');
    expect(cfg.jwtSecret).toBe('a-strong-random-secret-value');
    expect(cfg.port).toBe(3100);
    expect(cfg.host).toBe('0.0.0.0');
    expect(cfg.logLevel).toBe('info');
  });

  it('defaults NODE_ENV to production when unset', () => {
    delete process.env.NODE_ENV;
    const cfg = loadConfig();
    expect(cfg.nodeEnv).toBe('production');
  });

  it('defaults HOST to 0.0.0.0 when unset', () => {
    delete process.env.HOST;
    const cfg = loadConfig();
    expect(cfg.host).toBe('0.0.0.0');
  });

  it('defaults LOG_LEVEL to info when unset', () => {
    delete process.env.LOG_LEVEL;
    const cfg = loadConfig();
    expect(cfg.logLevel).toBe('info');
  });

  it('defaults PORT to 4000 when unset', () => {
    delete process.env.PORT;
    const cfg = loadConfig();
    expect(cfg.port).toBe(4000);
  });

  it('throws ConfigError when DATABASE_URL is missing', () => {
    delete process.env.DATABASE_URL;
    expect(() => loadConfig()).toThrow(ConfigError);
    expect(() => loadConfig()).toThrow(/DATABASE_URL is required/i);
  });

  it('throws ConfigError when DATABASE_URL is empty', () => {
    process.env.DATABASE_URL = '';
    expect(() => loadConfig()).toThrow(/DATABASE_URL is required/i);
  });

  it('throws ConfigError when JWT_SECRET is empty in test env', () => {
    process.env.JWT_SECRET = '';
    expect(() => loadConfig()).toThrow(/JWT_SECRET is required/i);
  });

  it('throws ConfigError when JWT_SECRET is empty in development', () => {
    process.env.NODE_ENV = 'development';
    process.env.JWT_SECRET = '';
    expect(() => loadConfig()).toThrow(/JWT_SECRET is required/i);
  });

  it('rejects a known-insecure JWT_SECRET in production', () => {
    process.env.NODE_ENV = 'production';
    process.env.JWT_SECRET = 'insecure-dev-secret-change-me';
    expect(() => loadConfig()).toThrow(ConfigError);
    expect(() => loadConfig()).toThrow(/JWT_SECRET.*production/i);
  });

  it('rejects the placeholder "change-me-in-production" in production', () => {
    process.env.NODE_ENV = 'production';
    process.env.JWT_SECRET = 'change-me-in-production';
    expect(() => loadConfig()).toThrow(/JWT_SECRET.*production/i);
  });

  it('rejects an empty JWT_SECRET in production', () => {
    process.env.NODE_ENV = 'production';
    process.env.JWT_SECRET = '';
    expect(() => loadConfig()).toThrow(/JWT_SECRET.*production/i);
  });

  it('accepts a strong JWT_SECRET in production', () => {
    process.env.NODE_ENV = 'production';
    process.env.JWT_SECRET = 'a-very-long-and-random-production-secret-1234567890';
    const cfg = loadConfig();
    expect(cfg.jwtSecret).toBe('a-very-long-and-random-production-secret-1234567890');
  });

  it('tolerates a known-insecure JWT_SECRET in development (local dev convenience)', () => {
    process.env.NODE_ENV = 'development';
    process.env.JWT_SECRET = 'insecure-dev-secret-change-me';
    const cfg = loadConfig();
    expect(cfg.jwtSecret).toBe('insecure-dev-secret-change-me');
  });

  it('throws ConfigError for PORT zero', () => {
    process.env.PORT = '0';
    expect(() => loadConfig()).toThrow(/PORT must be a valid port number/i);
  });

  it('throws ConfigError for a negative PORT', () => {
    process.env.PORT = '-1';
    expect(() => loadConfig()).toThrow(/PORT must be a valid port number/i);
  });

  it('throws ConfigError for a PORT above 65535', () => {
    process.env.PORT = '70000';
    expect(() => loadConfig()).toThrow(/PORT must be a valid port number/i);
  });

  it('throws ConfigError for a non-numeric PORT', () => {
    process.env.PORT = 'not-a-port';
    expect(() => loadConfig()).toThrow(/PORT must be a valid port number/i);
  });

  it('returns a ConfigError instance (not a plain Error)', () => {
    delete process.env.DATABASE_URL;
    let caught: unknown;
    try {
      loadConfig();
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(ConfigError);
    expect((caught as ConfigError).name).toBe('ConfigError');
  });

  it('does not mutate process.env', () => {
    const before = { ...process.env };
    loadConfig();
    expect(process.env).toEqual(before);
  });
});
