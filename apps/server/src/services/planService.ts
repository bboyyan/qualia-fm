/**
 * Cancellable, idempotent plan jobs with real phases, a hard deadline and a bounded LLM budget
 * (docs/08 JobInfo, docs/09 budget). Late work after cancel/timeout can never update a job.
 */
import { createHash, randomBytes } from 'node:crypto';
import {
  PlanDraftSchema,
  CONFIRMED_SEED,
  PROVIDER_NOTICES,
  type Candidate,
  type FeedbackRequest,
  type JobInfo,
  type JobPhase,
  type MockScenario,
  type PlanDraft,
  type PlanRequest,
  type ResolvedTrack,
  type ShowPlan,
} from '@qualia/contracts';
import type { RealProviderRuntime } from '../budget/runtime.js';
import type { OpenAITtsProvider } from '../providers/openai/tts.js';
import type { FeedbackLedger } from '../ledger/types.js';
import type { ServerConfig } from '../config/env.js';
import { AppError, errorEnvelope, newRequestId } from '../http/errors.js';
import type { CatalogResolver, EditorialPlanner, PhaseClock } from '../providers/types.js';
import { WindowLimiter } from '../security/rateLimit.js';
import type { JobStore} from '../stores/jobStore.js';
import { toJobInfo, type JobRecord } from '../stores/jobStore.js';
import { RecentPicks, type RecentSelection } from '../stores/recentPicks.js';
import { drawOrder, effectiveExploration, type PoolEntry } from './candidatePool.js';
import { toEditorialInput, type EditorialInput } from './editorialInput.js';
import { buildShowPlan, type ResolvedCandidate } from './showBuilder.js';
import { EMPTY_TASTE_HINTS, applyTasteRules, tasteHintsFor } from './tasteRules.js';
import type { TasteRead, TasteService } from './tasteService.js';

const HOUR_MS = 60 * 60 * 1000;
const MAX_ACTIVE_JOBS_PER_SESSION = 3;
const GLOBAL_PLAN_CAP_PER_HOUR = 1_000;
const TARGET_SEGMENTS = 5;
/** TTS 階段結束後留給組裝節目的餘裕；開始下一段前剩餘時間須 ≥ TTS 單次逾時＋此餘裕。 */
const SPEECH_DEADLINE_MARGIN_MS = 250;
const monotonicNow = (): number => performance.now();
const SPOTIFY_RESOLVE_WARNING = 'Spotify 對應暫時失敗，部分曲目改列待確認。';
const spotifyMismatchWarning = (count: number): string => `Spotify 找不到曲名與藝人都相符（且可播放）的曲目，已略過 ${count} 首提名，改用下一首。`;

export interface PlanServiceDeps {
  /** SPOTIFY_ENABLED 且已連結時，把真實提名對應成 Spotify URI；MOCK 提名不送 Search。 */
  readonly spotify?: { readonly resolver: CatalogResolver; readonly linked: () => boolean };
  readonly runtime?: RealProviderRuntime;
  /** 啟用真實 LLM 時的降級來源（MOCK）；未設定時維持原行為：無效兩次即 PLAN_INVALID。 */
  readonly fallbackPlanner?: EditorialPlanner;
  readonly tts?: OpenAITtsProvider;
  readonly ledger: FeedbackLedger;
  /** 品味帳本（BRA-134）：開台前必讀、回饋與播出紀錄必寫；Notion（ledger）只是可選備份。 */
  readonly tasteService: TasteService;
  readonly config: ServerConfig;
  readonly planner: EditorialPlanner;
  readonly resolver: CatalogResolver;
  readonly store: JobStore;
  readonly clock: PhaseClock;
  readonly now: () => number;
  /** BRA-127：同種子近期已選；未注入時依 config.limits.recentSeedRuns 建立。 */
  readonly recentPicks?: RecentPicks;
  /** BRA-127：候選池抽樣用的亂數；測試注入固定序列。 */
  readonly random?: () => number;
}

export interface StartPlanInput {
  readonly ownerId: string;
  readonly request: PlanRequest;
  readonly idempotencyKey: string;
  readonly scenario: MockScenario;
  /** 這個請求出示了 Spotify 擁有者憑證（BRA-111 A1）；不是擁有者就不送 Search，照 MOCK／手動對應。 */
  readonly spotifyOwner?: boolean;
}

