/** 旅程膠囊：封面卡（曲目＋情緒標籤）與更長的 DJ 結語。純呈現。 */
import type { FeedbackRating } from '@qualia/contracts';
import { SoundscapeArt } from '../../ui/SoundscapeArt';
import type { Capsule } from './journey';
import styles from './journey.module.css';

const pad2 = (n: number): string => String(n).padStart(2, '0');

const RATING_MARK: Record<FeedbackRating, string> = { 愛: '♥', 還行: '·', 不對: '×' };

export function CapsuleCard({ capsule }: { capsule: Capsule }) {
  return (
    <article className={styles.capsule} data-testid="capsule-card" aria-label={`旅程膠囊第 ${capsule.id} 號`}>
      <div className={styles.cover}>
        <SoundscapeArt palette={capsule.id + 3} kicker={`JOURNEY CAPSULE · NO.${pad2(capsule.id)}`} label="旅程膠囊" compact />
        <div className={styles.coverBody}>
          {capsule.seeds.length > 0 && <p className={styles.coverSeed}>從「{capsule.seeds.join('」到「')}」出發</p>}
          {capsule.moodTags.length > 0 && (
            <ul className={styles.tags} aria-label="情緒標籤" data-testid="capsule-tags">
              {capsule.moodTags.map((tag) => (
                <li key={tag}>{tag}</li>
              ))}
            </ul>
          )}
          <ol className={styles.tracks} aria-label="膠囊曲目" data-testid="capsule-tracks">
            {capsule.tracks.map((track, i) => (
              <li key={track.key}>
                <span className={styles.trackIndex}>{pad2(i + 1)}</span>
                <span className={styles.trackText}>
                  <strong>{track.title}</strong>
                  <small>{track.artist}</small>
                </span>
                {track.rating && (
                  <span className={styles.rating} data-rating={track.rating} aria-label={track.rating}>
                    {RATING_MARK[track.rating]}
                  </span>
                )}
              </li>
            ))}
          </ol>
        </div>
      </div>
      <section className={styles.outro} aria-labelledby={`capsule-outro-${capsule.id}`}>
        <h3 id={`capsule-outro-${capsule.id}`}>DJ 結語</h3>
        <p data-testid="capsule-outro">{capsule.outro}</p>
      </section>
    </article>
  );
}
