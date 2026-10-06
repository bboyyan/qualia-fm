/**
 * S01 composer. Enter inserts a newline (only the button submits); IME composition never
 * submits; the draft survives tab switches and cancelled generations (FR01, AC02).
 * BRA-117：預設「歌曲」模式＝種子清單（預設種子＋自己加入的歌），可多選；主按鈕一鍵「全選・快速開台」。
 * BRA-170：入口只剩「從一首歌／從一種感覺」（預設從一首歌、沒有徽章）；從一種感覺＝情境標籤（單選）＋再補一句，
 * 主按鈕上方完整顯示這次真正送出的 seed.text。
 */
import { useEffect, useId, useRef, useState } from 'react';
import { SEED_MAX_GRAPHEMES, countGraphemes, type SeedKind, type TrackMark } from '@qualia/contracts';
import { useAppStore } from '../../app/appStore';
import { Button } from '../../ui/Button';
import { Chip, SegmentedControl, type SegmentOption } from '../../ui/controls';
import { Icon } from '../../ui/Icon';
import { SelectableList } from './SelectableList';
import {
  MOOD_PRESETS, applyExample, draftProblem, draftSeedText, feelingStartLabel, mergeLedgerSeeds, removeSongSeed,
  songStartLabel, textProblem, toggleMood, toggleSongSeed, withPendingSong, type Draft,
} from './seedList';
import { toggleAll } from './selection';
import styles from './seed.module.css';

/** 契約的 'sound' 保留（舊歷史可能有），入口不再提供。 */
const MODES: readonly SegmentOption<SeedKind>[] = [
  { value: 'song', label: '從一首歌', icon: 'song' },
  { value: 'feeling', label: '從一種感覺', icon: 'spark' },
];

export const EXAMPLES = ['夜裡慢慢放鬆', '想找回一點精神', '陪我安靜走一段'] as const;

const PREVIEW_EMPTY = '先選一個感覺，或寫一句。這裡會顯示這次開台用的完整句子。';

interface SeedComposerProps {
  /** 已有節目在播：按鈕改成「建立下一段」。 */
  continuing: boolean;
  onSubmit: () => void;
  busy?: boolean;
  loadLedger?: (signal: AbortSignal) => Promise<TrackMark[]>;
}

/** 舊名稱保留給文字模式（感覺／聲音）。 */
export const seedProblem = textProblem;

function SongSeeds({ draft, fieldId, ledgerExpanded, onLedgerExpanded }: {
  draft: Draft; fieldId: string; ledgerExpanded: boolean; onLedgerExpanded: (expanded: boolean) => void;
}) {
  const setDraft = useAppStore((s) => s.setDraft);
  const announce = useAppStore((s) => s.announce);
  const add = () => {
    const next = withPendingSong(draft);
    if (next === draft) return;
    setDraft(next);
    announce('已加入種子清單並勾選');
  };
  const baseSeeds = draft.seeds.filter((seed) => !seed.ledgerOnly);
  const ledgerSeeds = draft.seeds.filter((seed) => seed.ledgerOnly);
  const list = (seeds: Draft['seeds'], label: string, testId: string) => {
    const ids = seeds.map((seed) => seed.id);
    return (
      <SelectableList
        label={label}
        items={seeds.map((seed) => ({
          id: seed.id, title: seed.title, meta: seed.artist, note: seed.note,
          tag: seed.isDefault ? '預設種子・可更換' : seed.fromLedger ? '我的歌' : undefined,
        }))}
        selected={draft.selectedSeedIds}
        onToggle={(id) => setDraft(toggleSongSeed(draft, id))}
        onToggleAll={() => setDraft({ selectedSeedIds: [
          ...draft.selectedSeedIds.filter((id) => !ids.includes(id)),
          ...toggleAll(ids, draft.selectedSeedIds.filter((id) => ids.includes(id))),
        ] })}
        onRemove={(id) => setDraft(removeSongSeed(draft, id))}
        removable={(id) => {
          const seed = seeds.find((seed) => seed.id === id);
          return Boolean(seed && !seed.isDefault && !seed.fromLedger);
        }}
        testId={testId}
      />
    );
  };
  return (
    <>
      {list(baseSeeds, '種子清單', 'seed-list')}
      {ledgerSeeds.length > 0 && (
        <details className={styles.ledgerSeeds} data-testid="ledger-seeds" open={ledgerExpanded} onToggle={(event) => onLedgerExpanded(event.currentTarget.open)}>
          <summary>我的歌（{ledgerSeeds.length}）・已選 {ledgerSeeds.filter((seed) => draft.selectedSeedIds.includes(seed.id)).length}</summary>
          <p className={styles.seedHint}>收藏與釘選可當種子；取消勾選只影響本輪。移除請到「我的歌」取消收藏／釘選。</p>
          {list(ledgerSeeds, '收藏／釘選', 'ledger-seed-list')}
        </details>
      )}
      <p className={styles.seedHint}>只把種子當起點，不從它推測你其他的喜好。取消勾選、加入別首，就能更換。</p>
      <label className={styles.fieldLabel} htmlFor={`${fieldId}-seed`}>
        想換或多加一首？（歌名）
      </label>
      <textarea
        id={`${fieldId}-seed`}
        className={`${styles.artistField} ${styles.songField}`}
        rows={1}
        value={draft.text}
        placeholder="輸入歌名"
        onChange={(e) => setDraft({ text: e.target.value })}
        data-testid="seed-input"
      />
      <label className={styles.fieldLabel} htmlFor={`${fieldId}-artist`}>
        藝人（選填）
      </label>
      <input
        id={`${fieldId}-artist`}
        className={styles.artistField}
        value={draft.artist}
        maxLength={200}
        placeholder="避免找成同名的另一首歌"
        onChange={(e) => setDraft({ artist: e.target.value })}
      />
      <Button variant="outline" icon="song" disabled={!draft.text.trim()} onClick={add} data-testid="add-seed">
        加入清單並勾選
      </Button>
    </>
  );
}

