import { createHash } from 'node:crypto';
import { lstatSync, mkdirSync, readFileSync, readdirSync, renameSync, unlinkSync, utimesSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { countGraphemes } from '@qualia/contracts';
import type { OpenAIConfig, RealProviderRuntime } from '../../budget/runtime.js';
import { AppError } from '../../http/errors.js';
import { openAIRequest } from './http.js';

/** B2 試聽選定的繁中詳細聲線指示（搭配 voice=cedar）；可由 OPENAI_TTS_INSTRUCTIONS 覆寫。 */
const DEFAULT_INSTRUCTIONS = '請用台灣華語（臺灣國語）的口音朗讀，像台北在地的深夜電台主持人在跟朋友聊天。語氣溫暖、低調、放鬆，語速自然偏慢，句與句之間有輕輕的停頓和呼吸。使用台灣人日常口語的聲調與節奏，輕聲與語尾助詞（啊、喔、吧）要自然，不要捲舌過度。不要大陸普通話的播音腔，不要兒化音，不要過度戲劇化或推銷感。英文歌名用清楚、自然的英語發音念出，念完再回到台灣華語。';
export interface AiSpeech { kind: 'ai_audio'; aiVoice: true; url: string }
/** 文字、model、voice 與實際送出的聲線指示共同決定快取；原文與金鑰不寫入快取名稱。 */
export class OpenAITtsProvider {
  constructor(private readonly config: OpenAIConfig, private readonly runtime: RealProviderRuntime, private readonly fetchImpl: typeof fetch, private readonly now = Date.now) {}
  async synthesize(text: string, signal: AbortSignal): Promise<AiSpeech> {
    const graphemes = countGraphemes(text);
    if (graphemes < 1 || graphemes > 80) throw new AppError('INVALID_INPUT', { message: 'DJ 台詞須為 1–80 grapheme clusters。' });
    if (this.config.tts !== 'openai' || !this.config.ttsModel || !this.config.voice || !this.config.apiKey || !this.config.ttsPrice) throw new AppError('FEATURE_RESTRICTED');
    const instructions = this.config.ttsInstructions ?? DEFAULT_INSTRUCTIONS;
    return this.runtime.serial(signal, async () => {
      const key = createHash('sha256').update(JSON.stringify([text, this.config.voice, this.config.ttsModel, instructions])).digest('hex');
      const locator: AiSpeech = { kind: 'ai_audio', aiVoice: true, url: `/api/media/tts/${key}` };
      this.clean();
      if (this.read(key)) return locator;
      // chars 計價以 Unicode code points 保守上界預扣，grapheme 另計每日額度；instructions 費用由簽收單價涵蓋。
      const usd = [...text].length * this.config.ttsPrice! / 1e6;
      return this.runtime.charge({ usd, graphemes }, async () => {
        const bytes = await openAIRequest(this.fetchImpl, this.config.apiKey!, 'audio/speech', {
          model: this.config.ttsModel, voice: this.config.voice, input: text, instructions, response_format: 'mp3',
        }, signal, this.config.ttsTimeoutMs, async (response) => Buffer.from(await response.arrayBuffer()));
        if (!bytes.length || bytes.length > this.config.cacheMaxMb * 1024 * 1024) throw new AppError('FEATURE_RESTRICTED');
        const file = join(this.config.cacheDir, `${key}.mp3`);
        writeFileSync(`${file}.tmp`, bytes, { mode: 0o600 });
        renameSync(`${file}.tmp`, file);
        utimesSync(file, this.now() / 1000, this.now() / 1000);
        this.clean(file);
        // speech 回應無 usage；使用送出的字元數結算，不虛構 audio token 用量。
        return { value: locator, usd };
      });
    });
  }
  read(key: string): Buffer | null {
    const path = this.cachedFile(key);
    try { return path ? readFileSync(path) : null; } catch { return null; }
  }
  /** 僅 64 位小寫 hex 檔名、一般檔案、未過期才回傳絕對路徑；讀取更新 atime 供 LRU，不延長 TTL。 */
  cachedFile(key: string): string | null {
    if (!/^[a-f0-9]{64}$/.test(key)) return null;
    const path = resolve(this.config.cacheDir, `${key}.mp3`);
    try {
      const stat = lstatSync(path);
      if (!stat.isFile() || this.now() - stat.mtimeMs >= this.config.cacheTtlHours * 3600_000) return null;
      utimesSync(path, this.now() / 1000, stat.mtimeMs / 1000);
      return path;
    } catch { return null; }
  }
  private clean(protectedPath?: string): void {
    mkdirSync(this.config.cacheDir, { recursive: true, mode: 0o700 });
    const files = readdirSync(this.config.cacheDir).filter((name) => /^[a-f0-9]{64}\.mp3$/.test(name)).map((name) => {
      const path = join(this.config.cacheDir, name);
      return { path, stat: lstatSync(path) };
    }).sort((a, b) => a.stat.atimeMs - b.stat.atimeMs);
    let size = files.reduce((sum, file) => sum + file.stat.size, 0);
    for (const file of files) {
      if (!file.stat.isFile() || this.now() - file.stat.mtimeMs >= this.config.cacheTtlHours * 3600_000 || (size > this.config.cacheMaxMb * 1024 * 1024 && file.path !== protectedPath)) {
        unlinkSync(file.path); size -= file.stat.size;
      }
    }
  }
}
