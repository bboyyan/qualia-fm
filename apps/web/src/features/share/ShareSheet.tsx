/**
 * 分享頁容器（BRA-129）：讀 `?share=<短碼>` 打開分享頁（只在已登入的同一個 app 內有效），
 * 存圖（本機 canvas → PNG 下載）、複製內部連結、繼續旅程。公開連結（L2）停用。
 */
import { useCallback, useEffect, useMemo, useSyncExternalStore } from 'react';
import { useAppStore } from '../../app/appStore';
import { BottomSheet } from '../../ui/BottomSheet';
import { ShareContent, type ShareActions } from './ShareContent';
import { imageFileName, renderCardPng } from './shareCard';
import type { ShareController } from './shareController';
import { internalShareUrl, readShareCode, urlWithoutShare } from './shareLink';

function download(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = fileName;
  anchor.rel = 'noopener';
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1_000);
}

/** 打開時讀一次網址上的短碼，讀完就從網址拿掉。 */
function useShareLink(controller: ShareController): void {
  useEffect(() => {
    const { pathname, search, hash } = window.location;
    const code = readShareCode(search);
    if (!code) return;
    window.history.replaceState(window.history.state, '', urlWithoutShare(pathname, search, hash));
    void controller.openFromLink(code);
  }, [controller]);
}

export function ShareSheet({ controller }: { controller: ShareController }) {
  useShareLink(controller);
  const state = useSyncExternalStore(controller.subscribe, controller.getState, controller.getState);
  const showToast = useAppStore((s) => s.showToast);
  const close = useCallback(() => controller.close(), [controller]);
  const actions = useMemo<ShareActions>(() => ({
    saveImage: () => {
      const view = controller.getState().view;
      if (!view) return;
      renderCardPng(view)
        .then((blob) => {
          download(blob, imageFileName(view));
          showToast('已存成圖片。');
        })
        .catch(() => showToast('這台裝置暫時無法產生圖片，可以改用截圖。'));
    },
    copyLink: () => {
      const view = controller.getState().view;
      if (!view) return;
      const url = internalShareUrl(window.location.origin, view.code);
      const clipboard = navigator.clipboard as Clipboard | undefined;
      if (!clipboard) {
        showToast(`無法自動複製，請手動複製：${url}`);
        return;
      }
      clipboard.writeText(url)
        .then(() => showToast('已複製連結（只在這個 app 內、已登入時打得開）。'))
        .catch(() => showToast(`無法自動複製，請手動複製：${url}`));
    },
    continueJourney: () => void controller.continueJourney(),
    startEdit: () => controller.startEdit(),
    cancelEdit: () => controller.cancelEdit(),
    setDraft: (draft) => controller.setDraft(draft),
  }), [controller, showToast]);
  return (
    <BottomSheet open={state.status !== 'closed'} title="分享旅程精選集" onClose={close} testId="share-sheet">
      <ShareContent state={state} actions={actions} />
    </BottomSheet>
  );
}
