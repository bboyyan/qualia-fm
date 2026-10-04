import { useRef, type KeyboardEvent, type ReactNode } from 'react';
import { Icon, type IconName } from './Icon';
import styles from './ui.module.css';

export interface SegmentOption<T extends string> {
  value: T;
  label: string;
  icon?: IconName;
}

interface SegmentedControlProps<T extends string> {
  label: string;
  options: readonly SegmentOption<T>[];
  value: T;
  onChange: (value: T) => void;
  size?: 'md' | 'sm';
}

/** Radio-group semantics with roving focus: arrow keys move and select, equal-width items. */
export function SegmentedControl<T extends string>({ label, options, value, onChange, size = 'md' }: SegmentedControlProps<T>) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const move = (event: KeyboardEvent, index: number) => {
    const delta = event.key === 'ArrowRight' || event.key === 'ArrowDown' ? 1 : event.key === 'ArrowLeft' || event.key === 'ArrowUp' ? -1 : 0;
    if (delta === 0) return;
    event.preventDefault();
    const next = (index + delta + options.length) % options.length;
    const option = options[next];
    if (!option) return;
    onChange(option.value);
    refs.current[next]?.focus();
  };
  return (
    <div className={`${styles.segmented} ${size === 'sm' ? styles.segmentedSmall : ''}`} role="radiogroup" aria-label={label}>
      {options.map((option, index) => {
        const selected = option.value === value;
        return (
          <button
            key={option.value}
            ref={(el) => {
              refs.current[index] = el;
            }}
            type="button"
            role="radio"
            aria-checked={selected}
            tabIndex={selected ? 0 : -1}
            className={styles.segment}
            onClick={() => onChange(option.value)}
            onKeyDown={(e) => move(e, index)}
          >
            {option.icon && <Icon name={option.icon} size={17} />}
            {option.label}
          </button>
        );
      })}
    </div>
  );
}

interface ChipProps {
  children: ReactNode;
  onClick: () => void;
  selected?: boolean;
}

/** Mood chip: fills the composer only; never triggers generation by itself. */
export function Chip({ children, onClick, selected = false }: ChipProps) {
  return (
    <button type="button" className={styles.chip} aria-pressed={selected} onClick={onClick}>
      {children}
    </button>
  );
}

interface SwitchProps {
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  describedBy?: string;
}

export function Switch({ label, checked, onChange, describedBy }: SwitchProps) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      aria-describedby={describedBy}
      className={styles.switch}
      onClick={() => onChange(!checked)}
    >
      <span className={styles.switchTrack}>
        <span className={styles.switchKnob} />
      </span>
    </button>
  );
}

export function VibeList({ vibes }: { vibes: readonly string[] }) {
  return (
    <ul className={styles.vibes} aria-label="感覺關鍵字">
      {vibes.map((v) => (
        <li key={v} className={styles.vibe}>
          {v}
        </li>
      ))}
    </ul>
  );
}
