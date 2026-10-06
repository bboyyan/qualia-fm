/**
 * BRA-128 寶石遊戲：種子＝1 顆寶石；一首歌聽完或送出回饋＝鑲嵌 1 顆；滿 5 顆開出「旅程膠囊」
 * （更長的 DJ 結語＋曲目＋情緒標籤），寶石盤清空開始下一段旅程。純函式、不可變；只存在記憶體
 * （種子文字可能敏感，同 D-11 不寫 localStorage），也不送伺服器或模型。
 */
import { DJ_LINE_MAX_GRAPHEMES, countGraphemes, type FeedbackRating } from '@qualia/contracts';

export const GEMS_PER_CAPSULE = 5;
/** 結語上限：比單段 DJ 串詞（DJ_LINE_MAX_GRAPHEMES）長，但仍是一段讀得完的話。 */
export const CAPSULE_OUTRO_MAX_GRAPHEMES = 360;
export const CAPSULE_MOOD_TAG_LIMIT = 4;
/** 已鑲過的鍵只留最近這麼多個，夠擋「從頭再聽」重複鑲嵌，不無限長大。 */
const SEEN_LIMIT = 200;
const SEED_QUOTE_MAX = 20;
const TITLE_QUOTE_MAX = 24;
const ARTIST_MAX = 12;

export interface SeedInput {
  readonly key: string;
  readonly seed: string;
}

export interface TrackInput {
  readonly key: string;
  readonly title: string;
  readonly artist: string;
  readonly vibe: readonly string[];
}

export interface SeedGem extends SeedInput {
  readonly kind: 'seed';
}

export type TrackSource = 'listened' | 'feedback';

export interface TrackGem extends TrackInput {
  readonly kind: 'track';
  readonly source: TrackSource;
  readonly rating: FeedbackRating | null;
}

export type Gem = SeedGem | TrackGem;

export interface Capsule {
  readonly id: number;
  readonly gems: readonly Gem[];
  readonly seeds: readonly string[];
  readonly tracks: readonly TrackGem[];
  readonly moodTags: readonly string[];
  readonly outro: string;
}

export interface Journey {
  /** 目前這段旅程已鑲的寶石（0–4 顆；第 5 顆鑲上即封進膠囊）。 */
  readonly gems: readonly Gem[];
  readonly seen: readonly string[];
  /** 最近一次開出的膠囊。 */
  readonly capsule: Capsule | null;
  readonly capsuleOpened: boolean;
  readonly capsuleCount: number;
}

export const EMPTY_JOURNEY: Journey = { gems: [], seen: [], capsule: null, capsuleOpened: false, capsuleCount: 0 };

const remember = (seen: readonly string[], key: string): readonly string[] => [...seen, key].slice(-SEEN_LIMIT);

/** 一顆種子＝一顆寶石。還沒聽任何一首就換種子時，新種子取代待命的那顆，不能只靠開台湊滿。 */
export function addSeedGem(journey: Journey, input: SeedInput): Journey {
  if (journey.seen.includes(input.key)) return journey;
  const gem: SeedGem = { kind: 'seed', key: input.key, seed: input.seed };
  const last = journey.gems.at(-1);
  const gems = last?.kind === 'seed' ? [...journey.gems.slice(0, -1), gem] : [...journey.gems, gem];
  return seal({ ...journey, gems, seen: remember(journey.seen, input.key) });
}

/**
 * 聽完或回饋一首＝鑲嵌一顆；同一首只算一次。後到的回饋只把評價補上（若已封進膠囊，連膠囊與結語一起更新）。
 */
export function inlayTrack(journey: Journey, input: TrackInput, source: TrackSource, rating: FeedbackRating | null = null): Journey {
  if (!journey.seen.includes(input.key)) {
    const gem: TrackGem = { kind: 'track', key: input.key, title: input.title, artist: input.artist, vibe: input.vibe, source, rating };
    return seal({ ...journey, gems: [...journey.gems, gem], seen: remember(journey.seen, input.key) });
  }
  if (rating === null) return journey;
  return rateExisting(journey, input.key, rating);
}

