import { useId } from 'react';
import { useAppStore } from '../../app/appStore';
import { Button } from '../../ui/Button';
import { SegmentedControl, Switch } from '../../ui/controls';
import { CapabilityBadge, Eyebrow } from '../../ui/Feedback';
import styles from './settings.module.css';

function DjSettings() {
  const settings = useAppStore((s) => s.settings);
  const setSettings = useAppStore((s) => s.setSettings);
  const id = useId();
  return (
    <section className={styles.group} aria-label="DJ 設定">
      <div className={styles.row}>
        <div>
          <h3>讓 DJ 說一點話</h3>
          <p id={`${id}-dj`}>每首歌前用一句話接住感覺。MOCK 模式只有文字與合成提示音。</p>
        </div>
        <Switch label="DJ 介紹" describedBy={`${id}-dj`} checked={settings.djEnabled} onChange={(djEnabled) => setSettings({ djEnabled })} />
      </div>
      <div className={styles.rowStack}>
        <div>
          <h3>串詞長度</h3>
          <p>{settings.djLength === 'short' ? '短版：少說一點，留更多空間。' : '標準：多一點關聯說明，不超過 80 字。'}套用到下一次開台。</p>
        </div>
        <SegmentedControl
          size="sm"
          label="串詞長度"
          value={settings.djLength}
          onChange={(djLength) => setSettings({ djLength })}
          options={[
            { value: 'short', label: '短版' },
            { value: 'standard', label: '標準' },
          ]}
        />
      </div>
      <div className={styles.row}>
        <div>
          <h3>語音聲線</h3>
          <p>伺服器目前只允許「MOCK 合成提示音」，不是 AI 語音。</p>
        </div>
        <span className={styles.pill}>提示音</span>
      </div>
    </section>
  );
}

function EnvironmentSettings() {
  const caps = useAppStore((s) => s.capabilities);
  const openSheet = useAppStore((s) => s.openSheet);
  return (
    <>
      <h2 className={styles.sectionLabel}>播放環境</h2>
      <section className={styles.group} aria-label="播放環境">
        <div className={styles.row}>
          <div>
            <h3>示範模式</h3>
            <p>未連接任何音樂服務；曲目皆為虛構，只播放合成測試音。</p>
          </div>
          <CapabilityBadge mode={caps?.mode ?? 'mock'} compact />
        </div>
        <div className={styles.row}>
          <div>
            <h3>Spotify 尚未啟用</h3>
            <p>需先核對政策、帳號權限與手機播放。這不是登入失敗。</p>
          </div>
        </div>
        <div className={styles.row}>
          <div>
            <h3>音量</h3>
            <p>請使用裝置音量鍵，本站不控制系統音量。</p>
          </div>
        </div>
        <div className={styles.rowAction}>
          <Button variant="outline" block onClick={() => openSheet('environment')}>
            查看完整限制
          </Button>
        </div>
      </section>
    </>
  );
}

export function SettingsPage() {
  const resetSettings = useAppStore((s) => s.resetSettings);
  const showToast = useAppStore((s) => s.showToast);
  return (
    <>
      <header className={styles.heading}>
        <Eyebrow>MAKE IT YOURS</Eyebrow>
        <h1>剛剛好的陪伴。</h1>
      </header>
      <DjSettings />
      <EnvironmentSettings />
      <section className={styles.info} aria-labelledby="data-title">
        <h3 id="data-title">關於聲音與資料</h3>
        <p>
          你的輸入只用於這次節目，存在伺服器記憶體中，重新啟動即消失；本機只記住 DJ 設定。MOCK 模式不呼叫任何 AI 或音樂服務。正式版的 AI 語音會清楚標示。
        </p>
      </section>
      <Button
        variant="text"
        block
        onClick={() => {
          resetSettings();
          showToast('已清除本機設定。');
        }}
      >
        清除本機設定
      </Button>
    </>
  );
}
