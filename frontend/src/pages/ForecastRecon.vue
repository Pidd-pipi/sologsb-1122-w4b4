<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue';
import { useRouter } from 'vue-router';
import { ElMessage, ElMessageBox } from 'element-plus';
import { useForecastStore } from '../stores/forecastStore';
import { useFaceStore } from '../stores/faceStore';
import { useGradeStore } from '../stores/gradeStore';
import GradeTag from '../components/common/GradeTag.vue';
import {
  RECON_STATUS_TEXT,
  WATER_LEVELS,
  type ForecastDraft,
  type ReconStatus,
  type WaterLevel,
} from '../types/forecast';
import { ROCK_GRADES, type RockGrade } from '../types/grade';
import { GRADE_DIFF_THRESHOLD, type ReconRow } from '../utils/reconcile';
import { formatChainage } from '../utils/geoMath';

const router = useRouter();
const forecastStore = useForecastStore();
const faceStore = useFaceStore();
const gradeStore = useGradeStore();

const statusFilter = ref<'all' | ReconStatus>('all');
const rows = computed(() => forecastStore.rows);
const counts = computed(() => forecastStore.counts);
const filtered = computed(() =>
  statusFilter.value === 'all' ? rows.value : rows.value.filter((r) => r.status === statusFilter.value),
);

function tagType(status: ReconStatus): 'warning' | 'info' | 'success' | 'primary' {
  switch (status) {
    case 'pending-explain':
      return 'warning';
    case 'pending-log':
      return 'info';
    case 'consistent':
      return 'success';
    case 'closed':
      return 'primary';
  }
}

function statusText(status: ReconStatus): string {
  return RECON_STATUS_TEXT[status];
}

/* ---------- 预报录入（编号幂等） ---------- */
const entryVisible = ref(false);
const entryError = ref('');
const entryForm = reactive({
  code: '',
  mileageStart: 12486,
  mileageEnd: 12489,
  predictedGrade: 'Ⅲ' as RockGrade,
  predictedWater: '干燥' as WaterLevel,
  issuedAt: String(Date.now()),
  forecaster: '',
  note: '',
});

/** 编号已存在时提示将按同一份更新 */
const duplicated = computed(() => forecastStore.byCode(entryForm.code));

function openEntry() {
  entryVisible.value = true;
  entryError.value = '';
}

async function submitEntry() {
  entryError.value = '';
  const code = entryForm.code.trim();
  if (!code) {
    entryError.value = '预报编号必填';
    return;
  }
  if (entryForm.mileageEnd <= entryForm.mileageStart) {
    entryError.value = '里程段终点必须大于起点';
    return;
  }
  const draft: ForecastDraft = {
    code,
    mileageStart: entryForm.mileageStart,
    mileageEnd: entryForm.mileageEnd,
    predictedGrade: entryForm.predictedGrade,
    predictedWater: entryForm.predictedWater,
    issuedAt: Number(entryForm.issuedAt) || Date.now(),
    forecaster: entryForm.forecaster.trim(),
    note: entryForm.note.trim(),
  };
  const { record, isUpdate } = await forecastStore.upsert(draft);
  entryVisible.value = false;
  ElMessage.success(
    isUpdate ? `预报「${record.code}」已存在，按同一份更新，不重复记账` : `已录入预报「${record.code}」`,
  );
  entryForm.code = '';
}

/* ---------- 差异说明（收口） ---------- */
const explainVisible = ref(false);
const explainError = ref('');
const explainTarget = ref<ReconRow | null>(null);
const explainForm = reactive({ reason: '', by: '' });

function openExplain(row: ReconRow) {
  explainTarget.value = row;
  // 已收口或曾收口过的，带出原说明便于修改
  explainForm.reason = row.explanation?.reason ?? row.staleExplanation?.reason ?? '';
  explainForm.by = row.explanation?.explainedBy ?? row.staleExplanation?.explainedBy ?? '';
  explainError.value = '';
  explainVisible.value = true;
}

async function submitExplain() {
  const row = explainTarget.value;
  if (!row) return;
  explainError.value = '';
  if (!explainForm.reason.trim()) {
    explainError.value = '必须写清原因才能收口';
    return;
  }
  if (!explainForm.by.trim()) {
    explainError.value = '请填写说明人';
    return;
  }
  await forecastStore.explain(row.forecast.id, explainForm.reason, explainForm.by, row.fingerprint);
  explainVisible.value = false;
  ElMessage.success(`预报「${row.forecast.code}」已收口`);
}

async function removeForecast(row: ReconRow) {
  await ElMessageBox.confirm(`删除预报「${row.forecast.code}」及其对账说明？`, '删除确认', {
    type: 'warning',
  });
  await forecastStore.remove(row.forecast.id);
  ElMessage.success(`已删除预报「${row.forecast.code}」`);
}

