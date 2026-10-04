/**
 * Toast: info / undo only. Never the sole channel for an error that needs action (those use
 * InlineRecovery). Rendered inside an open sheet when one is open, so Undo stays clickable.
 */
import { useEffect } from 'react';
import styles from './ui.module.css';

export interface ToastData {
  id: number;
  message: string;
  action?: { label: string; run: () => void };
}

export const TOAST_MS = 5_000;

interface ToastProps {
  toast: ToastData | null;
  onDismiss: (id: number) => void;
  placement: 'page' | 'sheet';
}

export function Toast({ toast, onDismiss, placement }: ToastProps) {
  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => onDismiss(toast.id), TOAST_MS);
    return () => window.clearTimeout(timer);
  }, [toast, onDismiss]);

  if (!toast) return null;
  return (
    <div className={placement === 'sheet' ? styles.toastInSheet : styles.toast} role="status" data-testid="toast">
      <span>{toast.message}</span>
      {toast.action && (
        <button
          type="button"
          className={styles.toastAction}
          onClick={() => {
            toast.action?.run();
            onDismiss(toast.id);
          }}
        >
          {toast.action.label}
        </button>
      )}
    </div>
  );
}
