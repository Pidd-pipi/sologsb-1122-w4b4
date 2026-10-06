import type { RockGrade } from './grade';

/** 涌水等级（预报与实测对账的统一刻度） */
export type WaterLevel = '干燥' | '少量' | '中等' | '较大';

export const WATER_LEVELS: WaterLevel[] = ['干燥', '少量', '中等', '较大'];

/** 超前地质预报成果（每循环一份，编号唯一） */
export interface Forecast {
  id: string;
  /** 预报编号：唯一，重复录入按同一份更新，不重复记账 */
  code: string;
  /** 预报里程段起点（米） */
  mileageStart: number;
  /** 预报里程段终点（米） */
  mileageEnd: number;
  /** 预报围岩级别 */
  predictedGrade: RockGrade;
  /** 预报涌水等级 */
  predictedWater: WaterLevel;
  /** 发布时间 */
  issuedAt: number;
  forecaster: string;
  note: string;
  updatedAt: number;
}

export type ForecastDraft = Omit<Forecast, 'id' | 'updatedAt'>;

/** 对账状态：待编录 / 相符 / 待说明 / 已收口 */
export type ReconStatus = 'pending-log' | 'consistent' | 'pending-explain' | 'closed';

export const RECON_STATUS_TEXT: Record<ReconStatus, string> = {
  'pending-log': '待编录',
  consistent: '相符',
  'pending-explain': '待说明',
  closed: '已收口',
};

/** 差异说明（收口凭证）：一份预报只记一条账 */
export interface ReconExplanation {
  id: string;
  forecastId: string;
  reason: string;
  explainedBy: string;
  explainedAt: number;
  /** 收口时的比对指纹；编录或预报更新导致指纹失配即自动退回待说明 */
  fingerprint: string;
}
