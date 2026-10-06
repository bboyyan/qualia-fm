/**
 * 分享卡（BRA-163 幀 06）：夜色面＋五首曲名／藝人＋ Qualia 字標。沒有封面圖（第三方 artwork 有 provider 規則）、
 * 沒有種子、沒有 QR／網址。存成圖片在瀏覽器本機用 canvas 畫出 PNG，不經伺服器。
 */
import type { ShareView } from '@qualia/contracts';

export interface CardLines {
  readonly kicker: string;
  readonly title: string;
  readonly meta: string;
  readonly tracks: readonly { readonly title: string; readonly artist: string }[];
  readonly footer: string;
}

/** 寶石色＝8 個聲景的 hill 色調提亮（BRA-163 設計稿 --gem-1..8）。 */
export const GEM_COLORS: readonly string[] = ['#8FB08A', '#8AA9AD', '#A9B874', '#8AA3B2', '#D6A86C', '#9EA2C4', '#C68B74', '#86B3A2'];

const pad2 = (n: number): string => String(n).padStart(2, '0');

function dateLabel(iso: string): string {
  const date = new Date(iso);
  return `${date.getFullYear()}.${pad2(date.getMonth() + 1)}.${pad2(date.getDate())}`;
}

export function cardLines(view: ShareView): CardLines {
  return {
    kicker: `JOURNEY SELECTION · NO.${pad2(view.selectionNo)}`,
    title: `第 ${view.selectionNo} 本旅程精選集`,
    meta: `${dateLabel(view.createdAt)} · 五趟留下的五首`,
    tracks: view.tracks.map((track) => ({ title: track.title, artist: track.artist })),
    footer: 'Qualia fm',
  };
}

export function imageFileName(view: ShareView): string {
  return `qualia-journey-selection-${pad2(view.selectionNo)}.png`;
}

const WIDTH = 1080;
const HEIGHT = 1350;
const MARGIN = 96;
const FONT = '-apple-system, BlinkMacSystemFont, "PingFang TC", "Noto Sans CJK TC", sans-serif';
const DISPLAY = 'Georgia, "Times New Roman", "Songti TC", serif';
const NIGHT_INK = '#EEF0E4';
const NIGHT_MUTED = '#B9C4B6';

/** 太長的字截斷加「…」，不讓文字超出卡片。 */
function fitted(context: CanvasRenderingContext2D, text: string, maxWidth: number): string {
  if (context.measureText(text).width <= maxWidth) return text;
  const chars = [...text];
  while (chars.length > 1 && context.measureText(`${chars.join('')}…`).width > maxWidth) chars.pop();
  return `${chars.join('')}…`;
}

function drawBackground(context: CanvasRenderingContext2D): void {
  const gradient = context.createLinearGradient(0, 0, WIDTH, HEIGHT);
  gradient.addColorStop(0, '#34574A');
  gradient.addColorStop(1, '#1B3530');
  context.fillStyle = gradient;
  context.fillRect(0, 0, WIDTH, HEIGHT);
  context.strokeStyle = 'rgba(228, 233, 216, 0.07)';
  context.lineWidth = 2;
  for (let r = 120; r < 1400; r += 46) {
    context.beginPath();
    context.arc(WIDTH * 1.1, HEIGHT * 1.2, r, 0, Math.PI * 2);
    context.stroke();
  }
}

function drawGem(context: CanvasRenderingContext2D, x: number, y: number, size: number, color: string): void {
  const p = (px: number, py: number): [number, number] => [x + (px / 100) * size, y + (py / 100) * size];
  context.fillStyle = color;
  context.beginPath();
  for (const [index, point] of [p(20, 12), p(80, 12), p(100, 38), p(50, 94), p(0, 38)].entries()) {
    if (index === 0) context.moveTo(...point);
    else context.lineTo(...point);
  }
  context.closePath();
  context.fill();
}

/** 在瀏覽器裡把分享卡畫成 PNG。 */
export function renderCardPng(view: ShareView, doc: Document = document): Promise<Blob> {
  const canvas = doc.createElement('canvas');
  canvas.width = WIDTH;
  canvas.height = HEIGHT;
  const context = canvas.getContext('2d');
  if (!context) return Promise.reject(new Error('canvas 2d context unavailable'));
  const lines = cardLines(view);
  const textWidth = WIDTH - MARGIN * 2;
  drawBackground(context);
  context.textBaseline = 'alphabetic';
  context.fillStyle = NIGHT_MUTED;
  context.font = `600 30px ${FONT}`;
  context.fillText(lines.kicker, MARGIN, 190);
  context.fillStyle = NIGHT_INK;
  context.font = `400 76px ${DISPLAY}`;
  context.fillText(fitted(context, lines.title, textWidth), MARGIN, 300);
  context.fillStyle = NIGHT_MUTED;
  context.font = `400 32px ${FONT}`;
  context.fillText(lines.meta, MARGIN, 360);
  lines.tracks.forEach((track, index) => {
    const y = 500 + index * 140;
    drawGem(context, MARGIN, y - 42, 48, GEM_COLORS[view.tracks[index]!.palette % GEM_COLORS.length]!);
    context.fillStyle = NIGHT_INK;
    context.font = `600 44px ${FONT}`;
    context.fillText(fitted(context, track.title, textWidth - 80), MARGIN + 80, y);
    context.fillStyle = NIGHT_MUTED;
    context.font = `400 30px ${FONT}`;
    context.fillText(fitted(context, track.artist, textWidth - 80), MARGIN + 80, y + 46);
  });
  context.strokeStyle = 'rgba(228, 233, 216, 0.18)';
  context.beginPath();
  context.moveTo(MARGIN, HEIGHT - 150);
  context.lineTo(WIDTH - MARGIN, HEIGHT - 150);
  context.stroke();
  context.fillStyle = NIGHT_INK;
  context.font = `italic 400 44px ${DISPLAY}`;
  context.fillText(lines.footer, MARGIN, HEIGHT - 84);
  context.fillStyle = NIGHT_MUTED;
  context.font = `400 30px ${FONT}`;
  context.textAlign = 'right';
  context.fillText('旅程精選集', WIDTH - MARGIN, HEIGHT - 88);
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('canvas toBlob returned null'))), 'image/png');
  });
}
