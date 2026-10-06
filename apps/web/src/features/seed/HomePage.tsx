import { useAppStore } from '../../app/appStore';
import { api, gemWall, generation } from '../../app/services';
import { GemWallEntry } from '../gems/GemWallEntry';
import { Icon } from '../../ui/Icon';
import { GenerationView } from './GenerationView';
import { ReadyView } from './ReadyView';
import { SeedComposer } from './SeedComposer';
import { draftSeedText, toPlanRequest } from './seedList';
import { useGeneration } from './useGeneration';
import styles from './seed.module.css';

interface HomePageProps {
  hasActiveShow: boolean;
  onStartShow: (segmentIds: readonly string[]) => void;
}

function Hero() {
  return (
    <section className={styles.hero} aria-labelledby="home-title">
      <h1 id="home-title">
        從<em>一首歌</em>，或<em>一種感覺</em>，
        <br />
        開始探索你的人生終極曲目。
      </h1>
    </section>
  );
}

/** 開台 tab: composer → real-phase generation → ready / partial / zero / error. */
export function HomePage({ hasActiveShow, onStartShow }: HomePageProps) {
  const state = useGeneration(generation);
  const draft = useAppStore((s) => s.draft);
  const setTab = useAppStore((s) => s.setTab);
  const announce = useAppStore((s) => s.announce);
  const openGemWall = useAppStore((s) => s.openGemWall);

  if (state.status === 'running' || state.status === 'failed') {
    return (
      <GenerationView
        state={state}
        seedText={state.request?.seed.text ?? draftSeedText(draft)}
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
      <GemWallEntry model={gemWall} onOpen={openGemWall} />
      <SeedComposer
        continuing={hasActiveShow}
        loadLedger={api.tasteMarks}
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
