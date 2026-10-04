/**
 * Abstract Qualia-owned soundscape (not album art). Deterministic per palette so every segment
 * gets its own scene. Rings rotate only while `spinning` — and never under reduced motion.
 * It represents playback state; it is not a waveform or audio analysis.
 */
import { useId } from 'react';
import styles from './ui.module.css';

interface Scene {
  from: string;
  to: string;
  sun: string;
  hill: string;
  mist: string;
  sunX: number;
  label: string;
}

const SCENES: readonly Scene[] = [
  { from: '#395A49', to: '#1F3D35', sun: '#D1BE8C', hill: '#809C7B', mist: '#C6CAA7', sunX: 273, label: 'Soft frequency.' },
  { from: '#3E5560', to: '#203540', sun: '#C9C3A5', hill: '#7F969A', mist: '#B9C6C2', sunX: 236, label: 'After the rain.' },
  { from: '#4B5A3C', to: '#2A3A25', sun: '#DDB77A', hill: '#93A56F', mist: '#CFD1A2', sunX: 290, label: 'Night road.' },
  { from: '#3B4F5A', to: '#1E2F3A', sun: '#BFC9C2', hill: '#7C93A0', mist: '#C2CDD0', sunX: 210, label: 'Low orbit.' },
  { from: '#6A5137', to: '#3D2E22', sun: '#F0CF8E', hill: '#B28C5E', mist: '#E3CDA5', sunX: 258, label: 'First light.' },
  { from: '#42465E', to: '#252840', sun: '#CFC4A0', hill: '#8187A4', mist: '#C3C2D4', sunX: 280, label: 'Slow planet.' },
  { from: '#5C4038', to: '#352420', sun: '#E2B48A', hill: '#A27868', mist: '#D9BDAA', sunX: 228, label: 'Warm residue.' },
  { from: '#35574F', to: '#1C3832', sun: '#D8C796', hill: '#79A091', mist: '#BFD0C4', sunX: 250, label: 'Open window.' },
];

interface SoundscapeArtProps {
  palette: number;
  kicker?: string;
  label?: string;
  spinning?: boolean;
  compact?: boolean;
}

export function SoundscapeArt({ palette, kicker = 'THE TEXTURE OF TONIGHT', label, spinning = false, compact = false }: SoundscapeArtProps) {
  const scene = SCENES[((palette % SCENES.length) + SCENES.length) % SCENES.length] ?? SCENES[0]!;
  const id = useId().replaceAll(':', '');
  return (
    <figure className={`${styles.art} ${compact ? styles.artCompact : ''}`} aria-label="抽象聲景插畫，非專輯封面">
      <svg viewBox="0 0 346 194" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
        <defs>
          <linearGradient id={`g${id}`} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor={scene.from} />
            <stop offset="1" stopColor={scene.to} />
          </linearGradient>
        </defs>
        <rect width="346" height="194" fill={`url(#g${id})`} />
        <circle cx={scene.sunX} cy="57" r="34" fill={scene.sun} />
        <g className={spinning ? styles.artRingsSpin : styles.artRings} fill="none" stroke="#E4E9D8" strokeWidth=".6" opacity=".5">
          {Array.from({ length: 14 }, (_, i) => (
            <ellipse key={i} cx="264" cy="138" rx={62 + i * 9} ry={22 + i * 8} transform="rotate(-32 264 138)" />
          ))}
        </g>
        <path d="M-15 146C69 85 122 117 182 201H-15Z" fill={scene.hill} opacity=".44" />
        <path d="M-25 175C72 111 120 147 160 203H-25Z" fill={scene.mist} opacity=".36" />
        <path d="M18 24h42m-21-4v8" stroke="#E4E6D6" strokeWidth=".8" />
        <text x="18" y="45" fill="#E4E6D6" fontSize="7" fontFamily="sans-serif" letterSpacing="2">
          {`QUALIA / STUDY 0${(palette % 8) + 1}`}
        </text>
      </svg>
      <figcaption className={styles.artLabel}>
        <small>{kicker}</small>
        {label ?? scene.label}
      </figcaption>
      <span className={styles.artNote}>原創示意聲景</span>
    </figure>
  );
}
