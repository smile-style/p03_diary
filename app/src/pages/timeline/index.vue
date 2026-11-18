<script setup lang="ts">
import { onShow } from '@dcloudio/uni-app'
import { computed, ref } from 'vue'
import { getRecordDays } from '../../api/queries'
import type { RecordDayCount, RecordFilter } from '../../api/types'
import AppIcon from '../../components/AppIcon.vue'
import AppShell from '../../components/AppShell.vue'
import DayAxis from '../../components/DayAxis.vue'
import EmptyState from '../../components/EmptyState.vue'
import RecordCard from '../../components/RecordCard.vue'
import { useAuthStore } from '../../stores/auth'
import { useTimelineStore } from '../../stores/timeline'
import { formatFullDateLabel } from '../../utils/date'
import { parseSearchInput } from '../../utils/search'

const auth = useAuthStore()
const timeline = useTimelineStore()
const searchText = ref('')
const days = ref<RecordDayCount[]>([])
const selectedDate = ref<string | null>(null)
const activeSearch = ref<{ tag?: string; q?: string } | null>(null)

const isInitialLoading = computed(
  () => timeline.loading && timeline.items.length === 0,
)
const scopeTitle = computed(() => {
  if (activeSearch.value) return '搜索结果'
  if (selectedDate.value) return formatFullDateLabel(selectedDate.value)
  return '还没有记录'
})
const scopeCount = computed(() => {
  if (activeSearch.value || !selectedDate.value) return ''
  const found = days.value.find((item) => item.date === selectedDate.value)
  return found ? `${found.count} 条` : ''
})

// 当前生效的筛选条件：搜索优先，其次选中日期；都没有就不过滤
function currentFilter(): RecordFilter {
  if (activeSearch.value) return { ...activeSearch.value }
  if (selectedDate.value) return { date: selectedDate.value }
  return {}
}

onShow(async () => {
  await auth.ensureSession()
  if (auth.baseMessage) return
  await loadDays()
  await timeline.reset(currentFilter())
})

async function loadDays(): Promise<void> {
  try {
    const result = await getRecordDays()
    days.value = result.items
  } catch {
    days.value = []
  }
  // 选中的那天已经没有任何记录时，退回最近有记录的一天
  if (
    selectedDate.value &&
    !days.value.some((item) => item.date === selectedDate.value)
  ) {
    selectedDate.value = null
  }
  if (!activeSearch.value && !selectedDate.value && days.value.length > 0) {
    selectedDate.value = days.value[0]!.date
  }
}

async function selectDay(date: string): Promise<void> {
  activeSearch.value = null
  searchText.value = ''
  selectedDate.value = date
  await timeline.reset({ date })
}

async function submitSearch(): Promise<void> {
  const parsed = parseSearchInput(searchText.value)
  activeSearch.value = Object.keys(parsed).length > 0 ? parsed : null
  if (activeSearch.value) {
    selectedDate.value = null
  } else if (!selectedDate.value && days.value.length > 0) {
    selectedDate.value = days.value[0]!.date
  }
  await timeline.reset(currentFilter())
}

async function clearSearch(): Promise<void> {
  searchText.value = ''
  activeSearch.value = null
  await loadDays()
  await timeline.reset(currentFilter())
}

function retryLoad(): void {
  void timeline.reset(currentFilter())
}

function retryLogin() {
  auth.logout()
  void auth.ensureSession()
}

function createRecord() {
  uni.navigateTo({ url: '/pages/record/edit' })
}
</script>

