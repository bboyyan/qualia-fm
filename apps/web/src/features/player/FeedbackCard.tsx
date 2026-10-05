import { DeveloperOnly } from '../../app/developerMode';
import { useId, useSyncExternalStore } from 'react';
import { FeedbackRatingSchema } from '@qualia/contracts';
import { Button } from '../../ui/Button';
import type { FeedbackFormModel } from './feedbackForm';
import styles from './feedback.module.css';

export function FeedbackCard({ model }: { model: FeedbackFormModel }) {
  const state = useSyncExternalStore(model.subscribe, model.getState, model.getState);
  const id = useId();
  const disabled = state.busy || state.finished;
  return (
    <section className={styles.card} aria-label="這首的回饋" data-testid="feedback-card">
      <h2>這首，對你的感覺嗎？</h2>
      <DeveloperOnly><p>僅測試用：回饋寫入 TEST 假帳本，重啟即清除。請只填假資料。</p></DeveloperOnly>
      <form onSubmit={(event) => { event.preventDefault(); void model.submit(); }}>
        <div className={styles.ratings} role="group" aria-label="評價">
          {FeedbackRatingSchema.options.map((rating) => (
            <button type="button" key={rating} aria-pressed={state.rating === rating} disabled={disabled} onClick={() => model.setRating(rating)}>{rating}</button>
          ))}
        </div>
        <label htmlFor={id}>一句質地原因（可略過）</label>
        <textarea id={id} rows={2} maxLength={200} value={state.reason} disabled={disabled} onChange={(event) => model.setReason(event.target.value)} aria-describedby={`${id}-help`} />
        <p id={`${id}-help`}>留空會記錄為空原因；略過整筆回饋則不寫入帳本。</p>
        {state.error && <p role="alert">{state.error}</p>}
        <div className={styles.actions}>
          <Button type="submit" block disabled={disabled || state.rating === null} loading={state.busy}>送出回饋</Button>
          <Button block variant="outline" disabled={disabled} onClick={() => model.skip()}>略過回饋</Button>
        </div>
      </form>
    </section>
  );
}
