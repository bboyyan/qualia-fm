/**
 * BRA-128 寶石遊戲＋旅程膠囊：種子＋1、聽完／回饋鑲嵌、滿 5 開膠囊；膠囊有更長結語、曲目、情緒標籤。
 */
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { DJ_LINE_MAX_GRAPHEMES, countGraphemes } from '@qualia/contracts';
import {
  CAPSULE_OUTRO_MAX_GRAPHEMES,
  EMPTY_JOURNEY,
  GEMS_PER_CAPSULE,
  addSeedGem,
  composeOutro,
  inlayTrack,
  markCapsuleOpened,
  moodTags,
  type Journey,
  type TrackGem,
  type TrackInput,
} from '../src/features/journey/journey';
import { JourneyTracker } from '../src/features/journey/journeyTracker';
import { CapsuleCard } from '../src/features/journey/CapsuleCard';
import { GemSlots } from '../src/features/journey/GemTray';
import { reduce, initialEngineState } from '../src/audio/reducer';
import type { EngineState } from '../src/audio/types';
import { makeShow } from './fixtures';

const track = (n: number, vibe: readonly string[] = ['溫柔', '夜色', '微光']): TrackInput => ({
  key: `s1:seg${n}`,
  title: `夜行列車 ${n}`,
  artist: `藝人 ${n}`,
  vibe,
});

function fullJourney(): Journey {
  let journey = addSeedGem(EMPTY_JOURNEY, { key: 'seed:s1', seed: '下雨的深夜，一個人走回家' });
  for (let n = 1; n <= 4; n += 1) journey = inlayTrack(journey, track(n), 'listened');
  return journey;
}

describe('寶石：種子與鑲嵌', () => {
  it('種子算一顆寶石', () => {
    const journey = addSeedGem(EMPTY_JOURNEY, { key: 'seed:s1', seed: '深夜' });
    expect(journey.gems).toEqual([{ kind: 'seed', key: 'seed:s1', seed: '深夜' }]);
  });

  it('同一個種子不重複加寶石', () => {
    const once = addSeedGem(EMPTY_JOURNEY, { key: 'seed:s1', seed: '深夜' });
    expect(addSeedGem(once, { key: 'seed:s1', seed: '深夜' })).toBe(once);
  });

  it('還沒聽任何一首就換種子：取代待命的種子寶石，不會只靠種子湊滿', () => {
    let journey = EMPTY_JOURNEY;
    for (let n = 1; n <= 6; n += 1) journey = addSeedGem(journey, { key: `seed:s${n}`, seed: `種子 ${n}` });
    expect(journey.gems).toHaveLength(1);
    expect(journey.gems[0]).toMatchObject({ kind: 'seed', seed: '種子 6' });
    expect(journey.capsule).toBeNull();
  });

  it('聽完一首鑲嵌一顆寶石', () => {
    const journey = inlayTrack(EMPTY_JOURNEY, track(1), 'listened');
    expect(journey.gems).toEqual([{ kind: 'track', source: 'listened', rating: null, ...track(1) }]);
  });

  it('只回饋（沒聽完）也鑲嵌一顆，並記下評價', () => {
    const journey = inlayTrack(EMPTY_JOURNEY, track(1), 'feedback', '愛');
    expect(journey.gems[0]).toMatchObject({ kind: 'track', source: 'feedback', rating: '愛' });
  });

  it('同一首聽完又回饋只算一顆，評價補到原本的寶石上', () => {
    const listened = inlayTrack(EMPTY_JOURNEY, track(1), 'listened');
    const rated = inlayTrack(listened, track(1), 'feedback', '不對');
    expect(rated.gems).toHaveLength(1);
    expect(rated.gems[0]).toMatchObject({ source: 'listened', rating: '不對' });
  });

  it('同一首重複聽完（從頭再聽）不再加寶石', () => {
    const once = inlayTrack(EMPTY_JOURNEY, track(1), 'listened');
    expect(inlayTrack(once, track(1), 'listened')).toBe(once);
  });
});

