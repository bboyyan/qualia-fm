/** 分享頁單例（BRA-129）：沿用現有 API session 與開台 generation，不另建流程。 */
import { useAppStore } from '../../app/appStore';
import { api, generation } from '../../app/services';
import { createShareApi } from './shareApi';
import { ShareController } from './shareController';

export const shares = new ShareController({
  api: createShareApi(api),
  /** 與「我的歌 → 當種子開台」同一條路：開始編排、回開台頁看進度（正在播的節目不中斷）。 */
  startPlan: (request) => {
    const store = useAppStore.getState();
    void generation.start(request);
    store.announce('用旅程精選集的五首開下一趟');
    store.setTab('home');
  },
  settings: () => useAppStore.getState().settings,
});