/** 這趟（引擎 sessionId）有份的最近一顆膠囊；結算畫面引用它，不再開第二顆（BRA-169）。 */
export function capsuleFor(journey: Journey, sessionId: string): Capsule | null {
  const capsule = journey.capsule;
  if (!capsule) return null;
  const mine = capsule.gems.some((gem) => gem.key === `seed:${sessionId}` || gem.key.startsWith(`${sessionId}:`));
  return mine ? capsule : null;
}

export function markCapsuleOpened(journey: Journey): Journey {
  return journey.capsule && !journey.capsuleOpened ? { ...journey, capsuleOpened: true } : journey;
}

function rateGems(gems: readonly Gem[], key: string, rating: FeedbackRating): readonly Gem[] | null {
  const index = gems.findIndex((g) => g.kind === 'track' && g.key === key);
  const target = gems[index];
  if (!target || target.kind !== 'track' || target.rating === rating) return null;
  return gems.map((g, i) => (i === index ? { ...target, rating } : g));
}

function rateExisting(journey: Journey, key: string, rating: FeedbackRating): Journey {
  const gems = rateGems(journey.gems, key, rating);
  if (gems) return { ...journey, gems };
  const capsuleGems = journey.capsule ? rateGems(journey.capsule.gems, key, rating) : null;
  if (!capsuleGems || !journey.capsule) return journey;
  return { ...journey, capsule: buildCapsule(journey.capsule.id, capsuleGems) };
}

function seal(journey: Journey): Journey {
  if (journey.gems.length < GEMS_PER_CAPSULE) return journey;
  const id = journey.capsuleCount + 1;
  return { ...journey, gems: [], capsule: buildCapsule(id, journey.gems), capsuleOpened: false, capsuleCount: id };
}

export function buildCapsule(id: number, gems: readonly Gem[]): Capsule {
  const seeds = gems.flatMap((g) => (g.kind === 'seed' ? [g.seed] : []));
  const tracks = gems.filter((g): g is TrackGem => g.kind === 'track');
  const tags = moodTags(tracks);
  return { id, gems, seeds, tracks, moodTags: tags, outro: composeOutro(seeds, tracks, tags) };
}

