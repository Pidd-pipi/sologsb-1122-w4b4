import type { TunnelFace } from '../types/face';
import type {
  Forecast,
  ReconExplanation,
  ReconStatus,
  WaterLevel,
} from '../types/forecast';
import { ROCK_GRADES, type RockGrade, type RockMassGrade } from '../types/grade';
import type { WaterInflow } from '../types/water';

/** 围岩级别差达到该级数即判对不上 */
export const GRADE_DIFF_THRESHOLD = 2;

/** 围岩级别相差级数（Ⅰ~Ⅵ 下标差的绝对值） */
export function gradeDiff(a: RockGrade, b: RockGrade): number {
  return Math.abs(ROCK_GRADES.indexOf(a) - ROCK_GRADES.indexOf(b));
}

/**
 * 实测涌水量（L/min）→ 涌水等级。
 * 分档与涌水建议措施同刻度：<5 干燥 / 5~20 少量 / 20~60 中等 / ≥60 较大。
 */
export function flowToWaterLevel(flow: number): WaterLevel {
  if (flow >= 60) return '较大';
  if (flow >= 20) return '中等';
  if (flow >= 5) return '少量';
  return '干燥';
}

/** 实测涌水等级：取该掌子面涌水记录的最大估算流量换算；无记录按干燥计 */
export function actualWaterLevel(waters: WaterInflow[]): WaterLevel {
  if (waters.length === 0) return '干燥';
  return flowToWaterLevel(Math.max(...waters.map((w) => w.estimatedFlow)));
}

/**
 * 认领编录：预报编号与掌子面编号一致优先认领；
 * 否则按里程段重叠认领，取重叠长度最大的掌子面；里程段不相交则不认领。
 */
export function matchFace(forecast: Forecast, faces: TunnelFace[]): TunnelFace | undefined {
  const code = forecast.code.trim().toLowerCase();
  const byCode = faces.find((f) => f.faceNo.trim().toLowerCase() === code);
  if (byCode) return byCode;
  let best: TunnelFace | undefined;
  let bestOverlap = 0;
  for (const face of faces) {
    const overlap =
      Math.min(forecast.mileageEnd, face.mileageRange[1]) -
      Math.max(forecast.mileageStart, face.mileageRange[0]);
    if (overlap > bestOverlap) {
      best = face;
      bestOverlap = overlap;
    }
  }
  return best;
}

/**
 * 比对指纹：收口时把两侧关键字段固化下来。
 * 之后预报（里程段/级别/涌水）或编录（认领关系/里程区间/岩性/围岩判定/涌水）
 * 任一更新都会使指纹失配，已收口的对账自动退回待说明。
 */
export function buildFingerprint(parts: {
  forecast: Forecast;
  face: TunnelFace;
  actualGrade: RockGrade;
  actualWater: WaterLevel;
}): string {
  const { forecast, face, actualGrade, actualWater } = parts;
  return JSON.stringify([
    forecast.mileageStart,
    forecast.mileageEnd,
    forecast.predictedGrade,
    forecast.predictedWater,
    face.id,
    face.mileageRange[0],
    face.mileageRange[1],
    face.lithology,
    actualGrade,
    actualWater,
  ]);
}

/** 一行对账结果（派生数据，不落库） */
export interface ReconRow {
  forecast: Forecast;
  face?: TunnelFace;
  actualGrade?: RockGrade;
  actualWater?: WaterLevel;
  /** 无涌水记录时实测按干燥计，界面需提示 */
  waterAssumed: boolean;
  gradeDiff?: number;
  waterMatch: boolean;
  /** 对不上的差异描述 */
  mismatches: string[];
  /** 待编录原因 */
  missing: string[];
  status: ReconStatus;
  /** 当前比对指纹，写说明时随说明保存 */
  fingerprint: string;
  /** 生效中的说明（指纹匹配 → 已收口） */
  explanation?: ReconExplanation;
  /** 已失效的说明（指纹失配 → 已退回待说明） */
  staleExplanation?: ReconExplanation;
}

/** 单份预报与编录对账 */
export function reconcile(
  forecast: Forecast,
  faces: TunnelFace[],
  grades: RockMassGrade[],
  waters: WaterInflow[],
  explanations: ReconExplanation[],
): ReconRow {
  const explanation = explanations.find((e) => e.forecastId === forecast.id);
  const face = matchFace(forecast, faces);
  const row: ReconRow = {
    forecast,
    face,
    waterAssumed: false,
    waterMatch: true,
    mismatches: [],
    missing: [],
    status: 'pending-log',
    fingerprint: '',
  };
  if (!face) {
    row.missing.push('未认领到对应掌子面编录');
    return row;
  }
  const grade = grades
    .filter((g) => g.faceId === face.id)
    .sort((a, b) => b.judgedAt - a.judgedAt)[0];
  if (!grade) {
    row.missing.push(`已认领 ${face.faceNo}，但缺少围岩级别判定`);
    return row;
  }
  const faceWaters = waters.filter((w) => w.faceId === face.id);
  const actualWater = actualWaterLevel(faceWaters);
  const diff = gradeDiff(forecast.predictedGrade, grade.grade);
  const waterMatch = forecast.predictedWater === actualWater;
  if (diff >= GRADE_DIFF_THRESHOLD) {
    row.mismatches.push(`围岩级别预报 ${forecast.predictedGrade} 级 / 实测 ${grade.grade} 级，相差 ${diff} 级`);
  }
  if (!waterMatch) {
    row.mismatches.push(`涌水预报「${forecast.predictedWater}」/ 实测「${actualWater}」`);
  }
  row.actualGrade = grade.grade;
  row.actualWater = actualWater;
  row.waterAssumed = faceWaters.length === 0;
  row.gradeDiff = diff;
  row.waterMatch = waterMatch;
  row.fingerprint = buildFingerprint({ forecast, face, actualGrade: grade.grade, actualWater });
  if (row.mismatches.length === 0) {
    row.status = 'consistent';
    return row;
  }
  if (explanation && explanation.fingerprint === row.fingerprint) {
    row.status = 'closed';
    row.explanation = explanation;
    return row;
  }
  row.status = 'pending-explain';
  row.staleExplanation = explanation;
  return row;
}
