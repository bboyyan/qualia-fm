/**
 * Single-level bottom sheet on a native modal <dialog>: the browser traps focus and makes the
 * page inert; Escape / backdrop / the 48px close button all close it; focus returns to the
 * element that opened it (docs/02 導覽規則, docs/03 BottomSheet).
 */
import { useEffect, useId, useRef, type ReactNode } from 'react';
import { IconButton } from './Button';
import styles from './ui.module.css';

/**
 * Safari/WebKit does not focus a button on click, so `document.activeElement` is <body> when a
 * sheet opens from a tap. Remember the last pointer-activated control as the return target.
 */
let lastPointerControl: HTMLElement | null = null;
if (typeof document !== 'undefined') {
  document.addEventListener(
    'pointerdown',
    (event) => {
      const target = event.target instanceof Element ? event.target.closest<HTMLElement>('button, a, [tabindex]') : null;
      if (target) lastPointerControl = target;
    },
    true,
  );
}

function focusOrigin(): HTMLElement | null {
  const active = document.activeElement;
  if (active instanceof HTMLElement && active !== document.body) return active;
  return lastPointerControl?.isConnected ? lastPointerControl : null;
}

interface BottomSheetProps {
  open: boolean;
  title: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  testId?: string;
}

export function BottomSheet({ open, title, onClose, children, footer, testId }: BottomSheetProps) {
  const ref = useRef<HTMLDialogElement>(null);
  const returnFocus = useRef<HTMLElement | null>(null);
  const titleId = useId();

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) {
      returnFocus.current = focusOrigin();
      dialog.showModal();
      document.body.classList.add('sheet-open');
    } else if (!open && dialog.open) {
      dialog.close();
    }
  }, [open]);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    const handleClose = () => {
      document.body.classList.remove('sheet-open');
      const target = returnFocus.current;
      returnFocus.current = null;
      requestAnimationFrame(() => target?.isConnected && target.focus());
    };
    const handleCancel = (event: Event) => {
      event.preventDefault();
      onClose();
    };
    dialog.addEventListener('close', handleClose);
    dialog.addEventListener('cancel', handleCancel);
    return () => {
      dialog.removeEventListener('close', handleClose);
      dialog.removeEventListener('cancel', handleCancel);
    };
  }, [onClose]);

  const onBackdrop = (event: React.MouseEvent<HTMLDialogElement>) => {
    if (event.target === event.currentTarget) onClose();
  };

  return (
    <dialog ref={ref} className={styles.sheet} aria-labelledby={titleId} onClick={onBackdrop} data-testid={testId}>
      {open && (
        <div className={styles.sheetPanel}>
          <div className={styles.sheetHandle} aria-hidden="true" />
          <header className={styles.sheetHead}>
            <h2 id={titleId}>{title}</h2>
            <IconButton icon="close" label="關閉面板" onClick={onClose} autoFocus />
          </header>
          <div className={styles.sheetBody}>{children}</div>
          {footer && <div className={styles.sheetFooter}>{footer}</div>}
        </div>
      )}
    </dialog>
  );
}
