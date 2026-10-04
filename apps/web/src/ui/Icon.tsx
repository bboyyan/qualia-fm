/** Inline stroke icons (paths adapted from handoff/prototype). Always decorative: pair with a label. */
const PATHS = {
  spark: 'M12 3l2.6 6.4L21 12l-6.4 2.6L12 21l-2.6-6.4L3 12l6.4-2.6L12 3Z',
  listen: 'M4 13a8 8 0 0 1 16 0v6M4 13v6M4 13h3v7H4a2 2 0 0 1-2-2v-3a2 2 0 0 1 2-2Zm16 0h-3v7h3a2 2 0 0 0 2-2v-3a2 2 0 0 0-2-2Z',
  radio: 'M6 8h12a3 3 0 0 1 3 3v7a3 3 0 0 1-3 3H6a3 3 0 0 1-3-3v-7a3 3 0 0 1 3-3Zm-1 0 13-5M7 12h4M7 16h4M16 13a2 2 0 1 1 0 4 2 2 0 0 1 0-4Z',
  sliders: 'M4 6h16M4 12h16M4 18h16M8 4v4M16 10v4M10 16v4',
  arrow: 'M4 12h15m-6-6 6 6-6 6',
  song: 'M9 18V5l11-2v13M9 8l11-2M6 16a3 2 0 1 0 0 4 3 2 0 1 0 0-4Zm11-2a3 2 0 1 0 0 4 3 2 0 1 0 0-4Z',
  sound: 'M3 10v4M7 6v12M12 3v18M17 7v10M21 10v4',
  restart: 'M5 6v5h5M5 11a7 7 0 1 1 1 6',
  queue: 'M4 6h11M4 12h8M4 18h8m4-7 5 4-5 4Z',
  close: 'M6 6l12 12M18 6 6 18',
  chevron: 'M9 5l7 7-7 7',
  check: 'M5 12l4 4L19 6',
  leaf: 'M20 3C8 2 2 8 6 16c8 4 14-2 14-13ZM5 20l10-11',
  info: 'M12 3a9 9 0 1 1 0 18 9 9 0 0 1 0-18Zm0 8v6M12 7v.1',
  alert: 'M12 3 2 20h20L12 3Zm0 6v5m0 3v.1',
  wifiOff: 'M3 3l18 18M8.5 16.5a5 5 0 0 1 7 0M5 12.5a10 10 0 0 1 4-2.3M19 12.5a10 10 0 0 0-3.2-2M12 20h.01',
  heart: 'M20.8 5.8a5.4 5.4 0 0 0-7.6 0L12 7l-1.2-1.2a5.4 5.4 0 0 0-7.6 7.6L12 21l8.8-7.6a5.4 5.4 0 0 0 0-7.6Z',
} as const;

const FILLED = {
  play: 'M8 5l11 7-11 7Z',
  pause: 'M7 5h3v14H7zM14 5h3v14h-3z',
  next: 'M5 6l10 6-10 6Z M17 6h2.5v12H17z',
} as const;

export type IconName = keyof typeof PATHS | keyof typeof FILLED;

interface IconProps {
  name: IconName;
  size?: number;
  className?: string;
}

export function Icon({ name, size = 22, className }: IconProps) {
  const filled = name in FILLED;
  const d = filled ? FILLED[name as keyof typeof FILLED] : PATHS[name as keyof typeof PATHS];
  return (
    <svg
      className={className}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      aria-hidden="true"
      focusable="false"
      fill={filled ? 'currentColor' : 'none'}
      stroke={filled ? 'none' : 'currentColor'}
      strokeWidth={1.7}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d={d} />
    </svg>
  );
}
