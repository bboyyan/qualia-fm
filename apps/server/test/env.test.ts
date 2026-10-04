import { describe, expect, it } from 'vitest';
import { ConfigError, loadConfig } from '../src/config/env.js';

describe('loadConfig', () => {
  it('starts in mock mode with no keys at all (AC01)', () => {
    const config = loadConfig({});
    expect(config.mode).toBe('mock');
  });

  it('keeps both Spotify gates closed by default', () => {
    expect(loadConfig({}).gates).toEqual({ spotifyEnabled: false, spotifyDjApproved: false });
  });

  it('treats empty env values (as in .env.example) as defaults', () => {
    expect(loadConfig({ PORT: '', OPENAI_API_KEY: '', SPOTIFY_ENABLED: '' }).port).toBe(8080);
  });

  it('refuses SPOTIFY_ENABLED=true because no gate has passed', () => {
    expect(() => loadConfig({ SPOTIFY_ENABLED: 'true' })).toThrow(ConfigError);
  });

  it('refuses SPOTIFY_DJ_APPROVED=true even with a reference', () => {
    expect(() => loadConfig({ SPOTIFY_DJ_APPROVED: 'true', SPOTIFY_APPROVAL_REFERENCE: 'x' })).toThrow(ConfigError);
  });

  it('refuses real LLM providers that are not implemented yet', () => {
    expect(() => loadConfig({ LLM_PROVIDER: 'openai' })).toThrow(/T06/);
  });

  it('does not echo secret values in validation errors', () => {
    const secret = 'sk-should-never-appear';
    let message = '';
    try {
      loadConfig({ OPENAI_API_KEY: secret, PORT: 'not-a-port' });
    } catch (error: unknown) {
      message = (error as Error).message;
    }
    expect(message).not.toContain(secret);
  });

  it('clamps budget knobs to documented hard ceilings', () => {
    expect(() => loadConfig({ MAX_LLM_CALLS_PER_PLAN: '5' })).toThrow(ConfigError);
  });

  it('allows the app origin plus its own loopback origin outside production', () => {
    expect(loadConfig({ PORT: '4173' }).allowedOrigins).toEqual([
      'http://127.0.0.1:5173',
      'http://127.0.0.1:4173',
      'http://localhost:4173',
    ]);
  });
});
