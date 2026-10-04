/** Sonic DNA: hook of feeling + four facets. Unknown facets say so instead of guessing (FR02). */
import type { SonicDNA } from '@qualia/contracts';
import styles from './seed.module.css';

const UNKNOWN = '尚無資料，不做推測';

export function facetRows(analysis: SonicDNA): readonly { label: string; value: string; known: boolean }[] {
  const palette = analysis.timbralPalette.join('、');
  return [
    { label: '空間感', value: analysis.spatialSignature ?? UNKNOWN, known: analysis.spatialSignature !== null },
    { label: '情緒速度', value: analysis.emotionalVelocity ?? UNKNOWN, known: analysis.emotionalVelocity !== null },
    { label: '音色', value: palette || UNKNOWN, known: palette.length > 0 },
    { label: '歌詞情境', value: analysis.lyricalContext ?? UNKNOWN, known: analysis.lyricalContext !== null },
  ];
}

export function SonicDnaGrid({ analysis }: { analysis: SonicDNA }) {
  return (
    <dl className={styles.facets}>
      {facetRows(analysis).map((row) => (
        <div key={row.label} className={row.known ? styles.facet : `${styles.facet} ${styles.facetUnknown}`}>
          <dt>{row.label}</dt>
          <dd>{row.value}</dd>
        </div>
      ))}
    </dl>
  );
}

/** Concise chips for the ready step (docs/02 S03); the full grid lives in the Bridge sheet. */
export function SonicDnaChips({ analysis }: { analysis: SonicDNA }) {
  return (
    <ul className={styles.facetChips} aria-label="Sonic DNA 四面向">
      {facetRows(analysis).map((row) => (
        <li key={row.label} className={row.known ? undefined : styles.facetUnknown}>
          <span>{row.label}</span>
          {row.value}
        </li>
      ))}
    </ul>
  );
}

export function SonicDnaCard({ analysis, compact = false }: { analysis: SonicDNA; compact?: boolean }) {
  return (
    <section className={styles.dna} aria-labelledby="dna-title">
      <h2 id="dna-title" className={styles.dnaTitle}>
        這一段的感覺鉤子
      </h2>
      <p className={styles.hook}>{analysis.hookOfFeeling}</p>
      {compact ? <SonicDnaChips analysis={analysis} /> : <SonicDnaGrid analysis={analysis} />}
      {analysis.caveat && <p className={styles.caveat}>{analysis.caveat}</p>}
    </section>
  );
}