const id = (prefix: string): string => `${prefix}_${randomBytes(8).toString('hex')}`;

export const realClock: PhaseClock = {
  wait: (ms, signal) =>
    new Promise((resolve, reject) => {
      if (signal.aborted) return reject(signal.reason);
      const timer = setTimeout(resolve, ms);
      signal.addEventListener('abort', () => (clearTimeout(timer), reject(signal.reason)), { once: true });
    }),
};

export class PlanService {
  private readonly sessionLimiter: WindowLimiter;
  private readonly globalLimiter = new WindowLimiter(GLOBAL_PLAN_CAP_PER_HOUR, HOUR_MS);
  private readonly recentPicks: RecentPicks;
  private readonly random: () => number;

  constructor(private readonly deps: PlanServiceDeps) {
    this.sessionLimiter = new WindowLimiter(deps.config.limits.planRateLimitPerHour, HOUR_MS);
    this.recentPicks = deps.recentPicks ?? new RecentPicks(deps.config.limits.recentSeedRuns);
    this.random = deps.random ?? Math.random;
  }

  start(input: StartPlanInput): JobInfo {
    const payloadHash = createHash('sha256').update(JSON.stringify([input.request, input.scenario])).digest('hex');
    const existing = this.deps.store.byIdempotencyKey(input.ownerId, input.idempotencyKey);
    if (existing) {
      if (existing.payloadHash !== payloadHash) throw new AppError('IDEMPOTENCY_CONFLICT');
      return toJobInfo(existing);
    }
    this.assertWithinBudget(input.ownerId);
    const job: JobRecord = {
      jobId: id('job'),
      generationId: id('gen'),
      ownerId: input.ownerId,
      status: 'queued',
      phase: 'queued',
      showId: null,
      error: null,
      payloadHash,
      idempotencyKey: input.idempotencyKey,
      controller: new AbortController(),
      createdAt: this.deps.now(),
      lastAccess: this.deps.now(),
    };
    this.deps.store.add(job);
    void this.run(job, input);
    return toJobInfo(job);
  }

  get(ownerId: string, jobId: string): JobInfo {
    return toJobInfo(this.owned(ownerId, jobId));
  }

  /** Idempotent: cancelling a finished or already-cancelled job returns its current state. */
  cancel(ownerId: string, jobId: string): JobInfo {
    const job = this.owned(ownerId, jobId);
    if (job.status !== 'queued' && job.status !== 'running') return toJobInfo(job);
    const updated = this.deps.store.update(jobId, { status: 'cancelled' }) ?? job;
    job.controller.abort('cancel');
    return toJobInfo(updated);
  }

  show(ownerId: string, showId: string): ShowPlan {
    const plan = this.deps.store.getShow(showId, ownerId);
    if (!plan) throw new AppError('NOT_FOUND');
    return plan;
  }

  async speech(ownerId: string, showId: string, segmentId: string) {
    if (!this.deps.tts) throw new AppError('FEATURE_RESTRICTED');
    const segment = this.show(ownerId, showId).segments.find((item) => item.segmentId === segmentId);
    if (!segment || segment.speech.kind !== 'ai_audio') throw new AppError('NOT_FOUND');
    const speech = await this.deps.tts.synthesize(segment.candidate.djLine, new AbortController().signal);
    return { ...speech, url: `/api/media/tts/${showId}/${segmentId}/${speech.url.split('/').at(-1)!}` };
  }

  /** 「愛」→ Loved：URI 一律由伺服器依擁有者的節目查出，不接受用戶端傳入。 */
  spotifyUriFor(ownerId: string, showId: string, segmentId: string): string {
    const locator = this.show(ownerId, showId).segments.find((s) => s.segmentId === segmentId)?.track.audioLocator;
    if (locator?.kind !== 'spotify_uri') throw new AppError('NOT_FOUND');
    return locator.uri;
  }

  ownsSpotifyUri(ownerId: string, uri: string): boolean {
    return this.deps.store.ownedShows(ownerId).some((plan) => plan.segments.some((s) => s.track.audioLocator.kind === 'spotify_uri' && s.track.audioLocator.uri === uri));
  }

  scrubSpotify(): void {
    this.deps.store.scrubSpotify();
  }

