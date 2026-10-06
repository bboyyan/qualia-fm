import { AppError } from '../http/errors.js';

export interface BudgetQuotaDetails {
  quotaLimit: 'graphemes' | 'dailyUsd' | 'totalUsd' | 'plans';
  graphemesUsed: number;
  graphemesLimit: number;
  segmentGraphemes: number;
}

/** 僅攜帶帳本數字與固定分類，不包含台詞或供應商資料。 */
export class BudgetQuotaError extends AppError {
  constructor(readonly quota: BudgetQuotaDetails) {
    super('QUOTA_EXCEEDED', { message: '今日或總預算已達上限，請使用示範模式或稍後再試。' });
  }
}
