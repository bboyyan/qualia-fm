# BRA-97 Implementation Plan（T01–T05，mock 音源）

Spec: `handoff/docs/10_IMPLEMENTATION_PLAN.md`. Remove this file when all stages are complete.

## Stage 1: T01 工程骨架
**Goal**: pnpm workspace, env schema, health, session, capabilities; mock page opens with no keys.
**Success Criteria**: lint/typecheck/test/build green; `pnpm start` serves page + API in mock mode.
**Tests**: env fail-fast, session cookie flags, CSRF/origin, gates 403, plan job lifecycle/idempotency/cancel.
**Status**: Complete

## Stage 2: T02 手機設計底座
**Goal**: tokens, AppShell, tabs, Button, inputs, BottomSheet, Toast, CapabilityBadge.
**Success Criteria**: 360/390/430 no overlap; keyboard/focus usable.
**Tests**: E2E layout overflow + focus/escape on sheets.
**Status**: Complete

## Stage 3: T03 開台與生成 UI
**Goal**: Seed composer, examples, Sonic DNA, real-phase progress, ready, partial/error.
**Success Criteria**: empty/loading/cancel/ready 0/3/5 mock states.
**Tests**: generation controller unit tests (late result, A/B), E2E per state.
**Status**: Complete

## Stage 4: T04 播放引擎
**Goal**: reducer/commands, adapter, queue, single audio owner.
**Success Criteria**: pause/next/cancel/late results/no double play.
**Tests**: reducer + engine with fake adapter; E2E concurrent-playing probe.
**Status**: Complete

## Stage 5: T05 收聽與細節
**Goal**: Bridge, Queue, Tune, mini-player, settings.
**Success Criteria**: never interrupts playback; Bridge adjacency correct; removal undoable.
**Tests**: queue/bridge unit tests; E2E queue undo, tune, tab switch keeps audio owner.
**Status**: Complete