  /**
   * 帳本只存 LLM 當時提名的原始曲名／藝人＋評價＋原因＋日期；永遠不讀 segment.track（Spotify 回傳欄位）。
   */
  async feedback(ownerId: string, request: FeedbackRequest) {
    const show = this.show(ownerId, request.showId);
    const segment = show.segments.find((s) => s.segmentId === request.segmentId);
    if (!segment) throw new AppError('NOT_FOUND');
    const key = JSON.stringify([request.segmentId, request.clientRequestId ?? null]);
    // 先寫本機品味帳本（失敗即回錯誤、不寫備份）；成功後才寫 FeedbackLedger（Notion 備份）。
    return this.deps.store.saveFeedback(request.showId, ownerId, key, async () => {
      await this.deps.tasteService.recordFeedback({
        showId: request.showId,
        segmentId: request.segmentId,
        clientRequestId: request.clientRequestId ?? null,
        track: { title: segment.candidate.title, artist: segment.candidate.artist },
        rating: request.rating,
        reason: request.reason,
      });
      return this.deps.ledger.append({
        date: new Date(this.deps.now()).toISOString(),
        seed: [show.seed.artist, show.seed.text].filter(Boolean).join(' — '),
        recommendation: `${segment.candidate.artist} — ${segment.candidate.title}`,
        rating: request.rating,
        reason: request.reason,
      });
    });
  }

  /** 手動編輯的對象：只取 LLM 提名的曲名／藝人，永遠不讀 segment.track（Spotify 回傳欄位）。 */
  trackOf(ownerId: string, showId: string, segmentId: string): { title: string; artist: string } {
    const segment = this.show(ownerId, showId).segments.find((s) => s.segmentId === segmentId);
    if (!segment) throw new AppError('NOT_FOUND');
    return { title: segment.candidate.title, artist: segment.candidate.artist };
  }

  /** Logout / session end: abort in-flight work and forget everything the owner had. */
  forgetOwner(ownerId: string): void {
    for (const job of this.deps.store.ownedBy(ownerId)) job.controller.abort('cancel');
    this.deps.store.forgetOwner(ownerId);
    this.recentPicks.forget(ownerId);
  }

  private owned(ownerId: string, jobId: string): JobRecord {
    const job = this.deps.store.get(jobId, ownerId);
    if (!job) throw new AppError('NOT_FOUND');
    return job;
  }

  private assertWithinBudget(ownerId: string): void {
    if (this.deps.store.activeCount(ownerId) >= MAX_ACTIVE_JOBS_PER_SESSION) throw new AppError('RATE_LIMITED');
    const now = this.deps.now();
    const global = this.globalLimiter.hit('global', now);
    if (!global.ok) throw new AppError('QUOTA_EXCEEDED', { retryAfterMs: global.retryAfterMs });
    const session = this.sessionLimiter.hit(ownerId, now);
    if (!session.ok) throw new AppError('RATE_LIMITED', { retryAfterMs: session.retryAfterMs });
  }

  private async run(job: JobRecord, input: StartPlanInput): Promise<void> {
    const { signal } = job.controller;
    const deadlineAt = monotonicNow() + this.deps.config.limits.planDeadlineMs;
    const deadline = setTimeout(() => job.controller.abort('timeout'), this.deps.config.limits.planDeadlineMs);
    deadline.unref?.();
    try {
      let request = input.request;
      let warning: string | null = null;
      let history: EditorialInput['history'] = [];
      try {
        history = await this.deps.ledger.read(signal);
      } catch {
        if (signal.aborted) throw signal.reason;
        request = { ...request, seed: { ...CONFIRMED_SEED }, tuning: null };
        warning = '未讀到帳本：本輪只用種子曲。';
      }
      const tasteRead = await this.deps.tasteService.readForPlan();
      if (signal.aborted) throw signal.reason;
      const tasteHints = tasteRead.snapshot ? tasteHintsFor(tasteRead.snapshot) : EMPTY_TASTE_HINTS;
      const recent = this.recentPicks.recent(job.ownerId, request.seed);
      const exploration = effectiveExploration(this.deps.config.limits.planExploration, recent.runs);
      const editorial = { ...toEditorialInput(request), history, tasteHints, recentPicks: recent.tracks, exploration };
      const { plan: result, mock } = await this.pipeline(job.jobId, editorial, { ...input, request }, signal, deadlineAt, recent.history, tasteRead);
      // TTS 可能在取消／逾時後才回覆；交付前再次確認，晚回覆不能留下 show 或近期選曲。
      if (signal.aborted) throw signal.reason;
      if (this.deps.store.get(job.jobId, job.ownerId)?.status !== 'running') return;
      const plan = warning ? { ...result, warnings: [...result.warnings, warning] } : result;
      this.deps.store.putShow(job.ownerId, plan, this.deps.now());
      this.finish(job, plan);
      // D-23：TTS 階段結束、節目儲存並交付後才記錄；只存實際交付的非 MOCK 提名。
      if (!mock && plan.segments.length > 0) this.recentPicks.record(job.ownerId, plan.seed, plan.segments.map(({ candidate }) => candidate));
    } catch (error: unknown) {
      this.fail(job.jobId, signal, error);
    } finally {
      clearTimeout(deadline);
    }
  }

