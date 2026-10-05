/**
 * 勾選清單的共用規則（BRA-117）：開台的種子清單與 Ready 的 5 首用同一套，
 * 預設全選、一個「全選」切換、一顆主按鈕，不做兩套互相打架的流程。
 */
import type { ShowPlan } from '@qualia/contracts';

export function toggleId(selected: readonly string[], id: string): readonly string[] {
  return selected.includes(id) ? selected.filter((value) => value !== id) : [...selected, id];
}

export function isAllSelected(ids: readonly string[], selected: readonly string[]): boolean {
  return ids.length > 0 && ids.every((id) => selected.includes(id));
}

/** 沒全選 → 全選；已全選 → 全部取消。 */
export function toggleAll(ids: readonly string[], selected: readonly string[]): readonly string[] {
  return isAllSelected(ids, selected) ? [] : [...ids];
}

/** 依清單原本的順序取出已勾選的項目。 */
export function pickSelected<T>(items: readonly T[], selected: readonly string[], idOf: (item: T) => string): T[] {
  return items.filter((item) => selected.includes(idOf(item)));
}

/** 主按鈕文字：全選時就是一鍵「全選・…」，部分選取時說明數量。 */
export function startLabel(verb: string, selectedCount: number, total: number): string {
  return selectedCount === total ? `全選・${verb}` : `${verb}（已選 ${selectedCount}／${total}）`;
}

/** Ready 只播勾選的曲目：依節目順序保留；全選時原樣回傳。 */
export function pickSegments(show: ShowPlan, segmentIds: readonly string[]): ShowPlan {
  const segments = show.segments.filter((segment) => segmentIds.includes(segment.segmentId));
  return segments.length === show.segments.length ? show : { ...show, segments };
}
