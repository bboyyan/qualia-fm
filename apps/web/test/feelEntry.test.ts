/**
 * BRA-170：開台入口「從一首歌／從一種感覺」。情境標籤單選、組句、範例 chip 取代、主按鈕文案、
 * 順便修 A（清單只有 1 首時不出現「全選・」）。
 */
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { PlanRequestSchema } from '@qualia/contracts';
import { DEFAULT_SETTINGS } from '../src/features/settings/settings';
import { startLabel } from '../src/features/seed/selection';
import { SeedComposer } from '../src/features/seed/SeedComposer';
import {
  DEFAULT_DRAFT,
  MOOD_PRESETS,
  addSongSeed,
  applyExample,
  composeFeelingText,
  draftProblem,
  draftSeedText,
  feelingStartLabel,
  songStartLabel,
  toPlanRequest,
  toggleMood,
  type Draft,
} from '../src/features/seed/seedList';

const noop = () => undefined;
const feeling = (patch: Partial<Draft> = {}): Draft => ({ ...DEFAULT_DRAFT, kind: 'feeling', ...patch });
const HEARTBREAK = '失戀後的心情：有點空、溫柔，慢慢走出來';

describe('MOOD_PRESETS：8 個情境標籤，prompt 照 README 一字不改', () => {
  it('順序與 label／prompt 對得上設計稿的表', () => {
    expect(MOOD_PRESETS.map((mood) => [mood.label, mood.prompt])).toEqual([
      ['平靜', '平靜下來的心情：放慢呼吸，柔和、多一點留白'],
      ['振奮', '想被振奮：明亮、有推進感，讓人想動起來'],
      ['健身', '運動時穩定推進的節奏與能量'],
      ['失戀', HEARTBREAK],
      ['深夜', '深夜獨處：安靜、貼近耳邊，不吵醒誰'],
      ['通勤', '通勤路上：順順地往前走，不打擾思緒'],
      ['專注', '需要專注：穩定、少人聲，不搶注意力'],
      ['雨天', '雨天的氣氛：潮濕、慵懶，帶一點溫度'],
    ]);
  });
});

describe('composeFeelingText：組 seed.text', () => {
  it('只有標籤：就是 prompt', () => {
    expect(composeFeelingText('heartbreak', '')).toBe(HEARTBREAK);
  });

  it('標籤＋自訂句：prompt。自訂句（去頭尾空白）', () => {
    expect(composeFeelingText('heartbreak', '  下班一個人走回家 \n')).toBe(`${HEARTBREAK}。下班一個人走回家`);
  });

  it('只有自訂句：自訂句去頭尾空白', () => {
    expect(composeFeelingText(null, ' 下班一個人走回家 ')).toBe('下班一個人走回家');
  });

  it('全空（含只有空白）：空字串', () => {
    expect(composeFeelingText(null, '   ')).toBe('');
    expect(composeFeelingText(undefined, undefined)).toBe('');
  });
});

describe('draftProblem（從一種感覺）', () => {
  it('全空：提示先選一個感覺，或寫一句', () => {
    expect(draftProblem(feeling())).toBe('先選一個感覺，或寫一句。');
  });

  it('只有標籤或只有句子都可以送出', () => {
    expect(draftProblem(feeling({ mood: 'rainy' }))).toBeNull();
    expect(draftProblem(feeling({ feelingText: '一句' }))).toBeNull();
  });

  it('500 字邊界：算的是組好的全文', () => {
    const fit = '夜'.repeat(500 - [...HEARTBREAK].length - 1);
    expect(draftProblem(feeling({ mood: 'heartbreak', feelingText: fit }))).toBeNull();
    expect(draftProblem(feeling({ mood: 'heartbreak', feelingText: `${fit}夜` }))).toContain('500 字以內');
    expect(draftProblem(feeling({ feelingText: '夜'.repeat(500) }))).toBeNull();
    expect(draftProblem(feeling({ feelingText: '夜'.repeat(501) }))).toContain('500 字以內');
  });
});

describe('toggleMood：單選，再點取消', () => {
  it('選一個；選另一個會換掉；再點同一個取消', () => {
    const one = toggleMood(feeling(), 'calm');
    expect(one.mood).toBe('calm');
    expect(toggleMood(one, 'focus').mood).toBe('focus');
    expect(toggleMood(one, 'calm').mood).toBeNull();
  });

  it('不改原本的草稿', () => {
    const draft = feeling();
    toggleMood(draft, 'calm');
    expect(draft.mood).toBeNull();
  });
});

