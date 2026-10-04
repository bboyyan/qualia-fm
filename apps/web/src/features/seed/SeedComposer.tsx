/**
 * S01 composer. Enter inserts a newline (only the button submits); IME composition never
 * submits; the draft survives tab switches and cancelled generations (FR01, AC02).
 */
import { useId, useRef, useState } from 'react';
import { SEED_MAX_GRAPHEMES, countGraphemes, type SeedKind } from '@qualia/contracts';
import { useAppStore } from '../../app/appStore';
import { Button } from '../../ui/Button';
import { Chip, SegmentedControl, type SegmentOption } from '../../ui/controls';
import styles from './seed.module.css';

const MODES: readonly SegmentOption<SeedKind>[] = [
  { value: 'feeling', label: '感覺', icon: 'spark' },
  { value: 'song', label: '歌曲', icon: 'song' },
  { value: 'sound', label: '聲音', icon: 'sound' },
];

const LABEL: Record<SeedKind, string> = {
  feeling: '此刻，你想聽見什麼？',
  song: '從哪一首歌開始？（歌名）',
  sound: '描述你想要的聲音質地',
};

const PLACEHOLDER: Record<SeedKind, string> = {
  feeling: '深夜，還不想睡。\n想要暖一點，但別太安靜。',
  song: '輸入歌名',
  sound: '像隔著霧聽見的吉他，\n有空間，卻不遙遠。',
};

export const EXAMPLES = ['深夜，還不想睡', '暖一點，別太躁', '剛練完舞，累但很爽'] as const;

interface SeedComposerProps {
  submitLabel: string;
  onSubmit: () => void;
  busy?: boolean;
}

export function seedProblem(text: string): string | null {
  if (text.trim().length === 0) return '先寫下一點感覺，或點一個範例。';
  if (countGraphemes(text) > SEED_MAX_GRAPHEMES) return `請縮短至 ${SEED_MAX_GRAPHEMES} 字以內，輸入已保留。`;
  return null;
}

export function SeedComposer({ submitLabel, onSubmit, busy = false }: SeedComposerProps) {
  const draft = useAppStore((s) => s.draft);
  const setDraft = useAppStore((s) => s.setDraft);
  const [touched, setTouched] = useState(false);
  const composing = useRef(false);
  const fieldId = useId();
  const count = countGraphemes(draft.text);
  const problem = seedProblem(draft.text);
  const showError = touched && problem !== null && (draft.text.length > 0 || count > SEED_MAX_GRAPHEMES);

  const submit = () => {
    setTouched(true);
    if (composing.current || problem) return;
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
        <label className={styles.fieldLabel} htmlFor={`${fieldId}-seed`}>
          {LABEL[draft.kind]}
        </label>
        <textarea
          id={`${fieldId}-seed`}
          className={styles.seedField}
          rows={draft.kind === 'song' ? 1 : 3}
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
        {draft.kind === 'song' && (
          <>
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
          </>
        )}
        <div className={styles.counter}>
          <span id={`${fieldId}-help`}>不需要懂樂理，照你的感覺說。</span>
          <span className={count > SEED_MAX_GRAPHEMES ? styles.over : undefined} aria-live="polite">
            {count} / {SEED_MAX_GRAPHEMES}
          </span>
        </div>
        <p id={`${fieldId}-error`} className={styles.error} role={showError ? 'alert' : undefined}>
          {showError ? problem : ''}
        </p>
      </section>
      <div className={styles.chips} role="group" aria-label="範例感覺（只會填入，不會開始）">
        {EXAMPLES.map((example) => (
          <Chip key={example} selected={draft.text === example} onClick={() => setDraft({ kind: 'feeling', text: example })}>
            {example}
          </Chip>
        ))}
      </div>
      <div className={styles.cta}>
        <Button type="submit" block trailingIcon="arrow" loading={busy} disabled={problem !== null} data-testid="generate">
          {submitLabel}
        </Button>
        <p className={styles.ctaNote}>5 首歌，一段有理由的相遇。</p>
      </div>
    </form>
  );
}
