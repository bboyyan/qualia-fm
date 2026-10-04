import { useId } from 'react';
import type { Settings } from './settings';
import styles from './settings.module.css';

export function PlaybackModeSettings({ mode, disabled, onChange }: { mode: Settings['playbackMode']; disabled: boolean; onChange: (mode: Settings['playbackMode']) => void }) {
  const id = useId();
  return (
    <section className={styles.group} aria-label="播放模式">
      <div className={styles.rowStack}>
        <h2>播放模式</h2>
        <p>切換模式會停止本站聲音，保留目前曲目，等待你重新開始。外部 Spotify 播放需自行停止。</p>
        <fieldset className={styles.modeOptions} disabled={disabled}>
          <legend className="sr-only">播放模式</legend>
          <label><input type="radio" name={id} value="manual" checked={mode === 'manual'} onChange={() => onChange('manual')} /> B · 手動（預設）</label>
          <p>自行在 Spotify app 點歌；本站只顯示介紹文字、MOCK 提示音與回饋。</p>
          <label><input type="radio" name={id} value="mock" checked={mode === 'mock'} onChange={() => onChange('mock')} /> MOCK · 合成測試音</label>
          <p>僅供測試／開發，曲目為虛構資料。</p>
          <label><input type="radio" name={id} value="spotify" disabled checked={false} readOnly aria-describedby={`${id}-approval`} /> E · Spotify 自動串接</label>
          <p id={`${id}-approval`}>需曄當次明確同意，預設關閉</p>
        </fieldset>
        {disabled && <p role="status">請先送出或略過這首回饋，再切換播放模式。</p>}
      </div>
    </section>
  );
}
