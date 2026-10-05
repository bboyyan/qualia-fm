import { useState, useSyncExternalStore } from 'react';
import { useAppStore } from '../../app/appStore';
import { api, feedbackForms, getEngine, loveFlows } from '../../app/services';
import { currentItem } from '../../audio/queue';
import type { EngineState } from '../../audio/types';
import { lovedAvailable } from '../spotify/spotifyMode';
import { FeedbackCard } from './FeedbackCard';
import { FeedbackFormModel } from './feedbackForm';
import { LoveFlowModel } from './loveFlow';
import { LoveStep } from './LoveStep';

/**
 * Mounted with an attempt key; a late save from an old show never advances a new one.
 * 「愛」且這首有 Spotify 對應、伺服器已連結時：帳本先寫好，再問一次要不要加入 Qualia Loved。
 */
export function FeedbackStep({ state }: { state: EngineState }) {
  const key = `${state.sessionId}-${state.attemptId}`;
  const [model] = useState(() => feedbackForms.forAttempt(key, () => {
    const item = currentItem(state);
    if (!item) throw new Error('feedback requires a current segment');
    const isCurrent = () => {
      const now = getEngine().getState();
      return now.sessionId === state.sessionId && now.attemptId === state.attemptId && now.phase === 'feedback';
    };
    const target = { showId: item.showId, segmentId: item.segment.segmentId };
    const form: FeedbackFormModel = new FeedbackFormModel(target, (request) => api.feedback(request), (receipt) => {
      if (!isCurrent()) return;
      if (form.getState().rating === '愛' && lovedAvailable(useAppStore.getState().capabilities, item.segment)) {
        loveFlows.begin(key, new LoveFlowModel(receipt, () => api.spotifyLoved(target)));
        return;
      }
      useAppStore.getState().showToast(receipt.mode === 'fake' ? '已收到這次回饋；服務重啟後不保留。' : '已記錄回饋。');
      getEngine().completeFeedback();
    }, () => {
      if (!isCurrent()) return;
      useAppStore.getState().showToast('已略過回饋，未寫入帳本。');
      getEngine().completeFeedback();
    });
    return form;
  }));
  const flow = useSyncExternalStore(loveFlows.subscribe, () => loveFlows.forKey(key), () => loveFlows.forKey(key));
  const item = currentItem(state);
  if (flow && item) {
    const next = state.feedbackNextIndex ?? state.currentIndex + 1;
    const playlistId = useAppStore.getState().capabilities?.spotify?.lovedPlaylistId ?? '';
    return (
      <LoveStep
        flow={flow}
        title={item.segment.track.canonicalTitle}
        playlistId={playlistId}
        reason={model.getState().reason.trim()}
        nextLabel={next < state.queue.length ? `繼續・聽第 ${next + 1} 首介紹` : '繼續'}
        onContinue={() => getEngine().completeFeedback()}
      />
    );
  }
  return <FeedbackCard model={model} />;
}
