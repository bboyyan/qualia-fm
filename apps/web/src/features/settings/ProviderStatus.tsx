import type { Capabilities } from '@qualia/contracts';

export function ProviderStatus({ providers }: { providers?: Capabilities['providers'] }) {
  if (!providers) return null;
  return <p role={providers.reason ? 'status' : undefined}>{providers.reason ?? `選歌：${providers.llm} · 語音：${providers.tts}`}</p>;
}
