/** Fictional TEST catalogue: titles are retained for UI identity only, with no taste claims. */
export const MOCK_ARTIST = 'Qualia Mock · 虛構藝人';
export interface MockEntry {
  readonly title: string;
  readonly seedBridge: string;
  readonly vibe: readonly [string, string, string];
  readonly djShort: string;
  readonly djStandard: string;
  readonly transition: { readonly text: string; readonly djLine: string } | null;
}
function testEntry(title: string, index: number, transitions: boolean): MockEntry {
  return {
    title,
    seedBridge: 'TEST 假推薦：僅示範起點連結，不推測你的偏好或曲目質地。',
    vibe: ['TEST 示意一', 'TEST 示意二', 'TEST 示意三'],
    djShort: 'TEST 下一首是虛構示範曲目，不代表真實音樂推薦。',
    // 加厚版（BRA-117）：曲名、藝人、為什麼接這首、聽的時候注意什麼；全是 TEST 示意，不是真實推薦。
    djStandard: `TEST 接下來這首是〈${title}〉，藝人是${MOCK_ARTIST}。為什麼接這首：這只是示範用的虛構理由，沒有分析任何音樂，也不推測你的偏好。聽的時候可以留意：這是合成測試音，不是真的歌。`,
    transition: transitions && index >= 1 && index <= 3 ? {
      text: 'TEST 相鄰曲目接續示意，不推測音色或偏好。',
      djLine: 'TEST 接續下一首虛構示範曲目。',
    } : null,
  };
}
export const BASE_POOL: readonly MockEntry[] = ['微光偏航', '雨後的底片', '柔焦公路', '低空漂浮', '第一道晨光', '慢行星', '夜色餘溫'].map((title, index) => testEntry(title, index, true));
export const TUNE_POOL: readonly MockEntry[] = ['紙飛機練習曲', '城市換氣', '有人在唱', '未命名的島', '慢慢醒來'].map((title, index) => testEntry(title, index, false));
