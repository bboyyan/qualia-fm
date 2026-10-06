/**
 * v2 切面寶石（BRA-169）：顏色＝聲景場景的 hill／mist，形狀刻意和 v1「這趟 N/5」的 45° 小菱形不同。
 * empty＝虛線空寶座。純裝飾，一律 aria-hidden。
 */
import { sceneOf } from '../../ui/SoundscapeArt';
import styles from './gems.module.css';

interface GemIconProps {
  palette?: number;
  empty?: boolean;
  size?: number;
}

const OUTLINE = 'M9 3h22l8 9-19 21L1 12Z';

export function GemIcon({ palette = 0, empty = false, size = 28 }: GemIconProps) {
  const height = Math.round((size * 34) / 40);
  if (empty) {
    return (
      <svg className={styles.gemEmpty} width={size} height={height} viewBox="0 0 40 34" aria-hidden="true">
        <path d={OUTLINE} fill="none" stroke="currentColor" strokeWidth="1.4" strokeDasharray="3 3" strokeLinejoin="round" />
      </svg>
    );
  }
  const scene = sceneOf(palette);
  return (
    <svg className={styles.gemIcon} width={size} height={height} viewBox="0 0 40 34" aria-hidden="true" data-palette={palette}>
      <path d={OUTLINE} fill={scene.hill} />
      <path d="M9 3h22l-5 9H14Z" fill={scene.mist} opacity=".85" />
      <path d="M1 12l8-9 5 9Zm38 0-8-9-5 9Z" fill="#FFFFFF" opacity=".28" />
      <path d="M14 12h12l-6 21Z" fill="#FFFFFF" opacity=".18" />
      <path d="M26 12h13L20 33Z" fill="#000000" opacity=".16" />
      <path d={OUTLINE} fill="none" stroke="#FFFFFF" strokeOpacity=".45" strokeWidth=".8" strokeLinejoin="round" />
    </svg>
  );
}
