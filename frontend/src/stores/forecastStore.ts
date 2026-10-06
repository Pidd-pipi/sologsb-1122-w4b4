import { defineStore } from 'pinia';
import { db, toPlain } from '../utils/db';
import { newId } from '../utils/id';
import type { Forecast, ForecastDraft, ReconExplanation, ReconStatus } from '../types/forecast';
import { reconcile, type ReconRow } from '../utils/reconcile';
import { useFaceStore } from './faceStore';
import { useGradeStore } from './gradeStore';

interface ForecastState {
  forecasts: Forecast[];
  explanations: ReconExplanation[];
  loaded: boolean;
}

export const useForecastStore = defineStore('forecast', {
  state: (): ForecastState => ({ forecasts: [], explanations: [], loaded: false }),
  getters: {
    byCode: (state) => {
      return (code: string) => {
        const key = code.trim().toLowerCase();
        if (!key) return undefined;
        return state.forecasts.find((it) => it.code.trim().toLowerCase() === key);
      };
    },
    /** 对账台账：逐份预报与编录比对后的派生行，编录/预报更新即自动重算 */
    rows: (state): ReconRow[] => {
      const faceStore = useFaceStore();
      const gradeStore = useGradeStore();
      return state.forecasts
        .map((f) => reconcile(f, faceStore.items, gradeStore.items, gradeStore.waters, state.explanations))
        .sort((a, b) => a.forecast.mileageStart - b.forecast.mileageStart);
    },
    /** 各状态数量（用于台账头部统计） */
    counts(): Record<ReconStatus, number> {
      const result: Record<ReconStatus, number> = {
        'pending-log': 0,
        consistent: 0,
        'pending-explain': 0,
        closed: 0,
      };
      for (const row of this.rows) result[row.status] += 1;
      return result;
    },
  },
  actions: {
    async load() {
      this.forecasts = (await db.forecasts.toArray()).sort((a, b) => a.mileageStart - b.mileageStart);
      this.explanations = await db.explanations.toArray();
      this.loaded = true;
    },
    /**
     * 幂等录入：编号已存在则按同一份预报更新（不重复记账），否则新建。
     * 更新会改变比对指纹，已收口的对账随之退回待说明。
     */
    async upsert(draft: ForecastDraft): Promise<{ record: Forecast; isUpdate: boolean }> {
      const code = draft.code.trim();
      const existing = this.byCode(code);
      const now = Date.now();
      if (existing) {
        const record: Forecast = { ...existing, ...toPlain({ ...draft, code }), updatedAt: now };
        await db.forecasts.put(toPlain(record));
        this.forecasts = this.forecasts.map((it) => (it.id === record.id ? record : it));
        return { record, isUpdate: true };
      }
      const record: Forecast = { ...toPlain({ ...draft, code }), id: newId('fc'), updatedAt: now };
      await db.forecasts.put(toPlain(record));
      this.forecasts = [...this.forecasts, record].sort((a, b) => a.mileageStart - b.mileageStart);
      return { record, isUpdate: false };
    },
    /** 删除预报并连带其说明账 */
    async remove(id: string) {
      await db.transaction('rw', db.forecasts, db.explanations, async () => {
        await db.forecasts.delete(id);
        await db.explanations.where('forecastId').equals(id).delete();
      });
      this.forecasts = this.forecasts.filter((it) => it.id !== id);
      this.explanations = this.explanations.filter((it) => it.forecastId !== id);
    },
    /** 写清原因收口：一份预报只保留一条说明账，重复说明覆盖旧账 */
    async explain(forecastId: string, reason: string, explainedBy: string, fingerprint: string) {
      const existing = this.explanations.find((it) => it.forecastId === forecastId);
      const record: ReconExplanation = {
        id: existing?.id ?? newId('exp'),
        forecastId,
        reason: reason.trim(),
        explainedBy: explainedBy.trim(),
        explainedAt: Date.now(),
        fingerprint,
      };
      await db.explanations.put(toPlain(record));
      this.explanations = [...this.explanations.filter((it) => it.forecastId !== forecastId), record];
      return record;
    },
  },
});
