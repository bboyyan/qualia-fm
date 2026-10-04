/** T01 boot shell: proves the page opens in mock mode with no keys. Replaced by AppShell in T02. */
import { useEffect, useState } from 'react';
import type { Capabilities } from '@qualia/contracts';
import { createApiClient } from '../api/client';

const api = createApiClient();

type Boot = { status: 'loading' } | { status: 'ready'; caps: Capabilities } | { status: 'error'; message: string };

export function App() {
  const [boot, setBoot] = useState<Boot>({ status: 'loading' });

  useEffect(() => {
    const controller = new AbortController();
    api
      .ensureSession()
      .then(() => api.capabilities(controller.signal))
      .then((caps) => setBoot({ status: 'ready', caps }))
      .catch((error: unknown) => {
        if (!controller.signal.aborted) setBoot({ status: 'error', message: (error as Error).message });
      });
    return () => controller.abort();
  }, []);

  return (
    <main>
      <h1>Qualia FM</h1>
      {boot.status === 'loading' && <p>正在連線…</p>}
      {boot.status === 'error' && <p role="alert">{boot.message}</p>}
      {boot.status === 'ready' && (
        <section aria-label="播放環境">
          <p data-testid="mode-badge">MOCK 模式</p>
          <ul>
            {boot.caps.restrictions.map((r) => (
              <li key={r}>{r}</li>
            ))}
          </ul>
        </section>
      )}
    </main>
  );
}