  private async pipeline(jobId: string, editorial: EditorialInput, input: StartPlanInput, signal: AbortSignal, deadlineAt: number, recentRuns: RecentSelection['history'], tasteRead: TasteRead): Promise<{ plan: ShowPlan; mock: boolean }> {
    const { phaseMs, slowPhaseMs, speechMs } = this.deps.config.mock;
    await this.enter(jobId, 'understanding', phaseMs, signal);
    // 供應商降級提示一律放在 warnings 最前面，模型自己的 warnings 再多也不會把它擠掉。
    const notices: string[] = [];
    let realReason: string | null = null;
    if (this.deps.runtime) {
      try { await this.deps.runtime.claimPlan(signal); }
      catch (error) {
        if (signal.aborted) throw signal.reason;
        realReason = safeReason(error, '真實供應商無法使用。');
      }
    }
    const drafted = await this.draftWithFallback(editorial, input.scenario, signal, realReason, notices);
    const { mock } = drafted;
    if (this.deps.tts && realReason) notices.push(`${PROVIDER_NOTICES.tts}：${realReason}`);
    // 開台前選歌管線：blocked → 近 N 已播 → pinned → 愛／不對；帳本讀不到就整段略過並明示。
    // 帳本提示排在供應商提示之後、模型 warnings 之前。
    const tasteNotices: string[] = [];
    let draft = drafted.draft;
    let pinnedCount = 0;
    if (tasteRead.snapshot) {
      const applied = applyTasteRules(draft.candidates, tasteRead.snapshot, { target: TARGET_SEGMENTS });
      draft = { ...draft, candidates: applied.candidates };
      pinnedCount = applied.trace.pinned.length;
      tasteNotices.push(...applied.warnings);
    } else if (tasteRead.warning) {
      tasteNotices.push(tasteRead.warning);
    }
    await this.enter(jobId, 'matching', input.scenario === 'slow' ? slowPhaseMs : phaseMs, signal);
    await this.enter(jobId, 'resolving', phaseMs, signal);
    const spotify = !mock && input.spotifyOwner === true && this.deps.spotify?.linked() ? this.deps.spotify.resolver : null;
    // MOCK 提名是固定的虛構示意：不抽樣、不排除，保持可重現（E2E／截圖依賴固定順序）。
    // 釘選曲已由品味管線置前，且不受近 N／session 近期排除；drawOrder 只抽樣其餘候選。
    const pinnedPool = draft.candidates.slice(0, pinnedCount).map((candidate, index) => ({ candidate, index }));
    const restDrawn = drawOrder(draft.candidates.slice(pinnedCount), mock
      ? { recentRuns: [], exploration: 0, random: this.random }
      : { recentRuns, exploration: editorial.exploration, random: this.random });
    const pool = [...pinnedPool, ...restDrawn.map(({ candidate, index }) => ({ candidate, index: index + pinnedCount }))];
    const { playable, unavailable, failed } = await this.resolveAll(spotify ?? this.deps.resolver, pool, input.scenario, signal);
    await this.enter(jobId, 'preparing', phaseMs, signal);
    // 只說數量（提名來自 LLM），不含 token 或任何 Spotify 回傳內容。
    const mismatched = spotify ? unavailable.length - failed : 0;
    const resolveWarnings = [...(failed > 0 ? [SPOTIFY_RESOLVE_WARNING] : []), ...(mismatched > 0 ? [spotifyMismatchWarning(mismatched)] : [])];
    const plan = buildShowPlan({
      seed: input.request.seed,
      draft: resolveWarnings.length > 0 ? { ...draft, warnings: [...resolveWarnings, ...draft.warnings].slice(0, 10) } : draft,
      playable,
      unavailable,
      speech: editorial.djEnabled ? { kind: 'mock_chime', durationMs: speechMs } : { kind: 'none' },
      now: this.deps.now(),
    });
    const segments = editorial.djEnabled && this.deps.tts && !realReason ? await this.withAiSpeech(plan, signal, notices, deadlineAt) : plan.segments;
    // MOCK 提名是虛構示意，不算播出紀錄（否則示範模式會被近 N 擋光）；已取消／逾時的節目也不記。
    const airedWarning = mock || signal.aborted ? null : await this.deps.tasteService.recordAired(plan);
    if (airedWarning) tasteNotices.push(airedWarning);
    return { plan: { ...plan, segments, warnings: [...new Set([...notices, ...tasteNotices, ...plan.warnings])].slice(0, 10) }, mock };
  }

