/** 寶石牆文案（BRA-163 03-copy）：純函式，供寶石牆、首屏入口與結算共用。 */
import { GEMS_PER_SELECTION, type GemWall } from '@qualia/contracts';

export const pad2 = (n: number): string => String(n).padStart(2, '0');

export const selectionLabel = (no: number): string => `旅程精選集 No.${pad2(no)}`;

const left = (wall: GemWall): number => GEMS_PER_SELECTION - wall.current.gems.length;

/** 寶石牆主視覺下方的一句進度。 */
export function progressLine(wall: GemWall): string {
  if (wall.total === 0) return '開第一趟，留下第一顆寶石。';
  if (wall.current.gems.length === 0) return `第 ${wall.current.no - 1} 本已收進書架。再 ${GEMS_PER_SELECTION} 趟，開出第 ${wall.current.no} 本。`;
  return `再 ${left(wall)} 趟，就能開出第 ${wall.current.no} 本旅程精選集。`;
}

/** 首屏入口條的一句。 */
export function entryLine(wall: GemWall): string {
  if (wall.total === 0) return '開第一趟，留下第一顆寶石';
  return `再開 ${left(wall)} 趟，串成第 ${wall.current.no} 本旅程精選集`;
}

const dateFormat = new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Taipei', month: '2-digit', day: '2-digit' });

/** 收藏日期（台北時間 MM/DD）。 */
export const dateLabel = (iso: string): string => dateFormat.format(new Date(iso));
