import { useState } from 'react';
import { useAppStore } from '../../app/appStore';
import { api, feedbackForms, getEngine } from '../../app/services';
import { currentItem } from '../../audio/queue';
import type { EngineState } from '../../audio/types';
import { FeedbackCard } from './FeedbackCard';
import { FeedbackFormModel } from './feedbackForm';

/** Mounted with an attempt key; a late save from an old show never advances a new one. */
export function FeedbackStep({ state }: { state: EngineState }) {
  const [model] = useState(() => feedbackForms.forAttempt(`${state.sessionId}-${state.attemptId}`, () => {
    const item = currentItem(state);
    if (!item) throw new Error('feedback requires a current segment');
    const isCurrent = () => {
      const now = getEngine().getState();
      return now.sessionId === state.sessionId && now.attemptId === state.attemptId && now.phase === 'feedback';
    };
    return new FeedbackFormModel({ showId: item.showId, segmentId: item.segment.segmentId }, (request) => api.feedback(request), (receipt) => {
      if (!isCurrent()) return;
      useAppStore.getState().showToast(receipt.mode === 'fake' ? '已記錄至 TEST 假帳本。' : '已記錄至帳本。');
      getEngine().completeFeedback();
    }, () => {
      if (!isCurrent()) return;
      useAppStore.getState().showToast('已略過回饋，未寫入帳本。');
      getEngine().completeFeedback();
    });
  }));
  return <FeedbackCard model={model} />;
}
