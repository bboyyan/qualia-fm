import { readFileSync } from 'node:fs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ConfigError, loadConfig } from '../src/config/env.js';

beforeEach(() => { vi.stubGlobal('fetch', () => { throw new Error('禁止真實網路'); }); });

describe('loadConfig', () => {
  it('starts in mock mode with no keys at all (AC01)', () => {
    const config = loadConfig({});
    expect(config.mode).toBe('mock');
  });

  it('keeps both Spotify gates closed by default', () => {
    expect(loadConfig({}).gates).toEqual({ spotifyEnabled: false, spotifyDjApproved: false });
  });

  it('.env.example 本身可直接載入：範例值為安全預設（mock、未簽收、預算上限），且不含任何金鑰', () => {
    const text = readFileSync(new URL('../../../.env.example', import.meta.url), 'utf8');
    const entries = text.split('\n').filter((line) => /^[A-Z0-9_]+=/.test(line)).map((line) => line.split(/=(.*)/s).slice(0, 2) as [string, string]);
    const env = Object.fromEntries(entries);
    for (const name of ['OPENAI_API_KEY', 'SESSION_SECRET', 'NOTION_TOKEN', 'SPOTIFY_CLIENT_ID']) expect(env[name], name).toBe('');
    expect(env).toMatchObject({ LLM_PROVIDER: 'mock', TTS_PROVIDER: 'mock', OPENAI_REAL_CALLS_APPROVED: 'false', SPOTIFY_ENABLED: 'false', SPOTIFY_DJ_APPROVED: 'false', PORT: '8080' });
    const config = loadConfig(env);
    expect(config.openai).toMatchObject({ llm: 'mock', tts: 'mock', reason: null });
    expect(config.openai.budget).toEqual({ dailyUsd: 1, totalUsd: 10, plansPerDay: 20, graphemesPerDay: 4000 });
    expect(config.openai).toMatchObject({ ttsTimeoutMs: 30_000, ttsInstructions: undefined });
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

  it('接受 openai 設定，缺少憑證仍能啟動並明示降級', () => {
    expect(loadConfig({ LLM_PROVIDER: 'openai' }).openai.reason).toContain('OPENAI_API_KEY');
    expect(loadConfig({ LLM_PROVIDER: 'openai', OPENAI_API_KEY: 'TEST' }).openai.reason).toContain('尚待簽收');
  });

  it('輸出 token 有預設與上下限，模型與單價沒有預設', () => {
    expect(loadConfig({}).openai.maxOutputTokens).toBe(4096);
    expect(() => loadConfig({ OPENAI_MAX_OUTPUT_TOKENS: '0' })).toThrow(ConfigError);
    expect(() => loadConfig({ OPENAI_MAX_OUTPUT_TOKENS: '16385' })).toThrow(ConfigError);
    expect(loadConfig({ LLM_PROVIDER: 'openai', OPENAI_API_KEY: 'TEST', OPENAI_REAL_CALLS_APPROVED: 'true' }).openai.reason).toContain('設定');
  });

  it('OPENAI_TTS_INSTRUCTIONS：未設、空值或只有空白視為未設；有值則保留', () => {
    expect(loadConfig({}).openai.ttsInstructions).toBeUndefined();
    expect(loadConfig({ OPENAI_TTS_INSTRUCTIONS: '' }).openai.ttsInstructions).toBeUndefined();
    expect(loadConfig({ OPENAI_TTS_INSTRUCTIONS: '  \n ' }).openai.ttsInstructions).toBeUndefined();
    expect(loadConfig({ OPENAI_TTS_INSTRUCTIONS: '溫暖的台灣電台聲線。' }).openai.ttsInstructions).toBe('溫暖的台灣電台聲線。');
  });

  it('OPENAI_TTS_INSTRUCTIONS 上限 1500 字元（code points），超長拒絕啟動', () => {
    expect(loadConfig({ OPENAI_TTS_INSTRUCTIONS: '台'.repeat(1500) }).openai.ttsInstructions).toHaveLength(1500);
    expect(() => loadConfig({ OPENAI_TTS_INSTRUCTIONS: '台'.repeat(1501) })).toThrow(ConfigError);
    expect(() => loadConfig({ OPENAI_TTS_INSTRUCTIONS: '😀'.repeat(1501) })).toThrow(/OPENAI_TTS_INSTRUCTIONS/);
  });

  it('TTS_TIMEOUT_MS 預設 30000（慢語速 B2 聲線），範圍 1–60000', () => {
    expect(loadConfig({}).openai.ttsTimeoutMs).toBe(30_000);
    expect(loadConfig({ TTS_TIMEOUT_MS: '60000' }).openai.ttsTimeoutMs).toBe(60_000);
    expect(() => loadConfig({ TTS_TIMEOUT_MS: '60001' })).toThrow(ConfigError);
  });

  it('does not echo secret values in validation errors', () => {
    const secret = 'TEST-fake-key-should-never-appear';
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