describe('滿 5 開旅程膠囊', () => {
  it('第 5 顆寶石鑲上就開出膠囊，寶石盤清空開始下一段旅程', () => {
    const journey = fullJourney();
    expect(GEMS_PER_CAPSULE).toBe(5);
    expect(journey.gems).toEqual([]);
    expect(journey.capsule?.gems).toHaveLength(5);
    expect(journey.capsuleOpened).toBe(false);
  });

  it('只有 4 顆時還沒有膠囊', () => {
    let journey = addSeedGem(EMPTY_JOURNEY, { key: 'seed:s1', seed: '深夜' });
    for (let n = 1; n <= 3; n += 1) journey = inlayTrack(journey, track(n), 'listened');
    expect(journey.gems).toHaveLength(4);
    expect(journey.capsule).toBeNull();
  });

  it('膠囊收錄種子與曲目（依鑲嵌順序）', () => {
    const capsule = fullJourney().capsule!;
    expect(capsule.seeds).toEqual(['下雨的深夜，一個人走回家']);
    expect(capsule.tracks.map((t) => t.title)).toEqual(['夜行列車 1', '夜行列車 2', '夜行列車 3', '夜行列車 4']);
  });

  it('膠囊開出後才回饋最後一首：評價補進膠囊，結語跟著更新', () => {
    const sealed = fullJourney();
    const rated = inlayTrack(sealed, track(4), 'feedback', '愛');
    expect(rated.gems).toEqual([]);
    expect(rated.capsule?.tracks[3]?.rating).toBe('愛');
    expect(rated.capsule?.outro).toContain('「夜行列車 4」');
    expect(rated.capsule?.outro).not.toBe(sealed.capsule?.outro);
  });

  it('打開膠囊只標記已開，不清掉內容', () => {
    const opened = markCapsuleOpened(fullJourney());
    expect(opened.capsuleOpened).toBe(true);
    expect(opened.capsule?.tracks).toHaveLength(4);
  });

  it('第二個膠囊編號遞增', () => {
    let journey = fullJourney();
    journey = addSeedGem(journey, { key: 'seed:s2', seed: '早晨' });
    for (let n = 5; n <= 8; n += 1) journey = inlayTrack(journey, track(n), 'listened');
    expect(journey.capsule?.id).toBe(2);
    expect(journey.capsule?.seeds).toEqual(['早晨']);
  });
});

describe('膠囊內容：更長結語＋情緒標籤', () => {
  it('結語比單段 DJ 串詞上限更長，但有自己的上限', () => {
    const outro = fullJourney().capsule!.outro;
    expect(countGraphemes(outro)).toBeGreaterThan(DJ_LINE_MAX_GRAPHEMES);
    expect(countGraphemes(outro)).toBeLessThanOrEqual(CAPSULE_OUTRO_MAX_GRAPHEMES);
  });

  it('結語提到種子、每首曲名與情緒標籤', () => {
    const outro = fullJourney().capsule!.outro;
    expect(outro).toContain('下雨的深夜');
    for (let n = 1; n <= 4; n += 1) expect(outro).toContain(`「夜行列車 ${n}」`);
    expect(outro).toContain('溫柔');
  });

  it('曲名極長時仍不超過結語上限', () => {
    const long = (n: number): TrackGem => ({ kind: 'track', source: 'listened', rating: '愛', key: `k${n}`, title: '長'.repeat(200), artist: 'a', vibe: ['很長的感覺標籤很長的感覺標籤', 'b', 'c'] });
    const outro = composeOutro(['種'.repeat(500)], [long(1), long(2), long(3), long(4)], ['標籤一', '標籤二']);
    expect(countGraphemes(outro)).toBeLessThanOrEqual(CAPSULE_OUTRO_MAX_GRAPHEMES);
  });

  it('情緒標籤依出現次數排序、去重，最多 4 個', () => {
    const gem = (vibe: string[]): TrackGem => ({ kind: 'track', source: 'listened', rating: null, key: vibe.join(), title: 't', artist: 'a', vibe });
    const tags = moodTags([gem(['夜色', '溫柔', '慢']), gem(['溫柔', '夜色', '冷']), gem(['溫柔', '雨', ' ']), gem(['亮', '風', '光'])]);
    expect(tags).toEqual(['溫柔', '夜色', '慢', '冷']);
  });
});

