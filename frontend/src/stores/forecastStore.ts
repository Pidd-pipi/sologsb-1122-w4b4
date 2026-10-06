import { defineStore } from 'pinia';
import { db, toPlain } from '../utils/db';
import { newId } from '../utils/id';
import { evaluateForecast, type EvaluatedReconcile } from '../utils/reconcile';
import type {
  GeologyForecast,
  GeologyForecastDraft,
  Reconciliation,
  ReconcileStatus,
} from '../types/forecast';

interface ForecastState {
  forecasts: GeologyForecast[];
  reconciles: Reconciliation[];
  loaded: boolean;
}

function newReconcile(forecastId: string, evaluated: EvaluatedReconcile): Reconciliation {
  return {
    id: newId('rec'),
    forecastId,
    ...evaluated,
    reason: '',
    lastReason: '',
    closedAt: null,
    retractedAt: null,
    retractCause: '',
    retractedCount: 0,
    updatedAt: Date.now(),
  };
}

/** 计算结果与已存记录是否一致（一致则不打扰现有状态） */
function sameEvaluation(rec: Reconciliation, ev: EvaluatedReconcile): boolean {
  return (
    rec.faceId === ev.faceId &&
    rec.status === ev.status &&
    rec.gradeDiff === ev.gradeDiff &&
    rec.actualGrade === ev.actualGrade &&
    rec.actualWater === ev.actualWater &&
    rec.waterMatch === ev.waterMatch &&
    rec.issues.join('；') === ev.issues.join('；')
  );
}

export const useForecastStore = defineStore('forecast', {
  state: (): ForecastState => ({ forecasts: [], reconciles: [], loaded: false }),
  getters: {
    reconcileOf: (state) => (forecastId: string) =>
      state.reconciles.find((r) => r.forecastId === forecastId),
    countOf: (state) => (status: ReconcileStatus) =>
      state.reconciles.filter((r) => r.status === status).length,
  },
  actions: {
    async load() {
      await this.ensureReconciles();
      const [forecasts, reconciles] = await Promise.all([
        db.forecasts.toArray(),
        db.reconciles.toArray(),
      ]);
      this.forecasts = forecasts.sort((a, b) => a.mileageStart - b.mileageStart || a.issuedAt - b.issuedAt);
      this.reconciles = reconciles;
      this.loaded = true;
    },
    /** 为还没有对账记录的预报补建（录入后立即按编号和里程段认领） */
    async ensureReconciles() {
      const [forecasts, reconciles, faces, grades, waters] = await Promise.all([
        db.forecasts.toArray(),
        db.reconciles.toArray(),
        db.faces.toArray(),
        db.grades.toArray(),
        db.waters.toArray(),
      ]);
      const missing = forecasts.filter((f) => !reconciles.some((r) => r.forecastId === f.id));
      for (const f of missing) {
        await db.reconciles.put(toPlain(newReconcile(f.id, evaluateForecast(f, faces, grades, waters))));
      }
    },
    /**
     * 录入预报成果。同一份预报（编号相同）重复录入不重复记账，
     * 返回 duplicated=true 表示该编号已存在。
     */
    async addForecast(draft: GeologyForecastDraft) {
      const forecastNo = draft.forecastNo.trim();
      const existing = await db.forecasts.where('forecastNo').equals(forecastNo).first();
      if (existing) return { duplicated: true as const, forecast: existing };
      const record: GeologyForecast = {
        ...toPlain(draft),
        forecastNo,
        id: newId('fc'),
        issuedAt: Date.now(),
      };
      await db.forecasts.put(toPlain(record));
      await this.load();
      return { duplicated: false as const, forecast: record };
    },
    async removeForecast(id: string) {
      await db.forecasts.delete(id);
      await db.reconciles.where('forecastId').equals(id).delete();
      await this.load();
    },
    /** 待说明的对账写清原因后收口 */
    async closeReconcile(id: string, reason: string): Promise<boolean> {
      const rec = this.reconciles.find((r) => r.id === id);
      if (!rec || rec.status !== 'pending-explain') return false;
      await db.reconciles.update(
        id,
        toPlain({ status: 'closed', reason: reason.trim(), closedAt: Date.now(), updatedAt: Date.now() }),
      );
      await this.load();
      return true;
    },
    /**
     * 编录（岩性/里程等）、围岩判定或涌水记录更新后重算全部对账：
     * 已收口的若重算后仍对不上，退回待说明（上次说明留档）；
     * 重算后转为一致的自动销账。
     */
    async recomputeAll(cause: string) {
      const [forecasts, faces, grades, waters] = await Promise.all([
        db.forecasts.toArray(),
        db.faces.toArray(),
        db.grades.toArray(),
        db.waters.toArray(),
      ]);
      if (forecasts.length === 0) return;
      const reconciles = await db.reconciles.toArray();
      const now = Date.now();
      for (const f of forecasts) {
        const ev = evaluateForecast(f, faces, grades, waters);
        const existing = reconciles.find((r) => r.forecastId === f.id);
        if (!existing) {
          await db.reconciles.put(toPlain(newReconcile(f.id, ev)));
          continue;
        }
        if (existing.status === 'closed') {
          if (ev.status === 'matched') {
            await db.reconciles.update(
              existing.id,
              toPlain({ ...ev, retractCause: `${cause}，重算后转为一致`, updatedAt: now }),
            );
          } else {
            await db.reconciles.update(
              existing.id,
              toPlain({
                ...ev,
                lastReason: existing.reason,
                reason: '',
                closedAt: null,
                retractedAt: now,
                retractCause: `${cause}，已收口的对账重算后退回`,
                retractedCount: existing.retractedCount + 1,
                updatedAt: now,
              }),
            );
          }
          continue;
        }
        if (sameEvaluation(existing, ev)) continue;
        await db.reconciles.update(existing.id, toPlain({ ...ev, updatedAt: now }));
      }
      await this.load();
    },
  },
});
