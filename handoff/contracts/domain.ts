/** Reference contracts. No runtime or provider authorization is implied. */
export type Mode = 'mock' | 'licensed' | 'spotify' | 'external';
export type EvidenceLevel = 'user_description' | 'licensed_editorial' | 'model_knowledge' | 'unknown';
export type Seed = { kind: 'feeling' | 'song' | 'sound'; text: string; artist: string | null };
export interface SonicDNA { hookOfFeeling: string; spatialSignature: string | null; emotionalVelocity: string | null; timbralPalette: string[]; lyricalContext: string | null; basis: EvidenceLevel; caveat: string | null }
export interface Candidate { candidateId: string; title: string; artist: string; versionHint: string | null; seedBridge: string; transitionBridge: {fromCandidateId: string; text: string; djLine: string} | null; vibe: [string,string,string]; djLine: string; evidenceLevel: EvidenceLevel; evidenceRefs: string[]; uncertainty: string | null }
export interface PlanDraft { schemaVersion: 1; analysis: SonicDNA; candidates: Candidate[]; warnings: string[] }
export interface PlanRequest { seed: Seed; requestedCount: 5; dj: {enabled: boolean; length: 'short' | 'standard'}; tuning: string | null }
export type AudioLocator = {kind:'none'} | {kind:'licensed_url';url:string} | {kind:'spotify_uri';uri:string};
export interface ResolvedTrack { provider: Mode; providerTrackId: string | null; canonicalTitle: string; canonicalArtists: string[]; artworkUrl: string | null; durationMs: number | null; externalUrl: string | null; availability: 'resolved'|'unavailable'|'unverified'; canAttemptPlayback: boolean; audioLocator: AudioLocator }
export interface Segment { segmentId: string; candidate: Candidate; track: ResolvedTrack }
export interface ShowPlan { schemaVersion: 1; showId: string; createdAt: string; seed: Seed; analysis: SonicDNA; segments: Segment[]; warnings: string[]; isDemo: boolean }
export interface ErrorInfo { code: string; message: string; retryable: boolean; requestId: string; retryAfterMs: number | null }
export interface JobInfo {jobId:string; generationId:string; status:'queued'|'running'|'completed'|'partial'|'failed'|'cancelled'; phase:'queued'|'understanding'|'matching'|'resolving'|'preparing'|'done'; showId:string|null; error:ErrorInfo|null}
export interface TtsInfo {ttsId:string;status:'queued'|'running'|'ready'|'failed'|'cancelled';textHash:string;audioUrl:string|null;error:ErrorInfo|null}
export interface Capabilities {mode:Mode;spotifyEnabled:boolean;spotifyDjApproved:boolean;canPlay:boolean;canSeek:boolean;canProgrammaticallySetVolume:boolean;canInsertSpeech:boolean;canOverlap:false;supportsBackground:'unknown'|'tested-limited'|'unsupported';restrictions:string[]}
export type Phase = 'empty'|'ready'|'starting'|'loading_speech'|'speaking'|'loading_track'|'track_playing'|'paused'|'awaiting_gesture'|'reconciling'|'recoverable_error'|'completed';
export interface ShowSession {sessionId:string;queueRevision:number;queue:Segment[];currentSegmentId:string|null;phase:Phase;resumePhase:'speech'|'track'|null;positionMs:number;attemptId:number;activeOwner:'none'|'speech'|'track';generationId:string|null}
export type Command =
 | {type:'PLAY'|'PAUSE'|'NEXT_SEGMENT'|'SKIP_INTRO'|'RESTART_TRACK'|'RECONCILE';requestId:string}
 | {type:'SEEK';positionMs:number;requestId:string}
 | {type:'REMOVE_UPCOMING'|'RESTORE_REMOVED';segmentId:string;expectedRevision:number;requestId:string}
 | {type:'COMMIT_TAIL';segments:Segment[];sessionId:string;expectedRevision:number;preserveSegmentId:string;requestId:string};
export interface AttemptContext {sessionId:string;segmentId:string;attemptId:number;signal:AbortSignal}
export interface ProviderState {providerTrackId:string|null;positionMs:number;durationMs:number|null;paused:boolean;ready:boolean}
export type ProviderEvent = {type:'state';state:ProviderState;context:AttemptContext}|{type:'ended';context:AttemptContext}|{type:'error';error:ErrorInfo;context:AttemptContext};
export interface PlaybackAdapter {
 capabilities():Capabilities;
 activateFromGesture():Promise<void>;
 play(segment:Segment,context:AttemptContext):Promise<void>;
 pause():Promise<void>;
 resume(context:AttemptContext):Promise<void>;
 seek(positionMs:number):Promise<void>;
 stop():Promise<void>;
 getState():Promise<ProviderState|null>;
 subscribe(listener:(event:ProviderEvent)=>void):()=>void;
 destroy():Promise<void>;
}
/** Speech must be implemented by an orchestrator that enforces canInsertSpeech and one audible owner. */