  /**
   * 逐段合成 seed 台詞；成功的段落退回 seed Bridge。第一次失敗後本輪不再嘗試（避免逾時連鎖或重複扣預扣），
   * 失敗與未嘗試的段落保留文字介紹＋提示音（mock_chime，UI 如實標示非 AI 語音）。
   * 整輪 deadline：剩餘時間不足一次完整 TTS 逾時就不再開始下一段（不預扣、不發請求），節目照常完成；
   * 已開始的段落另以剩餘時間為上限，排隊或請求超時只降級該段，不讓整輪 PLAN_TIMEOUT。
   */
  private async withAiSpeech(plan: ShowPlan, signal: AbortSignal, notices: string[], deadlineAt: number): Promise<ShowPlan['segments']> {
    const segments: ShowPlan['segments'] = [];
    const stageEnd = deadlineAt - SPEECH_DEADLINE_MARGIN_MS;
    let stopped = false;
    for (const segment of plan.segments) {
      if (stopped || !this.deps.tts) { segments.push(segment); continue; }
      const remaining = stageEnd - monotonicNow();
      if (remaining < this.deps.config.openai.ttsTimeoutMs) {
        stopped = true;
        notices.push(`${PROVIDER_NOTICES.tts}：節目準備時間不足，其餘 ${plan.segments.length - segments.length} 段改為文字介紹。`);
        segments.push(segment);
        continue;
      }
      const stageSignal = AbortSignal.any([signal, AbortSignal.timeout(Math.floor(remaining))]);
      try {
        const speech = await this.deps.tts.synthesize(segment.candidate.djLine, stageSignal);
        const key = speech.url.split('/').at(-1)!;
        segments.push({ ...segment, candidate: { ...segment.candidate, transitionBridge: null }, speech: { ...speech, url: `/api/media/tts/${plan.showId}/${segment.segmentId}/${key}` } });
      } catch (error) {
        if (signal.aborted) throw signal.reason;
        stopped = true;
        const reason = stageSignal.aborted ? '節目準備時間不足，其餘段落改為文字介紹。' : safeReason(error, 'AI 語音合成失敗。');
        notices.push(`${PROVIDER_NOTICES.tts}：${reason}`);
        segments.push(segment);
      }
    }
    return segments;
  }

  /**
   * 真實 LLM 失敗、拒答或兩次輸出都無效時，改用 fallback（MOCK）並明示；不額外增加真實呼叫次數。
   * `mock` 表示這份草稿是虛構示意（來自 MOCK planner），不會送去 Spotify 對應。
   */
  private async draftWithFallback(input: EditorialInput, scenario: MockScenario, signal: AbortSignal, realReason: string | null, notices: string[]): Promise<{ draft: PlanDraft; mock: boolean }> {
    const planner = this.deps.planner;
    const fallback = this.deps.fallbackPlanner;
    const isMock = (p: EditorialPlanner): boolean => p.kind === 'mock';
    if (!fallback) return { draft: await this.draftWithRepair(planner, input, scenario, signal, realReason === null), mock: isMock(planner) };
    if (realReason) {
      notices.push(`${PROVIDER_NOTICES.llm}：${realReason}`);
      return { draft: await this.draftWithRepair(fallback, input, scenario, signal, false), mock: true };
    }
    try {
      return { draft: await this.draftWithRepair(planner, input, scenario, signal, true), mock: isMock(planner) };
    } catch (error) {
      if (signal.aborted) throw signal.reason;
      notices.push(`${PROVIDER_NOTICES.llm}：${safeReason(error, 'AI 選歌暫時無法使用。')}`);
      return { draft: await this.draftWithRepair(fallback, input, scenario, signal, false), mock: true };
    }
  }