/** 情緒標籤：曲目感覺關鍵字依出現次數排序（同次數依先出現），去空白、去重，最多 4 個。 */
export function moodTags(tracks: readonly TrackGem[]): readonly string[] {
  const counts = new Map<string, number>();
  for (const tag of tracks.flatMap((t) => t.vibe.map((v) => v.trim()))) {
    if (tag) counts.set(tag, (counts.get(tag) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([tag, count], order) => ({ tag, count, order }))
    .sort((a, b) => b.count - a.count || a.order - b.order)
    .slice(0, CAPSULE_MOOD_TAG_LIMIT)
    .map((entry) => entry.tag);
}

const segmenter = new Intl.Segmenter('zh-TW', { granularity: 'grapheme' });

function clip(text: string, max: number): string {
  const clean = text.replace(/\s+/g, ' ').trim();
  if (countGraphemes(clean) <= max) return clean;
  const parts = Array.from(segmenter.segment(clean), (s) => s.segment);
  return `${parts.slice(0, Math.max(0, max - 1)).join('')}…`;
}

const quote = (text: string, max: number): string => `「${clip(text, max)}」`;

function joinAnd(items: readonly string[]): string {
  if (items.length <= 1) return items.join('');
  return `${items.slice(0, -1).join('、')}與${items.at(-1)}`;
}

function openingLine(seeds: readonly string[], trackCount: number): string {
  const first = seeds[0];
  const last = seeds.at(-1);
  const from = !first ? '這趟旅程' : seeds.length === 1 || !last ? `這趟旅程從${quote(first, SEED_QUOTE_MAX)}出發` : `這趟旅程從${quote(first, SEED_QUOTE_MAX)}出發，轉進${quote(last, SEED_QUOTE_MAX)}`;
  return `${from}，一共鑲進了 ${trackCount} 首歌。`;
}

function detailLine(tracks: readonly TrackGem[]): string {
  const phrases = tracks.map((t, i) => {
    // 每首輪流取不同位置的感覺詞，四首不會都念同一個詞。
    const vibe = (t.vibe[i % Math.max(1, t.vibe.length)] ?? t.vibe[0])?.trim();
    // 藝人名過長就不念，避免結語中間出現被截斷的名字。
    const artist = t.artist.trim();
    const title = artist && countGraphemes(artist) <= ARTIST_MAX ? `${artist}的${quote(t.title, TITLE_QUOTE_MAX)}` : quote(t.title, TITLE_QUOTE_MAX);
    if (i > 0 && i === tracks.length - 1) return vibe ? `最後停在${title}的${vibe}` : `最後停在${title}`;
    return vibe ? `${title}帶著${vibe}` : title;
  });
  return phrases.length ? `一路上，${phrases.join('，')}。` : '';
}

function titlesLine(tracks: readonly TrackGem[]): string {
  return tracks.length ? `一路上有${tracks.map((t) => quote(t.title, TITLE_QUOTE_MAX)).join('、')}。` : '';
}

function ratingLines(tracks: readonly TrackGem[]): string[] {
  const loved = tracks.filter((t) => t.rating === '愛');
  const off = tracks.filter((t) => t.rating === '不對');
  const lines: string[] = [];
  if (loved[0]) lines.push(`你把愛留給了${quote(loved[0].title, TITLE_QUOTE_MAX)}${loved.length > 1 ? `等 ${loved.length} 首` : ''}。`);
  if (off[0]) lines.push(`${quote(off[0].title, TITLE_QUOTE_MAX)}沒有對上，謝謝你直說。`);
  return lines;
}

/**
 * 旅程膠囊的 DJ 結語：開場（種子）→ 每首一句（藝人＋曲名＋感覺）→ 情緒標籤 → 評價 → 寶石由來 → 收尾。超過上限時依序改用只列曲名、
 * 拿掉評價句，最後才硬截斷；短稿補上收聽回望，確保超過單段 DJ 上限且不超過 CAPSULE_OUTRO_MAX_GRAPHEMES。
 */
export function composeOutro(seeds: readonly string[], tracks: readonly TrackGem[], tags: readonly string[]): string {
  const opening = openingLine(seeds, tracks.length);
  const mood = tags.length ? `如果把這一段收成幾個詞，大概是${joinAnd(tags)}。` : '';
  const moments = '每一顆寶石，都是你按下開台、把一首歌聽到最後，或說出感受的那一刻。';
  const thanks = '謝謝你陪這個頻率一路聽到這裡。';
  const closing = `${GEMS_PER_CAPSULE} 顆寶石都鑲好了，這段旅程先收進膠囊；下一次，從你留下的感覺再出發。`;
  const ratings = ratingLines(tracks);
  const drafts = [
    [opening, detailLine(tracks), mood, ...ratings, moments, thanks, closing],
    [opening, titlesLine(tracks), mood, ...ratings, moments, thanks, closing],
    [opening, titlesLine(tracks), mood, closing],
  ].map((parts) => parts.filter(Boolean).join(''));
  const fitting = drafts.find((text) => countGraphemes(text) <= CAPSULE_OUTRO_MAX_GRAPHEMES);
  const outro = fitting ?? clip(drafts.at(-1) ?? '', CAPSULE_OUTRO_MAX_GRAPHEMES);
  if (countGraphemes(outro) > DJ_LINE_MAX_GRAPHEMES) return outro;
  // 每句都短於上下限之差；補到超過下限就停，保留完整句子與原本的收尾。
  const reflections = [
    '回頭看，曲目之間的停留也成了這段旅程的一部分，不必急著替每一刻下結論。',
    '你可以再看看留下的曲名，想想哪一首讓你願意多停一下，哪一首適合留待以後。',
    '此刻先把這些片段放在一起，讓這個小小的膠囊記住你曾經在這裡聽過的聲音。',
  ];
  let expanded = outro.slice(0, -closing.length);
  for (const reflection of reflections) {
    expanded += reflection;
    if (countGraphemes(expanded + closing) > DJ_LINE_MAX_GRAPHEMES) break;
  }
  return expanded + closing;
}
