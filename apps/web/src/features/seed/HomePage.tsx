import { useAppStore } from '../../app/appStore';
import { Eyebrow } from '../../ui/Feedback';
import { Icon } from '../../ui/Icon';
import { SeedComposer } from './SeedComposer';
import styles from './seed.module.css';

/** S01 開台. Generation, ready and error states are wired in T03. */
export function HomePage() {
  const showToast = useAppStore((s) => s.showToast);
  return (
    <>
      <section className={styles.hero} aria-labelledby="home-title">
        <Eyebrow>YOUR FEELING, ON AIR.</Eyebrow>
        <h1 id="home-title">
          不是同類型。
          <br />
          是<em>同一種感覺。</em>
        </h1>
        <p>
          給我一首歌，或此刻的心情。
          <br />
          讓下一首，接住你想留下的感覺。
        </p>
      </section>
      <SeedComposer submitLabel="為我開台" onSubmit={() => showToast('生成流程將在下一個里程碑接上。')} />
      <div className={styles.note}>
        <span className={styles.noteIcon}>
          <Icon name="leaf" size={20} />
        </span>
        <div>
          <strong>不只推薦，也告訴你為什麼。</strong>
          <p>跨過曲風，用空間感、音色與情緒連起下一首。</p>
        </div>
      </div>
    </>
  );
}