describe('applyExample：範例 chip 取代「再補一句」', () => {
  it('從一種感覺：取代目前的句子，不附加；標籤保留', () => {
    const next = applyExample(feeling({ mood: 'late-night', feelingText: '原本的句子' }), '夜裡慢慢放鬆');
    expect(next.feelingText).toBe('夜裡慢慢放鬆');
    expect(next.mood).toBe('late-night');
  });

  it('再點同一個 chip：清空這一欄', () => {
    expect(applyExample(feeling({ feelingText: '夜裡慢慢放鬆' }), '夜裡慢慢放鬆').feelingText).toBe('');
  });

  it('從一首歌：切到從一種感覺並填入，不選標籤，歌曲勾選與歌名欄保留', () => {
    const song = { ...addSongSeed(DEFAULT_DRAFT, 'Second', 'Artist'), text: '輸入中的歌名' };
    const next = applyExample(song, '想找回一點精神');
    expect(next.kind).toBe('feeling');
    expect(next.feelingText).toBe('想找回一點精神');
    expect(next.mood ?? null).toBeNull();
    expect(next.selectedSeedIds).toEqual(song.selectedSeedIds);
    expect(next.text).toBe('輸入中的歌名');
  });
});

describe('feelingStartLabel：主按鈕文案依狀態表', () => {
  it('有標籤：從「X」開台／從「X」建立下一段', () => {
    expect(feelingStartLabel(feeling({ mood: 'heartbreak' }), false)).toBe('從「失戀」開台');
    expect(feelingStartLabel(feeling({ mood: 'heartbreak', feelingText: '一句' }), true)).toBe('從「失戀」建立下一段');
  });

  it('只有自訂句或全空：為我開台／建立下一段', () => {
    expect(feelingStartLabel(feeling({ feelingText: '一句' }), false)).toBe('為我開台');
    expect(feelingStartLabel(feeling(), false)).toBe('為我開台');
    expect(feelingStartLabel(feeling(), true)).toBe('建立下一段');
  });
});

describe('toPlanRequest（從一種感覺）：契約不變', () => {
  it('seed.kind=feeling、text=組句、artist=null', () => {
    const request = toPlanRequest(feeling({ mood: 'heartbreak', feelingText: '下班一個人走回家', text: '歌名欄不送' }), DEFAULT_SETTINGS);
    expect(request.seed).toEqual({ kind: 'feeling', text: `${HEARTBREAK}。下班一個人走回家`, artist: null });
    expect(PlanRequestSchema.safeParse(request).success).toBe(true);
  });

  it('draftSeedText：感覺給組句，歌曲給合併的歌名', () => {
    expect(draftSeedText(feeling({ mood: 'rainy' }))).toBe('雨天的氣氛：潮濕、慵懶，帶一點溫度');
    expect(draftSeedText(DEFAULT_DRAFT)).toBe('Time Flows Ever Onward');
  });
});

describe('舊草稿相容：沒有 mood／feelingText 欄位也能安全使用', () => {
  const legacy = { kind: 'feeling', text: '舊的感覺輸入', artist: '', seeds: DEFAULT_DRAFT.seeds, selectedSeedIds: [] } as Draft;

  it('缺欄位視為沒選標籤、沒寫句子', () => {
    expect(composeFeelingText(legacy.mood, legacy.feelingText)).toBe('');
    expect(draftProblem(legacy)).toBe('先選一個感覺，或寫一句。');
    expect(feelingStartLabel(legacy, false)).toBe('為我開台');
    expect(toggleMood(legacy, 'calm').mood).toBe('calm');
  });

  it('預設草稿已帶 mood=null、feelingText=空字串，停在從一首歌', () => {
    expect(DEFAULT_DRAFT.kind).toBe('song');
    expect(DEFAULT_DRAFT.mood).toBeNull();
    expect(DEFAULT_DRAFT.feelingText).toBe('');
  });
});

describe('順便修 A：清單只有 1 首時不出現「全選・」', () => {
  it('startLabel：1／1 只寫動詞；2 首以上全選維持「全選・」；部分選說明數量', () => {
    expect(startLabel('快速開台', 1, 1)).toBe('快速開台');
    expect(startLabel('建立下一段', 1, 1)).toBe('建立下一段');
    expect(startLabel('快速開台', 2, 2)).toBe('全選・快速開台');
    expect(startLabel('快速開台', 1, 2)).toBe('快速開台（已選 1／2）');
  });

  it('預設草稿（只有預設種子、已選）：快速開台', () => {
    expect(songStartLabel('快速開台', DEFAULT_DRAFT, false)).toBe('快速開台');
  });
});

// 從一種感覺的畫面（標籤、預覽、停用）由 e2e/feel-entry.spec.ts 驗：SSR 只會渲染 store 的初始狀態。
describe('SeedComposer：兩格入口、無徽章', () => {
  const render = (continuing = false) => renderToStaticMarkup(createElement(SeedComposer, { continuing, onSubmit: noop }));

  it('預設停在從一首歌；只有兩格，沒有聲音入口', () => {
    const html = render();
    expect(html).toMatch(/role="radio"[^>]*aria-checked="true"[^>]*>[\s\S]*?從一首歌/);
    expect(html).toContain('從一種感覺');
    expect(html.match(/role="radio"/g)).toHaveLength(2);
    expect(html).not.toContain('聲音');
  });

  it('範例 chips 有小標「常用的一句感受」', () => {
    expect(render()).toContain('常用的一句感受');
  });
});
