import { useAppStore } from '../../app/appStore';
import { Button } from '../../ui/Button';
import { Icon } from '../../ui/Icon';
import styles from './player.module.css';

/** Empty state with a next step — never a disabled dead end (docs/02 導覽規則). */
export function ListenEmpty() {
  const setTab = useAppStore((s) => s.setTab);
  return (
    <section className={styles.empty} aria-labelledby="listen-empty-title">
      <div className={styles.emptyIcon}>
        <Icon name="listen" size={30} />
      </div>
      <h1 id="listen-empty-title">
        你的頻率，
        <br />
        從一個感覺開始。
      </h1>
      <p>還沒有正在收聽的節目。先給電台一個起點吧。</p>
      <Button block trailingIcon="arrow" onClick={() => setTab('home')}>
        去開台
      </Button>
    </section>
  );
}

export function ListenPage() {
  return <ListenEmpty />;
}