interface FeelingFieldsProps {
  draft: Draft;
  fieldId: string;
  count: number;
  showError: boolean;
  onComposing: (composing: boolean) => void;
  onBlur: () => void;
}

function FeelingFields({ draft, fieldId, count, showError, onComposing, onBlur }: FeelingFieldsProps) {
  const setDraft = useAppStore((s) => s.setDraft);
  return (
    <>
      <div className={styles.moodHead}>
        <span className={styles.fieldLabel} id={`${fieldId}-mood`}>此刻是哪一種？</span>
        <span className={styles.moodHint}>選一個，再點一次取消</span>
      </div>
      <ul className={styles.moods} role="group" aria-labelledby={`${fieldId}-mood`} data-testid="mood-presets">
        {MOOD_PRESETS.map((mood) => {
          const selected = draft.mood === mood.id;
          return (
            <li key={mood.id}>
              <Chip selected={selected} onClick={() => setDraft(toggleMood(draft, mood.id))}>
                {selected && <Icon name="check" size={16} />}
                {mood.label}
              </Chip>
            </li>
          );
        })}
      </ul>
      <div className={styles.custom}>
        <label className={styles.fieldLabel} htmlFor={`${fieldId}-seed`}>
          再補一句 <small className={styles.optional}>（選填，也可以只寫這句）</small>
        </label>
        <textarea
          id={`${fieldId}-seed`}
          className={styles.seedField}
          rows={1}
          value={draft.feelingText ?? ''}
          placeholder="例如：下班一個人走回家。"
          aria-describedby={`${fieldId}-help ${fieldId}-error`}
          aria-invalid={showError || undefined}
          onChange={(e) => setDraft({ feelingText: e.target.value })}
          onCompositionStart={() => onComposing(true)}
          onCompositionEnd={() => onComposing(false)}
          onBlur={onBlur}
          data-testid="seed-input"
        />
        <div className={styles.counter}>
          <span id={`${fieldId}-help`}>不需要懂樂理，照你的感覺說。</span>
          <span className={count > SEED_MAX_GRAPHEMES ? styles.over : undefined} aria-live="polite" data-testid="seed-count">
            {count} / {SEED_MAX_GRAPHEMES}
          </span>
        </div>
      </div>
    </>
  );
}

