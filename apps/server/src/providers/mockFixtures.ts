/**
 * Fictional TEST catalogue: titles are retained for UI identity only, with no taste claims.
 * BRA-127：候選池 8–12 首（BASE 12、TUNE 8）；前幾首順序固定，E2E 依賴。
 */
export const MOCK_ARTIST = 'Qualia Mock · 虛構藝人';
export interface MockEntry {
  readonly title: string;
  readonly seedBridge: string;
  readonly vibe: readonly [string, string, string];
  readonly djShort: string;
  readonly djStandard: string;
  readonly transition: { readonly text: string; readonly djShort: string; readonly djStandard: string } | null;
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
      djShort: `TEST 接著是〈${title}〉，藝人是${MOCK_ARTIST}。為了示範接歌流程安排這首；聽的時候請留意，這是合成測試音。`,
      djStandard: `TEST 接著是〈${title}〉，藝人是${MOCK_ARTIST}。為什麼接這首：為了示範上一首播完後的接歌流程，這裡安排另一段虛構曲目，沒有分析音樂或推測你的偏好。聽的時候請留意，這是合成測試音，不是真的歌，可以用來確認兩首之間的介紹與播放順序。`,
    } : null,
  };
}
export const BASE_POOL: readonly MockEntry[] = ['微光偏航', '雨後的底片', '柔焦公路', '低空漂浮', '第一道晨光', '慢行星', '夜色餘溫', '霧中電車', '遠方的回音', '月台慢板', '玻璃溫室', '最後一班渡輪'].map((title, index) => testEntry(title, index, true));
export const TUNE_POOL: readonly MockEntry[] = ['紙飛機練習曲', '城市換氣', '有人在唱', '未命名的島', '慢慢醒來', '午後的窗', '輕輕晃動', '回家的路'].map((title, index) => testEntry(title, index, false));
