/**
 * S01 composer. Enter inserts a newline (only the button submits); IME composition never
 * submits; the draft survives tab switches and cancelled generations (FR01, AC02).
 * BRA-117：預設「歌曲」模式＝種子清單（預設種子＋自己加入的歌），可多選；主按鈕一鍵「全選・快速開台」。
 */
import { useId, useRef, useState } from 'react';
import { SEED_MAX_GRAPHEMES, countGraphemes, type SeedKind } from '@qualia/contracts';
import { useAppStore } from '../../app/appStore';
import { Button } from '../../ui/Button';
import { Chip, SegmentedControl, type SegmentOption } from '../../ui/controls';
import { SelectableList } from './SelectableList';
import { draftProblem, removeSongSeed, textProblem, toggleSongSeed, withPendingSong, type Draft } from './seedList';
import { startLabel, toggleAll } from './selection';
import styles from './seed.module.css';

const MODES: readonly SegmentOption<SeedKind>[] = [
  { value: 'feeling', label: '感覺', icon: 'spark' },
  { value: 'song', label: '歌曲', icon: 'song' },
  { value: 'sound', label: '聲音', icon: 'sound' },
];

const LABEL: Record<Exclude<SeedKind, 'song'>, string> = {
  feeling: '此刻，你想聽見什麼？',
  sound: '描述你想要的聲音質地',
};

const PLACEHOLDER: Record<Exclude<SeedKind, 'song'>, string> = {
  feeling: 'TEST：請輸入假資料，僅用於測試。',
  sound: 'TEST：請輸入假聲音描述。',
};

export const EXAMPLES = ['TEST 假起點一', 'TEST 假起點二', 'TEST 假起點三'] as const;

interface SeedComposerProps {
  /** 已有節目在播：按鈕改成「建立下一段」。 */
  continuing: boolean;
  onSubmit: () => void;
  busy?: boolean;
}

/** 舊名稱保留給文字模式（感覺／聲音）。 */
export const seedProblem = textProblem;

function SongSeeds({ draft, fieldId }: { draft: Draft; fieldId: string }) {
  const setDraft = useAppStore((s) => s.setDraft);
  const announce = useAppStore((s) => s.announce);
  const ids = draft.seeds.map((seed) => seed.id);
  const add = () => {
    const next = withPendingSong(draft);
    if (next === draft) return;
    setDraft(next);
    announce('已加入種子清單並勾選');
  };
  return (
    <>
      <SelectableList
        label="種子清單"
        items={draft.seeds.map((seed) => ({
          id: seed.id,
          title: seed.title,
          meta: seed.artist,
          note: seed.note,
          tag: seed.isDefault ? '預設種子・可更換' : undefined,
        }))}
        selected={draft.selectedSeedIds}
        onToggle={(id) => setDraft(toggleSongSeed(draft, id))}
        onToggleAll={() => setDraft({ selectedSeedIds: toggleAll(ids, draft.selectedSeedIds) })}
        onRemove={(id) => setDraft(removeSongSeed(draft, id))}
        removable={(id) => !draft.seeds.find((seed) => seed.id === id)?.isDefault}
        testId="seed-list"
      />
      <p className={styles.seedHint}>只把種子當起點，不從它推測你其他的喜好。取消勾選、加入別首，就能更換。</p>
      <label className={styles.fieldLabel} htmlFor={`${fieldId}-seed`}>
        想換或多加一首？（歌名）
      </label>
      <textarea
        id={`${fieldId}-seed`}
        className={styles.seedField}
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

export function SeedComposer({ continuing, onSubmit, busy = false }: SeedComposerProps) {
  const draft = useAppStore((s) => s.draft);
  const setDraft = useAppStore((s) => s.setDraft);
  const [touched, setTouched] = useState(false);
  const composing = useRef(false);
  const fieldId = useId();
  const song = draft.kind === 'song';
  const count = countGraphemes(draft.text);
  const problem = draftProblem(draft);
  const showError = song ? problem !== null : touched && problem !== null && (draft.text.length > 0 || count > SEED_MAX_GRAPHEMES);
  const pending = withPendingSong(draft);
  const label = song
    ? startLabel(continuing ? '建立下一段' : '快速開台', pending.selectedSeedIds.length, pending.seeds.length)
    : continuing ? '建立下一段' : '為我開台';

  const submit = () => {
    setTouched(true);
    if (composing.current || problem) return;
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
          <SongSeeds draft={draft} fieldId={fieldId} />
        ) : (
          <>
            <label className={styles.fieldLabel} htmlFor={`${fieldId}-seed`}>
              {LABEL[draft.kind]}
            </label>
            <textarea
              id={`${fieldId}-seed`}
              className={styles.seedField}
              rows={3}
              value={draft.text}
              placeholder={PLACEHOLDER[draft.kind]}
              aria-describedby={`${fieldId}-help ${fieldId}-error`}
              aria-invalid={showError || undefined}
              onChange={(e) => setDraft({ text: e.target.value })}
              onCompositionStart={() => (composing.current = true)}
              onCompositionEnd={() => (composing.current = false)}
              onBlur={() => setTouched(true)}
              data-testid="seed-input"
            />
            <div className={styles.counter}>
              <span id={`${fieldId}-help`}>不需要懂樂理，照你的感覺說。</span>
              <span className={count > SEED_MAX_GRAPHEMES ? styles.over : undefined} aria-live="polite">
                {count} / {SEED_MAX_GRAPHEMES}
              </span>
            </div>
          </>
        )}
        <p id={`${fieldId}-error`} className={styles.error} role={showError ? 'alert' : undefined}>
          {showError ? problem : ''}
        </p>
      </section>
      <div className={styles.chips} role="group" aria-label="範例感覺（只會填入，不會開始）">
        {EXAMPLES.map((example) => (
          <Chip key={example} selected={draft.kind === 'feeling' && draft.text === example} onClick={() => setDraft({ kind: 'feeling', text: example })}>
            {example}
          </Chip>
        ))}
      </div>
      <div className={styles.cta}>
        <Button type="submit" block trailingIcon="arrow" loading={busy} disabled={problem !== null} data-testid="generate">
          {label}
        </Button>
        <p className={styles.ctaNote}>5 首歌，一段有理由的相遇。</p>
      </div>
    </form>
  );
}
