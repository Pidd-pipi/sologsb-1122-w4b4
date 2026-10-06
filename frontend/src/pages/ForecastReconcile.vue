<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue';
import { useRouter } from 'vue-router';
import { ElMessage, ElMessageBox } from 'element-plus';
import { useFaceStore } from '../stores/faceStore';
import { useForecastStore } from '../stores/forecastStore';
import GradeTag from '../components/common/GradeTag.vue';
import { FORECAST_METHODS, RECONCILE_STATUS_TEXT, type GeologyForecast, type Reconciliation, type ReconcileStatus } from '../types/forecast';
import { GROUNDWATERS, ROCK_GRADES, type Groundwater, type RockGrade } from '../types/grade';
import type { TunnelFace } from '../types/face';
import { formatChainage } from '../utils/geoMath';

const router = useRouter();
const faceStore = useFaceStore();
const forecastStore = useForecastStore();

interface Row {
  forecast: GeologyForecast;
  rec: Reconciliation | undefined;
  face: TunnelFace | null;
}

const rows = computed<Row[]>(() =>
  forecastStore.forecasts.map((forecast) => {
    const rec = forecastStore.reconcileOf(forecast.id);
    return {
      forecast,
      rec,
      face: rec?.faceId ? faceStore.byId(rec.faceId) ?? null : null,
    };
  }),
);

const STATUS_TAG_TYPE: Record<ReconcileStatus, 'info' | 'success' | 'danger' | 'warning'> = {
  'pending-log': 'info',
  matched: 'success',
  'pending-explain': 'danger',
  closed: 'warning',
};

const counts = computed(() => ({
  'pending-log': forecastStore.countOf('pending-log'),
  'pending-explain': forecastStore.countOf('pending-explain'),
  matched: forecastStore.countOf('matched'),
  closed: forecastStore.countOf('closed'),
}));

function statusOf(row: Row): ReconcileStatus {
  return row.rec?.status ?? 'pending-log';
}

/* ---------- 预报录入 ---------- */

const dialogVisible = ref(false);
const formError = ref('');
const form = reactive({
  forecastNo: '',
  mileageStart: 12486,
  mileageEnd: 12489,
  grade: 'Ⅲ' as RockGrade,
  water: '潮湿' as Groundwater,
  method: 'TSP',
  forecaster: '超前地质预报组',
});

function openDialog() {
  dialogVisible.value = true;
  formError.value = '';
}

async function submit() {
  formError.value = '';
  const forecastNo = form.forecastNo.trim();
  if (!forecastNo) {
    formError.value = '预报编号必填';
    return;
  }
  if (form.mileageEnd < form.mileageStart) {
    formError.value = '预报里程段终点不能小于起点';
    return;
  }
  const result = await forecastStore.addForecast({ ...form, forecastNo });
  if (result.duplicated) {
    formError.value = `预报编号 ${forecastNo} 已录入，同一份预报不重复记账`;
    ElMessage.warning(formError.value);
    return;
  }
  dialogVisible.value = false;
  const rec = forecastStore.reconcileOf(result.forecast.id);
  const face = rec?.faceId ? faceStore.byId(rec.faceId) : undefined;
  const tips: Record<ReconcileStatus, string> = {
    'pending-log': '暂无对应编录，已列入待编录',
    matched: `已认领 ${face?.faceNo ?? ''}，比对一致`,
    'pending-explain': `已认领 ${face?.faceNo ?? ''}，存在偏差，列入待说明`,
    closed: '',
  };
  ElMessage.success(`预报 ${forecastNo} 已录入：${tips[rec?.status ?? 'pending-log']}`);
  form.forecastNo = '';
}

/* ---------- 待说明收口 ---------- */

const closeVisible = ref(false);
const closeTarget = ref<Row | null>(null);
const closeReason = ref('');

function openClose(row: Row) {
  closeTarget.value = row;
  closeReason.value = '';
  closeVisible.value = true;
}

async function submitClose() {
  const rec = closeTarget.value?.rec;
  if (!rec) return;
  if (!closeReason.value.trim()) {
    ElMessage.error('请写清原因说明才能收口');
    return;
  }
  await forecastStore.closeReconcile(rec.id, closeReason.value);
  closeVisible.value = false;
  ElMessage.success('已写清原因并收口');
}

/* ---------- 删除 ---------- */

