// 純 Node 產生確定性的 PNG；中央圖形位於 maskable 安全區。
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { deflateSync } from 'node:zlib';

const root = new URL('../', import.meta.url);
const tokens = readFileSync(new URL('apps/web/src/styles/tokens.css', root), 'utf8');
const color = (name) => {
  const hex = tokens.match(new RegExp(`--q-${name}:\\s*(#[A-Fa-f0-9]{6})`))?.[1];
  if (!hex) throw new Error(`缺少設計色 ${name}`);
  return hex;
};
const rgb = (hex) => [1, 3, 5].map((offset) => Number.parseInt(hex.slice(offset, offset + 2), 16));
const crc32 = (bytes) => {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
};
const chunk = (name, data) => {
  const type = Buffer.from(name);
  const out = Buffer.alloc(data.length + 12);
  out.writeUInt32BE(data.length, 0); type.copy(out, 4); data.copy(out, 8);
  out.writeUInt32BE(crc32(Buffer.concat([type, data])), data.length + 8);
  return out;
};
function png(size) {
  const dark = rgb(color('ink'));
  const brand = rgb(color('primary'));
  const wave = rgb(color('bg'));
  const raw = Buffer.alloc((size * 3 + 1) * size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = x / size - 0.5;
      const dy = y / size - 0.5;
      const circle = dx * dx + dy * dy < 0.105;
      const line = Math.abs(dx) < 0.23 && Math.abs(dy - Math.sin(dx * 30) * 0.075) < 0.013;
      const pixel = circle ? (line ? wave : brand) : dark;
      const offset = y * (size * 3 + 1) + 1 + x * 3;
      pixel.forEach((value, i) => { raw[offset + i] = value; });
    }
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0); header.writeUInt32BE(size, 4); header[8] = 8; header[9] = 2;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', header), chunk('IDAT', deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
}
const publicDir = new URL('apps/web/public/', root);
mkdirSync(fileURLToPath(publicDir), { recursive: true });
for (const [name, size] of [['icon-192.png', 192], ['icon-512.png', 512], ['icon-maskable-192.png', 192], ['icon-maskable-512.png', 512], ['apple-touch-icon.png', 180]]) writeFileSync(new URL(name, publicDir), png(size));
const icons = [192, 512].flatMap((size) => ['any', 'maskable'].map((purpose) => ({ src: `/icon-${purpose === 'maskable' ? 'maskable-' : ''}${size}.png`, sizes: `${size}x${size}`, type: 'image/png', purpose })));
writeFileSync(new URL('manifest.webmanifest', publicDir), `${JSON.stringify({ name: 'Qualia FM', short_name: 'Qualia FM', lang: 'zh-Hant-TW', start_url: '/', scope: '/', display: 'standalone', theme_color: color('primary'), background_color: color('bg'), icons }, null, 2)}\n`);