  private async enter(jobId: string, phase: JobPhase, waitMs: number, signal: AbortSignal): Promise<void> {
    if (signal.aborted) throw signal.reason;
    this.deps.store.update(jobId, { status: 'running', phase });
    await this.deps.clock.wait(waitMs, signal);
  }

  /** At most MAX_LLM_CALLS_PER_PLAN calls: the initial draft plus one repair. */
  private async draftWithRepair(planner: EditorialPlanner, input: EditorialInput, scenario: MockScenario, signal: AbortSignal, realAllowed: boolean): Promise<PlanDraft> {
    for (let attempt = 1; attempt <= this.deps.config.limits.maxLlmCallsPerPlan; attempt += 1) {
      const raw = await planner.draft(input, { signal, scenario, attempt, realAllowed });
      const parsed = PlanDraftSchema.safeParse(raw);
      if (parsed.success && hasConsistentIds(parsed.data.candidates)) return parsed.data;
    }
    throw new AppError('PLAN_INVALID');
  }

  /**
   * 照抽樣順序逐首對應，不可播就補抽下一首，直到 5 首可播或試滿 MAX_CANDIDATES_PER_PLAN。
   * 單一候選對應失敗（例如 Spotify 暫時沒回應）只把該首列為待確認，不讓整輪失敗。
   * 可播的依模型原始順序排回去，讓相鄰的 transitionBridge 有機會保留。
   */
  private async resolveAll(resolver: CatalogResolver, pool: readonly PoolEntry[], scenario: MockScenario, signal: AbortSignal) {
    const playable: (ResolvedCandidate & { readonly index: number })[] = [];
    const unavailable: Candidate[] = [];
    let failed = 0;
    for (const { candidate, index } of pool.slice(0, this.deps.config.limits.maxCandidatesPerPlan)) {
      if (playable.length >= TARGET_SEGMENTS) break;
      let track: ResolvedTrack;
      try {
        track = await resolver.resolve(candidate, { signal, scenario, index });
      } catch (error) {
        if (signal.aborted) throw signal.reason;
        if (resolver === this.deps.resolver) throw error;
        failed += 1;
        unavailable.push(candidate);
        continue;
      }
      if (track.canAttemptPlayback && track.availability === 'resolved') playable.push({ candidate, track, index });
      else unavailable.push(candidate);
    }
    const inDraftOrder = [...playable].sort((a, b) => a.index - b.index).map(({ candidate, track }) => ({ candidate, track }));
    return { playable: inDraftOrder, unavailable, failed };
  }

  private finish(job: JobRecord, plan: ShowPlan): void {
    const current = this.deps.store.get(job.jobId, job.ownerId);
    if (!current || current.status !== 'running') return;
    const count = plan.segments.length;
    this.deps.store.update(job.jobId, {
      status: count >= TARGET_SEGMENTS ? 'completed' : 'partial',
      phase: 'done',
      showId: plan.showId,
      error: count === 0 ? errorEnvelope('NO_RESOLVED_TRACKS', newRequestId()).error : null,
    });
  }

  private fail(jobId: string, signal: AbortSignal, error: unknown): void {
    if (signal.aborted && signal.reason === 'cancel') return;
    const code = signal.aborted && signal.reason === 'timeout' ? 'PLAN_TIMEOUT' : error instanceof AppError ? error.code : 'INTERNAL';
    this.deps.store.update(jobId, { status: 'failed', error: errorEnvelope(code, newRequestId()).error });
  }
}

/** 只取 AppError 的固定訊息（不含供應商本文或金鑰）；其他例外一律用通用說明。 */
function safeReason(error: unknown, fallback: string): string {
  if (!(error instanceof AppError)) return fallback;
  return error.code === 'PLAN_INVALID' ? '模型回應兩次都未通過格式驗證。' : error.code === 'MODEL_REFUSED' ? '模型拒絕這次請求。' : error.message;
}

function hasConsistentIds(candidates: readonly Candidate[]): boolean {
  const ids = new Set(candidates.map((c) => c.candidateId));
  if (ids.size !== candidates.length) return false;
  return candidates.every((c) => !c.transitionBridge || ids.has(c.transitionBridge.fromCandidateId));
}