<template>
  <AppShell
    active="timeline"
    title="时间线"
    eyebrow="生活记录"
    description="把散落的日常按时间摊开，留下值得回看的片段。"
  >
    <template #actions>
      <button class="app-button app-button--primary" @click="createRecord">
        <AppIcon name="plus" />
        写一条
      </button>
    </template>

    <view v-if="!auth.ready" class="page-state">
      <text class="page-state__title">正在打开你的记录</text>
      <text class="page-state__message">稍等一下，本机数据正在准备。</text>
    </view>

    <view v-else-if="auth.baseMessage" class="page-state">
      <text class="page-state__title">登录没有完成</text>
      <text class="page-state__error">{{ auth.baseMessage }}</text>
      <button class="app-button app-button--primary" @click="retryLogin">重试</button>
    </view>

    <scroll-view
      v-else
      class="page-scroll"
      scroll-y
      lower-threshold="80"
      @scrolltolower="timeline.loadMore"
    >
      <view class="timeline-inner">
        <view class="timeline-toolbar">
          <view class="search-field">
            <AppIcon class="search-field__icon" name="search" />
            <input
              v-model="searchText"
              class="search-field__input"
              confirm-type="search"
              placeholder="搜索记录，或输入 #标签"
              @confirm="submitSearch"
            />
            <button
              v-if="searchText"
              class="search-field__clear"
              aria-label="清除搜索"
              @click="clearSearch"
            >
              <AppIcon name="close" />
            </button>
          </view>
          <view class="scope-indicator">
            <text class="scope-indicator__label">正在看</text>
            <text class="scope-indicator__value">{{ scopeTitle }}</text>
          </view>
        </view>

        <DayAxis
          v-if="days.length > 0"
          class="timeline-days"
          :items="days"
          :selected="selectedDate"
          @select="selectDay"
        />

        <view v-if="days.length > 0 || activeSearch" class="day-summary">
          <text class="day-summary__title">{{ scopeTitle }}</text>
          <text v-if="scopeCount" class="day-summary__count">{{ scopeCount }}</text>
        </view>

        <view v-if="isInitialLoading" class="page-state">
          <text class="page-state__title">正在翻阅</text>
          <text class="page-state__message">记录马上就来。</text>
        </view>

        <view v-else-if="timeline.error" class="page-state">
          <text class="page-state__title">这次没有翻到</text>
          <text class="page-state__error">{{ timeline.error }}</text>
          <button class="app-button app-button--primary" @click="retryLoad">重试</button>
        </view>

        <EmptyState
          v-else-if="timeline.items.length === 0"
          title="还没有留下记录"
          text="写下第一条，让今天从一张空白纸变成可以回看的日子。"
        />

        <view v-else class="day-records">
          <RecordCard
            v-for="record in timeline.items"
            :key="record.id"
            :record="record"
            :show-date="activeSearch !== null"
          />
          <view v-if="timeline.loading" class="loading-more"><text>正在继续翻阅…</text></view>
          <view v-else-if="!timeline.nextCursor" class="list-end"><text>已经翻到最早的一页</text></view>
        </view>
      </view>
    </scroll-view>
  </AppShell>
</template>

<style scoped>
.timeline-inner {
  width: 100%;
  max-width: 960px;
  margin: 0 auto;
  padding: 28px 40px 56px;
}

.timeline-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 18px;
  margin-bottom: 18px;
}

.search-field {
  display: flex;
  min-height: 48px;
  flex: 1;
  align-items: center;
  gap: 11px;
  padding: 0 15px;
  border: 1px solid var(--color-border);
  border-radius: 14px;
  background: var(--color-surface);
  box-shadow: 0 7px 22px rgba(61, 47, 35, 0.035);
}

.search-field:focus-within {
  border-color: color-mix(in srgb, var(--color-accent) 52%, var(--color-border));
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--color-accent) 9%, transparent);
}

.search-field__icon {
  width: 17px;
  height: 17px;
  color: var(--color-muted);
}

.search-field__input {
  min-width: 0;
  height: 46px;
  flex: 1;
  color: var(--color-text);
  font-size: 13px;
}

.search-field__clear {
  position: relative;
  display: flex;
  width: 32px;
  height: 32px;
  align-items: center;
  justify-content: center;
  margin: 0;
  padding: 0;
  border: 0;
  border-radius: 50%;
  background: var(--color-surface-muted);
  color: var(--color-muted);
}

.search-field__clear::after {
  position: absolute;
  inset: -6px;
  content: '';
}

.search-field__clear:hover {
  color: var(--color-ink);
}

.search-field__clear .app-icon {
  width: 14px;
  height: 14px;
}

.scope-indicator {
  display: none;
  flex: none;
  padding: 0 4px;
  text-align: right;
}

.scope-indicator__label {
  display: block;
  color: var(--color-muted);
  font-size: 9px;
  letter-spacing: 0.12em;
}

.scope-indicator__value {
  display: block;
  margin-top: 2px;
  color: var(--color-ink);
  font-family: var(--font-display);
  font-size: 16px;
  font-weight: 700;
}

.timeline-days {
  margin-bottom: 22px;
}

.day-summary {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 16px;
  margin-bottom: 14px;
  padding: 0 3px 12px;
  border-bottom: 1px solid var(--color-border);
}

.day-summary__title {
  color: var(--color-ink);
  font-family: var(--font-display);
  font-size: 22px;
  font-weight: 700;
  letter-spacing: 0.02em;
}

.day-summary__count {
  color: var(--color-muted);
  font-size: 11px;
  letter-spacing: 0.08em;
}

.day-records {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

@media (min-width: 760px) {
  .scope-indicator {
    display: block;
  }
}

@media (max-width: 980px) {
  .timeline-inner {
    padding-right: 28px;
    padding-left: 28px;
  }
}

@media (max-width: 699px) {
  .timeline-inner {
    padding: 18px 16px 38px;
  }

  .timeline-toolbar {
    gap: 10px;
  }

  .search-field {
    min-height: 44px;
  }

  .timeline-days {
    margin-bottom: 22px;
  }
}
</style>
