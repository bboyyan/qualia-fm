import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApp } from './app.js';
import { ConfigError, loadConfig } from './config/env.js';
import { logger } from './http/log.js';
import { loadShareConfig } from './share/config.js';

/** Bind to loopback only: this build is a private mock; it is never exposed publicly. */
const HOST = '127.0.0.1';

function defaultStaticDir(): string | undefined {
  const candidate = resolve(dirname(fileURLToPath(import.meta.url)), '../../web/dist');
  return existsSync(candidate) ? candidate : undefined;
}

function main(): void {
  const config = loadConfig();
  const share = loadShareConfig(process.env, config.nodeEnv);
  const { app } = createApp({ ...config, staticDir: config.staticDir ?? defaultStaticDir() }, { share });
  const server = app.listen(config.port, HOST, () => {
    logger.info('listening', { url: `http://${HOST}:${config.port}`, mode: config.mode });
  });
  const shutdown = (): void => {
    server.close(() => process.exit(0));
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

try {
  main();
} catch (error: unknown) {
  if (error instanceof ConfigError) {
    process.stderr.write(`[qualia-fm] ${error.message}\n`);
    process.exit(1);
  }
  throw error;
}
