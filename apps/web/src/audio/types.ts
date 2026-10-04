/**
 * Playback domain types (docs/06). One ShowSession, one active segment, one audible owner.
 * UI dispatches explicit actions; adapters report events tagged with attemptId.
 */
import type { ErrorCode, Segment, ShowPlan } from '@qualia/contracts';

export type Phase =
  | 'manual_ready'
  | 'manual_playing'
  | 'feedback'
  | 'empty'
  | 'ready'
  | 'loading_speech'
  | 'speaking'
  | 'loading_track'
  | 'track_playing'
  | 'paused'
  | 'awaiting_gesture'
  | 'reconciling'
  | 'recoverable_error'
  | 'completed';

export type OwnerKind = 'speech' | 'track';
export type SegmentStatus = 'queued' | 'playing' | 'played' | 'skipped' | 'failed';

/** A queued Segment plus the show it came from (transition bridges never cross shows). */
export interface QueueItem {
  readonly segment: Segment;
  readonly showId: string;
}

export interface EngineError {
  readonly code: ErrorCode;
  readonly message: string;
}

export interface RemovedEntry {
  readonly item: QueueItem;
  readonly index: number;
}

export interface EngineState {
  readonly playbackMode: 'manual' | 'mock';
  readonly feedbackEnabled: boolean;
  readonly feedbackNextIndex: number | null;
  readonly sessionId: string | null;
  readonly show: ShowPlan | null;
  readonly queue: readonly QueueItem[];
  readonly statuses: Readonly<Record<string, SegmentStatus>>;
  readonly currentIndex: number;
  readonly phase: Phase;
  /** Owner to resume from `paused`. */
  readonly resumePhase: OwnerKind | null;
  /** Owner to restart after a gesture / recoverable error. */
  readonly pendingOwner: OwnerKind | null;
  readonly activeOwner: 'none' | OwnerKind;
  readonly attemptId: number;
  readonly queueRevision: number;
  /** Last provider-confirmed position of the active owner. */
  readonly positionMs: number;
  /** Where the track resumes after a replayed intro. */
  readonly trackResumeMs: number;
  readonly djEnabled: boolean;
  readonly canSeek: boolean;
  readonly consecutiveFailures: number;
  readonly error: EngineError | null;
  readonly removed: RemovedEntry | null;
  /** segmentId whose track ended naturally right before the current one (transition adjacency). */
  readonly previousPlayedId: string | null;
  /** 這一段的 AI 語音播放失敗、已直接進曲目；UI 需顯示文字介紹，不可靜默。 */
  readonly speechFallbackId: string | null;
}

export interface ProviderState {
  readonly positionMs: number;
  readonly durationMs: number | null;
  readonly paused: boolean;
  readonly ready: boolean;
}

export type Action =
  | { type: 'LOAD_SHOW'; show: ShowPlan; sessionId: string }
  | { type: 'SET_MODE'; mode: 'manual' | 'mock' }
  | { type: 'MANUAL_STARTED' }
  | { type: 'MANUAL_FINISHED' }
  | { type: 'COMPLETE_FEEDBACK' }
  | { type: 'PLAY' }
  | { type: 'PAUSE'; positionMs?: number }
  | { type: 'NEXT' }
  | { type: 'JUMP'; segmentId: string }
  | { type: 'SKIP_INTRO' }
  | { type: 'RESTART_TRACK' }
  | { type: 'REPLAY_INTRO'; trackPositionMs: number }
  | { type: 'SEEK'; positionMs: number }
  | { type: 'REMOVE_UPCOMING'; segmentId: string; expectedRevision: number }
  | { type: 'RESTORE_REMOVED'; expectedRevision: number }
  | { type: 'COMMIT_TAIL'; items: readonly QueueItem[]; sessionId: string; expectedRevision: number; warnings?: readonly string[] }
  | { type: 'SET_DJ'; enabled: boolean }
  | { type: 'POSITION_UPDATED'; attemptId: number; positionMs: number }
  | { type: 'DEVICE_LOST' }
  | { type: 'RECONCILE' }
  | { type: 'RECONCILE_RESULT'; state: ProviderState | null }
  | { type: 'RESET' }
  | { type: 'OWNER_STARTED'; attemptId: number; owner: OwnerKind }
  | { type: 'OWNER_PAUSED'; attemptId: number; owner: OwnerKind; positionMs: number }
  | { type: 'OWNER_ENDED'; attemptId: number; owner: OwnerKind }
  | { type: 'OWNER_FAILED'; attemptId: number; owner: OwnerKind; code: 'AUTOPLAY_BLOCKED' | 'AUDIO_SOURCE_FAILED' };

export type Effect =
  | { type: 'start'; owner: OwnerKind; segment: Segment; fromMs: number; attemptId: number }
  | { type: 'pause' }
  | { type: 'resume'; attemptId: number }
  | { type: 'seek'; positionMs: number }
  | { type: 'stop' }
  | { type: 'reconcile' }
  | { type: 'announce'; message: string };

export type Rejection = 'stale_revision' | 'stale_session' | 'not_upcoming' | 'nothing_to_restore' | 'not_allowed';

export interface Reduction {
  readonly state: EngineState;
  readonly effects: readonly Effect[];
  readonly rejected?: Rejection;
}

export interface StartRequest {
  readonly owner: OwnerKind;
  readonly segment: Segment;
  readonly fromMs: number;
  readonly attemptId: number;
}

export type AdapterEvent =
  | { type: 'started' | 'ended'; attemptId: number; owner: OwnerKind }
  | { type: 'paused'; attemptId: number; owner: OwnerKind; positionMs: number }
  | { type: 'failed'; attemptId: number; owner: OwnerKind; code: 'AUTOPLAY_BLOCKED' | 'AUDIO_SOURCE_FAILED' };

/**
 * Provider boundary. Implementations own exactly one audio output; `start` must call the
 * underlying play synchronously so a user tap can unlock audio on mobile browsers.
 */
export interface MediaAdapter {
  start(request: StartRequest): Promise<void>;
  pause(): void;
  resume(attemptId: number): Promise<void>;
  seek(positionMs: number): void;
  stop(): void;
  getState(): ProviderState | null;
  subscribe(listener: (event: AdapterEvent) => void): () => void;
  destroy(): void;
}
