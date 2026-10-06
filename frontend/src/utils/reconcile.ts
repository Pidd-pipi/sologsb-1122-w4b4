import type { TunnelFace } from '../types/face';
import { GROUNDWATERS, ROCK_GRADES, type Groundwater, type RockGrade, type RockMassGrade } from '../types/grade';
import type { InflowType, WaterInflow } from '../types/water';
import type { GeologyForecast, ReconcileStatus } from '../types/forecast';
import { formatChainage } from './geoMath';

/** 涌水记录类型 → 出水状态等级（用于编录侧无级别判定时取涌水记录比对） */
const INFLOW_AS_GROUNDWATER: Record<InflowType, Groundwater> = {
  渗水: '潮湿',
  滴水: '点滴状出水',
  线流: '线状出水',
  股状: '涌流状出水',
};

/** 里程段重叠长度（米），不重叠为 0 */
export function rangeOverlap(aStart: number, aEnd: number, bStart: number, bEnd: number): number {
  return Math.max(0, Math.min(aEnd, bEnd) - Math.max(aStart, bStart));
}

/**
 * 认领编录：先按编号（预报编号与掌子面编号一致或包含，且里程段有重叠），
 * 再按里程段重叠最大者认领；都不沾边则返回 null（待编录）。
 */
export function claimFace(
  forecast: Pick<GeologyForecast, 'forecastNo' | 'mileageStart' | 'mileageEnd'>,
  faces: TunnelFace[],
): TunnelFace | null {
  const no = forecast.forecastNo.trim();
  const byNo = faces.filter(
    (f) =>
      (no === f.faceNo || (f.faceNo.length > 0 && no.includes(f.faceNo))) &&
      rangeOverlap(forecast.mileageStart, forecast.mileageEnd, f.mileageRange[0], f.mileageRange[1]) > 0,
  );
  if (byNo.length > 0) return [...byNo].sort((a, b) => b.chainage - a.chainage)[0];

  let best: TunnelFace | null = null;
  let bestOverlap = 0;
  for (const f of faces) {
    const overlap = rangeOverlap(forecast.mileageStart, forecast.mileageEnd, f.mileageRange[0], f.mileageRange[1]);
    if (overlap > bestOverlap) {
      best = f;
      bestOverlap = overlap;
    }
  }
  return best;
}

/** 编录侧实际围岩级别：取该掌子面最新一次判定 */
export function actualGradeOf(faceId: string, grades: RockMassGrade[]): RockGrade | null {
  const latest = grades
    .filter((g) => g.faceId === faceId)
    .sort((a, b) => b.judgedAt - a.judgedAt)[0];
  return latest ? latest.grade : null;
}

/** 编录侧实际涌水：优先取最新判定的出水状态，否则取涌水记录中最严重的一档 */
export function actualWaterOf(faceId: string, grades: RockMassGrade[], waters: WaterInflow[]): Groundwater | null {
  const latest = grades
    .filter((g) => g.faceId === faceId)
    .sort((a, b) => b.judgedAt - a.judgedAt)[0];
  if (latest) return latest.groundwater;
  const list = waters.filter((w) => w.faceId === faceId);
  if (list.length === 0) return null;
  const order: InflowType[] = ['渗水', '滴水', '线流', '股状'];
  const worst = [...list].sort((a, b) => order.indexOf(b.type) - order.indexOf(a.type))[0];
  return INFLOW_AS_GROUNDWATER[worst.type];
}

/** 对账计算结果（不含收口/退回等人工状态） */
export interface EvaluatedReconcile {
  faceId: string | null;
  status: ReconcileStatus;
  gradeDiff: number | null;
  actualGrade: RockGrade | null;
  actualWater: Groundwater | null;
  waterMatch: boolean | null;
  issues: string[];
}

/**
 * 比对一份预报与认领到的编录：
 * 围岩级别差两级以上、或涌水状态对不上（等级差 ≥ 2），列入待说明。
 */
export function evaluateForecast(
  forecast: Pick<GeologyForecast, 'forecastNo' | 'mileageStart' | 'mileageEnd' | 'grade' | 'water'>,
  faces: TunnelFace[],
  grades: RockMassGrade[],
  waters: WaterInflow[],
): EvaluatedReconcile {
  const face = claimFace(forecast, faces);
  if (!face) {
    return {
      faceId: null,
      status: 'pending-log',
      gradeDiff: null,
      actualGrade: null,
      actualWater: null,
      waterMatch: null,
      issues: [
        `预报里程段 ${formatChainage(forecast.mileageStart)} ~ ${formatChainage(forecast.mileageEnd)} 尚无对应掌子面编录`,
      ],
    };
  }

  const issues: string[] = [];

  const actualGrade = actualGradeOf(face.id, grades);
  let gradeDiff: number | null = null;
  if (!actualGrade) {
    issues.push('编录尚无围岩级别判定，无法比对预报级别');
  } else {
    gradeDiff = Math.abs(ROCK_GRADES.indexOf(forecast.grade) - ROCK_GRADES.indexOf(actualGrade));
    if (gradeDiff >= 2) {
      issues.push(`围岩级别偏差 ${gradeDiff} 级：预报 ${forecast.grade} 级，编录判定 ${actualGrade} 级`);
    }
  }

  const actualWater = actualWaterOf(face.id, grades, waters);
  let waterMatch: boolean | null = null;
  if (!actualWater) {
    issues.push('编录尚无出水记录，无法比对预报涌水');
  } else {
    waterMatch = Math.abs(GROUNDWATERS.indexOf(forecast.water) - GROUNDWATERS.indexOf(actualWater)) <= 1;
    if (!waterMatch) {
      issues.push(`涌水情况不符：预报「${forecast.water}」，编录为「${actualWater}」`);
    }
  }

  return {
    faceId: face.id,
    status: issues.length > 0 ? 'pending-explain' : 'matched',
    gradeDiff,
    actualGrade,
    actualWater,
    waterMatch,
    issues,
  };
}