export function SeedComposer({ continuing, onSubmit, busy = false, loadLedger }: SeedComposerProps) {
  const draft = useAppStore((s) => s.draft);
  const setDraft = useAppStore((s) => s.setDraft);
  const [ledgerExpanded, setLedgerExpanded] = useState(false);
  const [ledgerLoading, setLedgerLoading] = useState(Boolean(loadLedger));
  const [ledgerError, setLedgerError] = useState(false);
  const [ledgerAttempt, setLedgerAttempt] = useState(0);
  useEffect(() => {
    if (!loadLedger) return;
    const controller = new AbortController();
    void loadLedger(controller.signal).then((marks) => {
      if (controller.signal.aborted) return;
      const store = useAppStore.getState();
      store.setDraft(mergeLedgerSeeds(store.draft, marks));
      setLedgerLoading(false);
      setLedgerError(false);
    }).catch(() => {
      if (controller.signal.aborted) return;
      setLedgerLoading(false);
      setLedgerError(true);
    });
    return () => controller.abort();
  }, [loadLedger, ledgerAttempt]);
  const [touched, setTouched] = useState(false);
  const composing = useRef(false);
  const fieldId = useId();
  const song = draft.kind === 'song';
  const seedText = song ? '' : draftSeedText(draft);
  const count = countGraphemes(seedText);
  const problem = draftProblem(draft);
  const showError = song ? problem !== null : touched && problem !== null && ((draft.feelingText ?? '').length > 0 || count > SEED_MAX_GRAPHEMES);
  const pending = withPendingSong(draft);
  const label = song ? songStartLabel(continuing ? '建立下一段' : '快速開台', draft, ledgerExpanded) : feelingStartLabel(draft, continuing);

  const submit = () => {
    setTouched(true);
    if (composing.current || problem || ledgerLoading) return;
    if (song && pending !== draft) setDraft(pending);
    onSubmit();
  };

  return (
    <form
      className={styles.composer}
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
      noValidate
    >
      <section className={styles.card} aria-label="電台起點">
        <SegmentedControl label="輸入方式" options={MODES} value={draft.kind} onChange={(kind) => setDraft({ kind })} />
        {song ? (
          <SongSeeds draft={draft} fieldId={fieldId} ledgerExpanded={ledgerExpanded} onLedgerExpanded={setLedgerExpanded} />
        ) : (
          <FeelingFields
            draft={draft}
            fieldId={fieldId}
            count={count}
            showError={showError}
            onComposing={(value) => (composing.current = value)}
            onBlur={() => setTouched(true)}
          />
        )}
        <p id={`${fieldId}-error`} className={styles.error} role={showError ? 'alert' : undefined}>
          {showError ? problem : ''}
        </p>
      </section>
      {ledgerError && (
        <p className={styles.seedHint} role="status" data-testid="seed-ledger-error">
          暫時讀不到我的歌，清單可能尚未更新。
          <Button variant="outline" onClick={() => {
            setLedgerLoading(true);
            setLedgerAttempt((attempt) => attempt + 1);
          }} disabled={ledgerLoading}>重新讀取</Button>
        </p>
      )}
      <div className={styles.examples} role="group" aria-labelledby={`${fieldId}-examples`}>
        <span className={styles.examplesHead} id={`${fieldId}-examples`}>
          <strong>常用的一句感受</strong>
          {song ? '・點了會切到「從一種感覺」' : '・點了填入「再補一句」'}
        </span>
        <div className={styles.chips}>
          {EXAMPLES.map((example) => (
            <Chip key={example} selected={!song && draft.feelingText === example} onClick={() => setDraft(applyExample(draft, example))}>
              {example}
            </Chip>
          ))}
        </div>
      </div>
      {!song && (
        <div className={`${styles.preview} ${seedText ? '' : styles.previewEmpty}`} id={`${fieldId}-preview`} aria-live="polite" data-testid="seed-preview">
          <p className={styles.previewLabel}>這次開台會用</p>
          <p className={styles.previewQuote}>{seedText || PREVIEW_EMPTY}</p>
        </div>
      )}
      <div className={styles.cta}>
        <Button
          type="submit"
          block
          trailingIcon="arrow"
          loading={busy}
          disabled={problem !== null || ledgerLoading}
          aria-describedby={song ? undefined : `${fieldId}-preview`}
          data-testid="generate"
        >
          {label}
        </Button>
        <p className={styles.ctaNote}>5 首歌，一段有理由的相遇。</p>
      </div>
    </form>
  );
}