async function remove(row: Row) {
  await ElMessageBox.confirm(
    `删除预报「${row.forecast.forecastNo}」及其对账记录？`,
    '删除确认',
    { type: 'warning' },
  );
  await forecastStore.removeForecast(row.forecast.id);
  ElMessage.success('已删除');
}

onMounted(async () => {
  await faceStore.load();
  await forecastStore.load();
});
</script>

<template>
  <div class="page">
    <div class="header">
      <h2>超前预报 · 编录对账</h2>
      <el-tag type="info" effect="plain">待编录 {{ counts['pending-log'] }}</el-tag>
      <el-tag type="danger" effect="plain">待说明 {{ counts['pending-explain'] }}</el-tag>
      <el-tag type="success" effect="plain">一致 {{ counts.matched }}</el-tag>
      <el-tag type="warning" effect="plain">已收口 {{ counts.closed }}</el-tag>
      <div class="spacer" />
      <el-button type="primary" @click="openDialog">录入预报成果</el-button>
    </div>

    <el-alert
      type="info"
      :closable="false"
      show-icon
      title="预报录入后按编号和里程段自动认领对应编录；围岩级别差两级以上或涌水对不上的列入待说明，写清原因才算收口。编录的岩性、里程或围岩判定更新后，已收口的对账会自动重算并退回待说明。"
    />

    <el-card shadow="never">
      <el-table :data="rows" size="small" border>
        <el-table-column label="预报编号" width="130" fixed>
          <template #default="{ row }">
            <strong>{{ row.forecast.forecastNo }}</strong>
            <div class="muted">{{ row.forecast.method }}</div>
          </template>
        </el-table-column>
        <el-table-column label="预报里程段" width="160">
          <template #default="{ row }">
            {{ formatChainage(row.forecast.mileageStart) }} ~ {{ formatChainage(row.forecast.mileageEnd) }}
          </template>
        </el-table-column>
        <el-table-column label="预报级别" width="90" align="center">
          <template #default="{ row }"><GradeTag :grade="row.forecast.grade" /></template>
        </el-table-column>
        <el-table-column label="预报涌水" width="110">
          <template #default="{ row }">{{ row.forecast.water }}</template>
        </el-table-column>
        <el-table-column label="认领编录" width="150">
          <template #default="{ row }">
            <template v-if="row.face">
              <el-link type="primary" :underline="false" @click="router.push(`/faces/${row.face.id}`)">
                {{ row.face.faceNo }}
              </el-link>
              <div class="muted">
                {{ formatChainage(row.face.mileageRange[0]) }} ~ {{ formatChainage(row.face.mileageRange[1]) }}
              </div>
            </template>
            <span v-else class="muted">待编录</span>
          </template>
        </el-table-column>
        <el-table-column label="编录级别" width="90" align="center">
          <template #default="{ row }">
            <GradeTag v-if="row.rec?.actualGrade" :grade="row.rec.actualGrade" />
            <span v-else class="muted">—</span>
          </template>
        </el-table-column>
        <el-table-column label="编录涌水" width="110">
          <template #default="{ row }">{{ row.rec?.actualWater ?? '—' }}</template>
        </el-table-column>
        <el-table-column label="比对结果" min-width="240">
          <template #default="{ row }">
            <template v-if="row.rec && row.rec.issues.length > 0">
              <div v-for="(issue, i) in row.rec.issues" :key="i" class="issue">{{ issue }}</div>
            </template>
            <span v-else class="ok">级别、涌水均吻合</span>
          </template>
        </el-table-column>
        <el-table-column label="状态" width="90" align="center">
          <template #default="{ row }">
            <el-tag :type="STATUS_TAG_TYPE[statusOf(row)]" size="small">
              {{ RECONCILE_STATUS_TEXT[statusOf(row)] }}
            </el-tag>
            <el-tooltip
              v-if="row.rec && row.rec.retractedCount > 0 && statusOf(row) === 'pending-explain'"
              :content="`${row.rec.retractCause}${row.rec.lastReason ? `；上次说明：${row.rec.lastReason}` : ''}`"
              placement="top"
            >
              <div class="retract">已退回 {{ row.rec.retractedCount }} 次</div>
            </el-tooltip>
          </template>
        </el-table-column>
        <el-table-column label="说明" min-width="200">
          <template #default="{ row }">
            <template v-if="row.rec && statusOf(row) === 'closed'">
              <div>{{ row.rec.reason }}</div>
              <div class="muted">收口于 {{ row.rec.closedAt ? new Date(row.rec.closedAt).toLocaleString('zh-CN') : '—' }}</div>
            </template>
            <span v-else-if="statusOf(row) === 'pending-explain'" class="muted">待填写原因说明</span>
            <span v-else class="muted">—</span>
          </template>
        </el-table-column>
        <el-table-column label="操作" width="150" fixed="right">
          <template #default="{ row }">
            <el-button
              v-if="statusOf(row) === 'pending-explain'"
              type="danger"
              size="small"
              @click="openClose(row)"
            >
              填写说明并收口
            </el-button>
            <el-button type="danger" plain size="small" @click="remove(row)">删除</el-button>
          </template>
        </el-table-column>
      </el-table>
      <el-empty v-if="rows.length === 0" description="尚无预报成果，点击右上角录入" :image-size="60" />
    </el-card>

    <el-dialog v-model="dialogVisible" title="录入超前地质预报成果" width="560px">
      <el-alert v-if="formError" :title="formError" type="error" :closable="false" style="margin-bottom: 10px" />
      <el-form :model="form" label-width="120px">
        <el-form-item label="预报编号" required>
          <el-input v-model="form.forecastNo" placeholder="如 YB-2026-044" />
        </el-form-item>
        <el-form-item label="预报里程段 m" required>
          <el-input-number v-model="form.mileageStart" :min="0" :max="999999" />
          <span style="margin: 0 6px">—</span>
          <el-input-number v-model="form.mileageEnd" :min="0" :max="999999" />
          <div class="hint">{{ formatChainage(form.mileageStart) }} ~ {{ formatChainage(form.mileageEnd) }}</div>
        </el-form-item>
        <el-form-item label="预报围岩级别">
          <el-radio-group v-model="form.grade">
            <el-radio-button v-for="g in ROCK_GRADES" :key="g" :value="g">{{ g }}</el-radio-button>
          </el-radio-group>
        </el-form-item>
        <el-form-item label="预报涌水">
          <el-select v-model="form.water" style="width: 200px">
            <el-option v-for="w in GROUNDWATERS" :key="w" :label="w" :value="w" />
          </el-select>
        </el-form-item>
        <el-form-item label="预报方法">
          <el-select v-model="form.method" style="width: 200px" allow-create filterable>
            <el-option v-for="m in FORECAST_METHODS" :key="m" :label="m" :value="m" />
          </el-select>
        </el-form-item>
        <el-form-item label="预报人 / 单位">
          <el-input v-model="form.forecaster" style="width: 240px" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="dialogVisible = false">取消</el-button>
        <el-button type="primary" @click="submit">保存并认领对账</el-button>
      </template>
    </el-dialog>

    <el-dialog v-model="closeVisible" title="填写说明并收口" width="520px">
      <template v-if="closeTarget?.rec">
        <el-alert type="warning" :closable="false" show-icon title="该预报与编录存在以下偏差：" style="margin-bottom: 10px" />
        <ul class="issue-list">
          <li v-for="(issue, i) in closeTarget.rec.issues" :key="i">{{ issue }}</li>
        </ul>
        <p v-if="closeTarget.rec.retractedCount > 0" class="muted">
          {{ closeTarget.rec.retractCause }}<template v-if="closeTarget.rec.lastReason">；上次说明：{{ closeTarget.rec.lastReason }}</template>
        </p>
        <el-input
          v-model="closeReason"
          type="textarea"
          :rows="4"
          placeholder="写清偏差原因，如：预报段局部穿越断层破碎带，编录揭露围岩较预报偏差，已加强支护并复核参数"
        />
      </template>
      <template #footer>
        <el-button @click="closeVisible = false">取消</el-button>
        <el-button type="primary" @click="submitClose">确认收口</el-button>
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
.muted {
  color: #97a0ad;
  font-size: 12px;
}
.issue {
  color: #c45656;
  font-size: 13px;
  line-height: 1.7;
}
.ok {
  color: #2f8f5b;
  font-size: 13px;
}
.retract {
  color: #b88230;
  font-size: 12px;
  margin-top: 4px;
  cursor: default;
}
.issue-list {
  margin: 0 0 10px;
  padding-left: 18px;
  color: #c45656;
  font-size: 13px;
  line-height: 1.9;
}
.hint {
  width: 100%;
  color: #97a0ad;
  font-size: 12px;
}
</style>