describe('JourneyTracker：接播放引擎與回饋', () => {
  function run(state: EngineState, ...actions: Parameters<typeof reduce>[1][]): EngineState {
    return actions.reduce((s, action) => reduce(s, action).state, state);
  }
  const loaded = (sessionId: string): EngineState =>
    run({ ...initialEngineState(true, true), feedbackEnabled: true }, { type: 'LOAD_SHOW', show: makeShow(`show-${sessionId}`), sessionId });
  const finishTrack = (state: EngineState): EngineState => ({
    ...state,
    statuses: { ...state.statuses, [state.queue[state.currentIndex]!.segment.segmentId]: 'played' },
    currentIndex: state.currentIndex + 1,
  });

  it('載入節目＝種子寶石；曲目播完＝鑲嵌', () => {
    const tracker = new JourneyTracker();
    const state = loaded('s1');
    tracker.observe(state);
    expect(tracker.getState().gems.map((g) => g.kind)).toEqual(['seed']);
    tracker.observe(finishTrack(state));
    expect(tracker.getState().gems).toHaveLength(2);
    expect(tracker.getState().gems[1]).toMatchObject({ kind: 'track', title: '曲目1', source: 'listened' });
  });

  it('同一狀態重複觀察不重複鑲嵌、也不通知', () => {
    const tracker = new JourneyTracker();
    const listener = vi.fn();
    const state = finishTrack(loaded('s1'));
    tracker.observe(state);
    tracker.subscribe(listener);
    tracker.observe(state);
    expect(listener).not.toHaveBeenCalled();
  });

  it('回饋送出即鑲嵌並帶評價', () => {
    const tracker = new JourneyTracker();
    const state = loaded('s1');
    tracker.recordFeedback('s1', state.queue[0]!, '還行');
    expect(tracker.getState().gems[0]).toMatchObject({ kind: 'track', rating: '還行', source: 'feedback' });
  });

  it('第 5 顆寶石只通知一次膠囊開好了', () => {
    const onCapsule = vi.fn();
    const tracker = new JourneyTracker(onCapsule);
    let state = loaded('s1');
    tracker.observe(state);
    for (let n = 0; n < 4; n += 1) {
      state = finishTrack(state);
      tracker.observe(state);
    }
    tracker.observe(state);
    expect(onCapsule).toHaveBeenCalledTimes(1);
    expect(onCapsule.mock.calls[0]![0].tracks).toHaveLength(4);
    tracker.openCapsule();
    expect(tracker.getState().capsuleOpened).toBe(true);
  });
});

describe('UI 呈現', () => {
  it('寶石盤顯示 5 格與已鑲數量', () => {
    const journey = inlayTrack(addSeedGem(EMPTY_JOURNEY, { key: 'seed:s1', seed: '深夜' }), track(1), 'listened');
    const html = renderToStaticMarkup(createElement(GemSlots, { gems: journey.gems }));
    expect(html.match(/data-gem=/g)).toHaveLength(5);
    expect(html).toContain('data-gem="seed"');
    expect(html).toContain('data-gem="listened"');
    expect(html.match(/data-gem="empty"/g)).toHaveLength(3);
  });

  it('膠囊卡呈現曲目、情緒標籤與結語，不含測試雜訊', () => {
    const capsule = inlayTrack(fullJourney(), track(2), 'feedback', '愛').capsule!;
    const html = renderToStaticMarkup(createElement(CapsuleCard, { capsule }));
    for (let n = 1; n <= 4; n += 1) expect(html).toContain(`夜行列車 ${n}`);
    expect(html).toContain('藝人 1');
    expect(html).toContain('data-testid="capsule-tags"');
    expect(html).toContain('溫柔');
    expect(html).toContain('data-testid="capsule-outro"');
    expect(html).toContain('DJ 結語');
    expect(html).toContain('aria-label="愛"');
    expect(html).not.toMatch(/MOCK|TEST|假帳本/);
  });
});
