/**
 * Fictional, clearly labelled mock catalogue. None of these titles or artists are real works;
 * they exist only to exercise UI and state machines (handoff contracts/README.md).
 */
export const MOCK_ARTIST = 'Qualia Mock · 虛構藝人';

export interface MockEntry {
  readonly title: string;
  readonly seedBridge: string;
  readonly vibe: readonly [string, string, string];
  readonly djShort: string;
  readonly djStandard: string;
  /** Transition copy used when this entry directly follows the previous base entry. */
  readonly transition: { readonly text: string; readonly djLine: string } | null;
}

export const BASE_POOL: readonly MockEntry[] = [
  {
    title: '微光偏航',
    seedBridge: '延續你描述的溫暖低頻，讓節奏保持一點前進感。',
    vibe: ['溫暖', '留白', '夜行'],
    djShort: '先從一束微光開始：低頻很暖，節奏還在慢慢往前。',
    djStandard: '這一段從一束微光開始。低頻像一條暖毯，節奏不催你，只是陪你慢慢往前走。',
    transition: null,
  },
  {
    title: '雨後的底片',
    seedBridge: '把空間拉開一些，仍保留夜裡貼近耳邊的感覺。',
    vibe: ['潮濕', '貼近', '顆粒'],
    djShort: '空間再拉開一點，但聲音仍然貼在耳邊。',
    djStandard: '我們把房間放大一點，讓空氣變得潮濕，聲音卻還是貼在耳邊，像雨後沒乾的底片。',
    transition: {
      text: '接住〈微光偏航〉的暖底，把空氣換成雨後的潮濕顆粒。',
      djLine: '剛剛的暖意還在，現在讓空氣變得潮濕一點。',
    },
  },
  {
    title: '柔焦公路',
    seedBridge: '保留柔和的輪廓，增加輕輕向前的律動。',
    vibe: ['柔焦', '律動', '夜路'],
    djShort: '輪廓還是柔的，腳步開始有一點節奏。',
    djStandard: '輪廓依舊柔焦，但腳下開始有了節奏，像深夜空蕩的公路，一盞一盞路燈往後退。',
    transition: {
      text: '從〈雨後的底片〉的潮濕空間出發，把顆粒感換成往前滑行的律動。',
      djLine: '潮濕的空氣散開，路面開始往前延伸。',
    },
  },
  {
    title: '低空漂浮',
    seedBridge: '讓推進放慢，留下更寬的空間與懸浮感。',
    vibe: ['懸浮', '寬闊', '慢速'],
    djShort: '放慢一點，讓自己浮在半空中。',
    djStandard: '這首把推進放慢，留下很寬的空間。你可以什麼都不想，就讓自己浮在半空中一會兒。',
    transition: {
      text: '〈柔焦公路〉的律動在這裡鬆開，變成貼地飛行的懸浮。',
      djLine: '公路的節奏慢慢鬆開，換你浮起來。',
    },
  },
  {
    title: '第一道晨光',
    seedBridge: '以更明亮的質地收尾，保留這段節目的溫度。',
    vibe: ['明亮', '溫度', '收尾'],
    djShort: '最後一首，讓光慢慢亮起來。',
    djStandard: '這一段的最後一首。質地變得明亮，但溫度沒有離開，像窗外剛亮起來的第一道光。',
    transition: null,
  },
  {
    title: '慢行星',
    seedBridge: '維持輕盈懸浮，讓感覺往更陌生的方向延伸。',
    vibe: ['陌生', '輕盈', '星塵'],
    djShort: '往陌生一點的地方走，但不會太遠。',
    djStandard: '我們往陌生一點的方向走，但別擔心，還是同樣輕盈的步伐，只是周圍多了一些星塵。',
    transition: null,
  },
  {
    title: '夜色餘溫',
    seedBridge: '讓色彩慢慢收攏，留下柔和而不沉重的餘韻。',
    vibe: ['餘韻', '柔和', '收攏'],
    djShort: '讓顏色慢慢收起來，只留下餘溫。',
    djStandard: '夜色慢慢收攏，顏色一層層退去，只留下柔和、不沉重的餘溫，陪你準備休息。',
    transition: null,
  },
];

/** Replacement pool for the Tune flow; the tuning phrase is prepended to each Bridge. */
export const TUNE_POOL: readonly MockEntry[] = [
  {
    title: '紙飛機練習曲',
    seedBridge: '把重心放輕，讓旋律像紙飛機一樣滑過去。',
    vibe: ['輕巧', '滑翔', '午後'],
    djShort: '換一首輕一點的，讓旋律自己滑過去。',
    djStandard: '我們換一首輕巧的：重心放低，旋律像紙飛機一樣，在房間裡慢慢滑過去。',
    transition: null,
  },
  {
    title: '城市換氣',
    seedBridge: '保留夜色，但讓鼓點清楚一點，往前推。',
    vibe: ['推進', '清晰', '城市'],
    djShort: '鼓點清楚一點，我們往前走。',
    djStandard: '夜色還在，但鼓點更清楚了。像走出地鐵站，城市在你身邊換了一口氣。',
    transition: null,
  },
  {
    title: '有人在唱',
    seedBridge: '把人聲往前拉，像有人在身邊輕輕哼著。',
    vibe: ['人聲', '親密', '哼唱'],
    djShort: '這首多了人聲，像有人在旁邊哼歌。',
    djStandard: '這首把人聲往前拉近，不是華麗的演唱，比較像有人坐在你旁邊，輕輕哼著。',
    transition: null,
  },
  {
    title: '未命名的島',
    seedBridge: '走進比較陌生的音色，但溫度保持一致。',
    vibe: ['陌生', '島嶼', '探索'],
    djShort: '去一座沒有名字的島，溫度不變。',
    djStandard: '我們去一座還沒有名字的島。音色比較陌生，但溫度跟剛剛一樣，放心往前走。',
    transition: null,
  },
  {
    title: '慢慢醒來',
    seedBridge: '用柔和的亮度收尾，讓這段調整有個落點。',
    vibe: ['柔亮', '甦醒', '落點'],
    djShort: '最後，讓聲音慢慢醒來。',
    djStandard: '最後這首，聲音的亮度一點一點升起來，讓剛才的調整，有一個溫柔的落點。',
    transition: null,
  },
];
