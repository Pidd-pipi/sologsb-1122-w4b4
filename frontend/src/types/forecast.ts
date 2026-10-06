import type { Groundwater, RockGrade } from './grade';

/** 常用超前预报方法 */
export const FORECAST_METHODS = ['TSP', '地质雷达', '超前水平钻', '地质素描', '红外探水'];

/** 超前地质预报成果（预报组每循环一份） */
export interface GeologyForecast {
  id: string;
  /** 预报编号（唯一，同一份预报重复录入不重复记账） */
  forecastNo: string;
  /** 预报里程段起点（米） */
  mileageStart: number;
  /** 预报里程段终点（米） */
  mileageEnd: number;
  /** 预报围岩级别 */
  grade: RockGrade;
  /** 预报涌水状态 */
  water: Groundwater;
  /** 预报方法 */
  method: string;
  /** 预报人 / 预报单位 */
  forecaster: string;
  issuedAt: number;
}

export type GeologyForecastDraft = Omit<GeologyForecast, 'id' | 'issuedAt'>;

/**
 * 对账状态：
 * - pending-log：预报段还没有对应编录（待编录）
 * - matched：与编录比对一致
 * - pending-explain：级别差两级以上或涌水对不上，待说明
 * - closed：已写清原因，收口
 */
export type ReconcileStatus = 'pending-log' | 'matched' | 'pending-explain' | 'closed';

export const RECONCILE_STATUS_TEXT: Record<ReconcileStatus, string> = {
  'pending-log': '待编录',
  matched: '一致',
  'pending-explain': '待说明',
  closed: '已收口',
};

/** 预报与编录的对账记录 */
export interface Reconciliation {
  id: string;
  forecastId: string;
  /** 认领到的掌子面编录 id，未认领到为 null */
  faceId: string | null;
  status: ReconcileStatus;
  /** 预报与编录的级别差（无判定数据时为 null） */
  gradeDiff: number | null;
  /** 编录侧实际级别快照 */
  actualGrade: RockGrade | null;
  /** 编录侧实际涌水快照 */
  actualWater: Groundwater | null;
  /** 涌水是否吻合（null 表示编录缺数据无法比对） */
  waterMatch: boolean | null;
  /** 不一致项明细 */
  issues: string[];
  /** 收口时填写的原因说明 */
  reason: string;
  /** 被退回前的上次说明（留档备查） */
  lastReason: string;
  closedAt: number | null;
  /** 最近一次因编录更新被退回的时间 */
  retractedAt: number | null;
  retractCause: string;
  retractedCount: number;
  updatedAt: number;
}