onMounted(async () => {
  await faceStore.load();
  await gradeStore.load();
  await forecastStore.load();
});
</script>

<template>
  <div class="page">
    <div class="header">
      <h2>超前预报对账</h2>
      <el-tag type="warning">待说明 {{ counts['pending-explain'] }}</el-tag>
      <el-tag type="info">待编录 {{ counts['pending-log'] }}</el-tag>
      <el-tag type="success">相符 {{ counts.consistent }}</el-tag>
      <el-tag type="primary">已收口 {{ counts.closed }}</el-tag>
      <div class="spacer" />
      <el-button type="primary" @click="openEntry">录入预报成果</el-button>
    </div>

    <el-card shadow="never">
      <el-radio-group v-model="statusFilter">
        <el-radio-button value="all">全部 {{ rows.length }}</el-radio-button>
        <el-radio-button value="pending-explain">待说明</el-radio-button>
        <el-radio-button value="pending-log">待编录</el-radio-button>
        <el-radio-button value="consistent">相符</el-radio-button>
        <el-radio-button value="closed">已收口</el-radio-button>
      </el-radio-group>
      <span class="hint">级别差 ≥ {{ GRADE_DIFF_THRESHOLD }} 级或涌水不符即列待说明，写清原因才收口；编录更新后已收口的自动退回重算</span>
    </el-card>

    <el-card shadow="never">
      <el-table :data="filtered" border size="small">
        <el-table-column label="预报编号" width="120">
          <template #default="{ row }">
            <strong>{{ row.forecast.code }}</strong>
          </template>
        </el-table-column>
        <el-table-column label="预报里程段" width="185">
          <template #default="{ row }">
            {{ formatChainage(row.forecast.mileageStart) }} ~ {{ formatChainage(row.forecast.mileageEnd) }}
          </template>
        </el-table-column>
        <el-table-column label="预报级别" width="85" align="center">
          <template #default="{ row }">
            <GradeTag :grade="row.forecast.predictedGrade" />
          </template>
        </el-table-column>
        <el-table-column label="实测级别" width="85" align="center">
          <template #default="{ row }">
            <GradeTag v-if="row.actualGrade" :grade="row.actualGrade" />
            <span v-else class="muted">—</span>
          </template>
        </el-table-column>
        <el-table-column label="级别差" width="85" align="center">
          <template #default="{ row }">
            <span v-if="row.gradeDiff !== undefined" :class="{ bad: row.gradeDiff >= GRADE_DIFF_THRESHOLD }">
              {{ row.gradeDiff === 0 ? '一致' : `差 ${row.gradeDiff} 级` }}
            </span>
            <span v-else class="muted">—</span>
          </template>
        </el-table-column>
        <el-table-column label="涌水对照（预报 → 实测）" width="210">
          <template #default="{ row }">
            <template v-if="row.actualWater">
              <span :class="{ bad: !row.waterMatch }">{{ row.forecast.predictedWater }} → {{ row.actualWater }}</span>
              <span v-if="row.waterAssumed" class="muted">（无涌水记录，按干燥计）</span>
            </template>
            <span v-else class="muted">—</span>
          </template>
        </el-table-column>
        <el-table-column label="认领掌子面" width="100" align="center">
          <template #default="{ row }">
            <el-link v-if="row.face" type="primary" @click="router.push(`/faces/${row.face.id}`)">
              {{ row.face.faceNo }}
            </el-link>
            <span v-else class="muted">未认领</span>
          </template>
        </el-table-column>
        <el-table-column label="状态" width="88" align="center">
          <template #default="{ row }">
            <el-tag :type="tagType(row.status)" effect="dark" size="small">
              {{ statusText(row.status) }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column label="差异与说明" min-width="260">
          <template #default="{ row }">
            <span v-if="row.status === 'pending-log'" class="muted">{{ row.missing.join('；') }}</span>
            <template v-else-if="row.mismatches.length > 0">
              <div v-for="m in row.mismatches" :key="m" class="mismatch">{{ m }}</div>
              <div v-if="row.status === 'closed' && row.explanation" class="reason">
                说明：{{ row.explanation.reason }}（{{ row.explanation.explainedBy }} ·
                {{ new Date(row.explanation.explainedAt).toLocaleString('zh-CN') }}）
              </div>
              <div v-else-if="row.staleExplanation" class="stale">
                原说明已失效（编录或预报已更新）：{{ row.staleExplanation.reason }}
              </div>
            </template>
            <span v-else class="muted">级别与涌水均相符</span>
          </template>
        </el-table-column>
        <el-table-column label="操作" width="160" align="center">
          <template #default="{ row }">
            <el-button
              v-if="row.status === 'pending-explain'"
              type="primary"
              size="small"
              @click="openExplain(row)"
            >
              填写说明
            </el-button>
            <el-button v-else-if="row.status === 'closed'" size="small" @click="openExplain(row)">
              查看说明
            </el-button>
            <el-button type="danger" size="small" text @click="removeForecast(row)">删除</el-button>
          </template>
        </el-table-column>
        <template #empty>
          <el-empty description="暂无预报成果，点击右上角「录入预报成果」" />
        </template>
      </el-table>
    </el-card>

    <el-dialog v-model="entryVisible" title="录入预报成果" width="580px">
      <el-alert v-if="entryError" :title="entryError" type="error" :closable="false" class="dialog-alert" />
      <el-alert
        v-if="duplicated"
        title="该编号已存在，保存将更新原预报（同一份预报不重复记账）"
        type="warning"
        :closable="false"
        class="dialog-alert"
      />
      <el-form label-width="110px">
        <el-form-item label="预报编号" required>
          <el-input v-model="entryForm.code" placeholder="如 YB-2026-15" />
        </el-form-item>
        <el-form-item label="预报里程段 m" required>
          <el-input-number v-model="entryForm.mileageStart" :min="0" :max="999999" />
          <span style="margin: 0 6px">—</span>
          <el-input-number v-model="entryForm.mileageEnd" :min="0" :max="999999" />
          <div class="hint-block">
            {{ formatChainage(entryForm.mileageStart) }} ~ {{ formatChainage(entryForm.mileageEnd) }}
          </div>
        </el-form-item>
        <el-form-item label="预报围岩级别">
          <el-select v-model="entryForm.predictedGrade" style="width: 140px">
            <el-option v-for="g in ROCK_GRADES" :key="g" :label="`${g} 级`" :value="g" />
          </el-select>
        </el-form-item>
        <el-form-item label="预报涌水">
          <el-select v-model="entryForm.predictedWater" style="width: 140px">
            <el-option v-for="w in WATER_LEVELS" :key="w" :label="w" :value="w" />
          </el-select>
          <span class="hint">实测按最大涌水量分档：&lt;5 干燥 / 5~20 少量 / 20~60 中等 / ≥60 较大（L/min）</span>
        </el-form-item>
        <el-form-item label="发布日期">
          <el-date-picker v-model="entryForm.issuedAt" type="date" value-format="x" style="width: 160px" />
        </el-form-item>
        <el-form-item label="预报员">
          <el-input v-model="entryForm.forecaster" style="width: 200px" />
        </el-form-item>
        <el-form-item label="备注">
          <el-input v-model="entryForm.note" placeholder="如 TSP 期号、预报方法" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="entryVisible = false">取消</el-button>
        <el-button type="primary" @click="submitEntry">保存</el-button>
      </template>
    </el-dialog>

    <el-dialog v-model="explainVisible" :title="`差异说明 · ${explainTarget?.forecast.code ?? ''}`" width="560px">
      <el-alert v-if="explainError" :title="explainError" type="error" :closable="false" class="dialog-alert" />
      <el-alert
        v-if="explainTarget?.staleExplanation"
        title="编录或预报已更新，原说明失效，需重新说明后才可收口"
        type="warning"
        :closable="false"
        class="dialog-alert"
      />
      <div class="diff-box">
        <div v-for="m in explainTarget?.mismatches ?? []" :key="m" class="mismatch">{{ m }}</div>
      </div>
      <el-form label-width="90px" style="margin-top: 12px">
        <el-form-item label="差异原因" required>
          <el-input
            v-model="explainForm.reason"
            type="textarea"
            :rows="3"
            placeholder="写清原因才算收口，如：预报段内断层破碎带位置与开挖揭示不符，实际围岩更差"
          />
        </el-form-item>
        <el-form-item label="说明人" required>
          <el-input v-model="explainForm.by" style="width: 200px" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="explainVisible = false">取消</el-button>
        <el-button type="primary" @click="submitExplain">确认收口</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<style scoped>
.page {
  display: flex;
  flex-direction: column;
  gap: 14px;
}
.header {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
}
.header h2 {
  margin: 0;
}
.spacer {
  flex: 1;
}
.hint {
  margin-left: 12px;
  color: #97a0ad;
  font-size: 12px;
}
.hint-block {
  width: 100%;
  color: #97a0ad;
  font-size: 12px;
}
.muted {
  color: #97a0ad;
  font-size: 12px;
}
.bad {
  color: #c0392b;
  font-weight: 600;
}
.mismatch {
  color: #b3541e;
  font-size: 13px;
  line-height: 1.6;
}
.reason {
  color: #2f3a46;
  font-size: 12px;
  margin-top: 4px;
}
.stale {
  color: #97a0ad;
  font-size: 12px;
  margin-top: 4px;
  text-decoration: line-through;
}
.diff-box {
  background: #fdf6ec;
  border: 1px solid #f5dab1;
  border-radius: 6px;
  padding: 8px 12px;
}
.dialog-alert {
  margin-bottom: 10px;
}
</style>
