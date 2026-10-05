/**
 * 設定頁的 E 模式區塊（純呈現）：狀態（預設關）＋L2 說明（會做／不會做）＋同意 sheet、Spotify 連結資訊、
 * 中斷連結、播放路徑順序、帳本／背景／AI 語音說明。沿用既有設定頁 group／row 與 BottomSheet、Button。
 */
import { useState } from 'react';
import { BottomSheet } from '../../ui/BottomSheet';
import { Button } from '../../ui/Button';
import settings from '../settings/settings.module.css';
import styles from './spotify.module.css';

export interface SpotifyLinkViewProps {
  linked: boolean;
  /** 已由另一台裝置（擁有者）連結；這裡不能使用、連結或中斷（BRA-111 A1）。 */
  linkedElsewhere?: boolean;
  djApproved: boolean;
  clientId: string;
  redirectUri: string;
  scopes: readonly string[];
  disconnecting: boolean;
  onLink: () => void;
  onDisconnect: () => void;
}

function ConsentSheet({ open, onClose, onLink }: { open: boolean; onClose: () => void; onLink: () => void }) {
  return (
    <BottomSheet
      open={open}
      title="開啟 Spotify 自動串接？"
      onClose={onClose}
      testId="e-mode-consent"
      footer={
        <div className={settings.stack}>
          <Button block onClick={onLink} data-testid="consent-link">我了解，前往 Spotify 授權</Button>
          <Button variant="outline" block onClick={onClose}>先不要</Button>
        </div>
      }
    >
      <p><span className={styles.tag}>L2・需你明確同意</span></p>
      <p>按下同意後會跳到 Spotify 的授權頁，由你自己登入並按同意；Qualia 不會看到你的密碼。</p>
      <ul className={styles.list}>
        <li>自動播放：這個網頁當播放器，每首前先播完 AI 介紹</li>
        <li>寫入：只有你按「愛」並確認後，才加入 Qualia Loved</li>
        <li>可隨時中斷連結，回到手動播放</li>
      </ul>
      <p>這是本專案內部的授權，不等於 Spotify 官方核可這個用途。</p>
    </BottomSheet>
  );
}

export function SpotifyLinkView({ linked, linkedElsewhere = false, djApproved, clientId, redirectUri, scopes, disconnecting, onLink, onDisconnect }: SpotifyLinkViewProps) {
  const [consentOpen, setConsentOpen] = useState(false);
  const eOn = linked && djApproved;
  return (
    <>
      <h2 className={settings.sectionLabel}>E 模式 · Spotify 自動串接</h2>
      <section className={settings.group} aria-label="E 模式" data-testid="e-mode-settings">
        <div className={settings.rowStack}>
          <div>
            <h3>E 模式：{eOn ? '開' : '關'} <span className={styles.tag}>L2・需你明確同意</span></h3>
            <p>
              預設關閉。{djApproved
                ? '開啟後 Qualia 會：'
                : '伺服器尚未核可 E 模式（SPOTIFY_DJ_APPROVED）：只能連結 Spotify、在 Spotify 開啟連結並自己播放；「愛」仍可加入 Qualia Loved。'}
            </p>
          </div>
          {djApproved && (
            <ul className={styles.list}>
              <li>用這個網頁當 Spotify 播放器，自動播放 5 首（每首前先播完 AI 介紹）</li>
              <li>讀取播放裝置與播放狀態，確認真的有聲音</li>
              <li>你按「愛」並確認後，寫入你的 Qualia Loved</li>
            </ul>
          )}
          <p>不會：</p>
          <ul className={styles.list}>
            <li>讀你的收藏或播放紀錄</li>
            <li>讀你的 Email 或個人資料（Spotify 播放器規定要有這兩個權限，本站不呼叫讀取它們的 API）</li>
            <li>把任何 Spotify 資料交給 AI</li>
          </ul>
          <p>需要 Spotify Premium。可隨時在下方中斷連結。</p>
          {!linked && !linkedElsewhere && (
            <Button block onClick={() => setConsentOpen(true)} data-testid="open-consent">連結 Spotify</Button>
          )}
        </div>
      </section>

      <h2 className={settings.sectionLabel}>Spotify 連結</h2>
      <section className={settings.group} aria-label="Spotify 連結" data-testid="spotify-link">
        <div className={settings.rowStack}>
          <dl className={styles.facts}>
            <div><dt>狀態</dt><dd data-testid="spotify-link-state">{linked ? '已連結' : linkedElsewhere ? '已由另一台裝置連結' : '未連結'}</dd></div>
            <div><dt>Client ID</dt><dd>{clientId}</dd></div>
            <div><dt>Redirect</dt><dd>{redirectUri}</dd></div>
            <div><dt>權限</dt><dd>{scopes.join(' ')}</dd></div>
          </dl>
        </div>
        <div className={settings.rowStack}>
          <Button variant="danger" block disabled={!linked || disconnecting} loading={disconnecting} onClick={onDisconnect} data-testid="disconnect-spotify">
            中斷 Spotify 連結
          </Button>
          <p>中斷後會刪除 Mac mini 上的 Spotify 授權檔、關閉 E 模式並回到手動播放；也可以到 Spotify 帳戶的「應用程式」頁撤銷。</p>
          {linkedElsewhere && <p>這份連結只有完成連結的那台裝置（瀏覽器）能使用或中斷；這裡維持手動播放。</p>}
        </div>
      </section>

      <section className={settings.info} aria-label="播放路徑與說明">
        <h3>播放路徑（依序嘗試）</h3>
        <ul className={styles.list}>
          <li>P · Qualia 網頁播放器（主要）</li>
          <li>C · 遙控 Spotify app（備援）</li>
          <li>手動 · 自己點歌（最後退路，介紹與回饋照常）</li>
        </ul>
        <p>帳本只存：日期、種子、AI 提名的曲名／藝人、評價、原因。不存 Spotify 回傳的封面、ID 或任何資料。</p>
        <p>完整 DJ 需要這頁保持在前景。鎖屏或切到背景可能中斷，回來時會請你點一下繼續。</p>
        <p>AI 合成語音在播放中與介紹卡上都會標示。不提供語音控制。</p>
      </section>

      <ConsentSheet open={consentOpen} onClose={() => setConsentOpen(false)} onLink={onLink} />
    </>
  );
}
