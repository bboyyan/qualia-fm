import { developerMode } from '../../app/developerMode';
import { isProviderNotice, PROVIDER_NOTICES } from '@qualia/contracts';
import { Button } from '../../ui/Button';
import { InlineRecovery } from '../../ui/Feedback';

/** 真實供應商降級（AI 選歌改 MOCK、AI 語音改文字介紹）必須讓人看見，不只寫進 warnings。 */
export function ProviderNotices({ warnings }: { warnings: readonly string[] }) {
  const notices = warnings.filter(isProviderNotice);
  if (notices.length === 0) return null;
  return (
    <InlineRecovery tone="warning" title="本輪已降級" testId="provider-notices">
      <ul>
        {notices.map((notice) => <li key={notice}>{developerMode() ? notice : notice.startsWith(PROVIDER_NOTICES.llm) ? '選曲服務暫時無法使用，請重新選歌。' : '語音暫時無法使用，改為文字介紹。'}</li>)}
      </ul>
    </InlineRecovery>
  );
}

/** AI 語音在手機上播放失敗：音樂照常進行，同時顯示文字介紹並可在使用者點擊內重試。 */
export function SpeechFallbackNotice({ djLine, onRetry }: { djLine: string; onRetry: () => void }) {
  return (
    <InlineRecovery
      tone="warning"
      title="AI 語音暫時無法播放，改顯示文字介紹"
      testId="speech-fallback"
      actions={<Button variant="outline" block onClick={onRetry} data-testid="retry-speech">重試語音</Button>}
    >
      <p>「{djLine}」</p>
      <p>音樂已直接開始，不會因為語音失敗而中斷。</p>
    </InlineRecovery>
  );
}
