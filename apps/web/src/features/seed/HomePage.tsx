import { useAppStore } from '../../app/appStore';
import { generation } from '../../app/services';
import { Eyebrow } from '../../ui/Feedback';
import { Icon } from '../../ui/Icon';
import { GenerationView } from './GenerationView';
import { ReadyView } from './ReadyView';
import { SeedComposer } from './SeedComposer';
import { toPlanRequest } from './seedList';
import { useGeneration } from './useGeneration';
import styles from './seed.module.css';

interface HomePageProps {
  hasActiveShow: boolean;
  onStartShow: (segmentIds: readonly string[]) => void;
}

function Hero() {
  return (
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
  );
}

/** 開台 tab: composer → real-phase generation → ready / partial / zero / error. */
export function HomePage({ hasActiveShow, onStartShow }: HomePageProps) {
  const state = useGeneration(generation);
  const draft = useAppStore((s) => s.draft);
  const setTab = useAppStore((s) => s.setTab);
  const announce = useAppStore((s) => s.announce);

  if (state.status === 'running' || state.status === 'failed') {
    return (
      <GenerationView
        state={state}
        seedText={state.request?.seed.text ?? draft.text}
        onCancel={() => {
          generation.cancel();
          announce('已取消，輸入保留');
        }}
        onRetry={() => void generation.retry()}
        onEdit={() => generation.reset()}
      />
    );
  }
  if (state.status === 'ready' && state.show) {
    return (
      <ReadyView
        key={state.show.showId}
        show={state.show}
        hasActiveShow={hasActiveShow}
        onStart={onStartShow}
        onBackToListen={() => setTab('listen')}
        onEdit={() => generation.reset()}
        onRegenerate={() => void generation.retry()}
      />
    );
  }
  return (
    <>
      <Hero />
      <SeedComposer
        continuing={hasActiveShow}
        onSubmit={() => {
          // 讀送出當下的草稿（composer 可能剛把輸入框裡的歌加進清單）。
          const { draft: current, settings } = useAppStore.getState();
          void generation.start(toPlanRequest(current, settings));
        }}
      />
      <div className={styles.note}>
        <span className={styles.noteIcon}>
          <Icon name="leaf" size={20} />
        </span>
        <div>
          <strong>不只推薦，也告訴你為什麼。</strong>
          <p>
            {hasActiveShow ? '建立下一段不會停止正在播放的這首；準備好後由你決定何時切換。' : '跨過曲風，用空間感、音色與情緒連起下一首。'}
          </p>
        </div>
      </div>
    </>
  );
}
