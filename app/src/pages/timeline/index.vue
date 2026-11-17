<script setup lang="ts">
import { onShow } from '@dcloudio/uni-app'
import { computed, ref } from 'vue'
import { getYearMonths, getYears } from '../../api/queries'
import type { RecordFilter } from '../../api/types'
import AppIcon from '../../components/AppIcon.vue'
import AppShell from '../../components/AppShell.vue'
import EmptyState from '../../components/EmptyState.vue'
import RecordCard from '../../components/RecordCard.vue'
import YearAxis from '../../components/YearAxis.vue'
import { useAuthStore } from '../../stores/auth'
import { useTimelineStore } from '../../stores/timeline'
import { parseSearchInput } from '../../utils/search'
import { groupByMonth } from '../../utils/timeline-groups'

const auth = useAuthStore()
const timeline = useTimelineStore()
const searchText = ref('')
const years = ref<{ year: string; count: number }[]>([])
const selectedYear = ref<string | null>(null)
const activeMonth = ref<string | null>(null)
const months = ref<{ month: string; count: number }[]>([])

const isInitialLoading = computed(
  () => timeline.loading && timeline.items.length === 0,
)
const groups = computed(() => groupByMonth(timeline.items))
const scopeLabel = computed(() => {
  if (activeMonth.value) return activeMonth.value.replace('-', ' 年 ') + ' 月'
  if (selectedYear.value) return selectedYear.value + ' 年'
  return '全部年份'
})

onShow(async () => {
  await auth.ensureSession()
  if (auth.baseMessage) return
  await loadYears()
  await timeline.reset(currentFilter())
})

async function loadYears(): Promise<void> {
  try {
    const result = await getYears()
    years.value = result.items
    if (!selectedYear.value && result.items.length > 0) {
      selectedYear.value = result.items[0]!.year
    }
  } catch {
    years.value = []
  }
  await loadMonths()
}

async function loadMonths(): Promise<void> {
  if (!selectedYear.value) {
    months.value = []
    return
  }
  try {
    const result = await getYearMonths(selectedYear.value)
    months.value = result.items
  } catch {
    months.value = []
  }
}

// 当前生效的筛选条件。date / month / year 三者只取一个，后端也是这个优先级。
function currentFilter(): RecordFilter {
  const filter = { ...timeline.filter }
  if (activeMonth.value) {
    return { ...filter, month: activeMonth.value, year: undefined, date: undefined }
  }
  if (selectedYear.value) {
    return { ...filter, year: selectedYear.value, month: undefined, date: undefined }
  }
  return { ...filter, year: undefined, month: undefined, date: undefined }
}

// 传 null 表示「全部年份」
async function selectYear(year: string | null): Promise<void> {
  selectedYear.value = year
  activeMonth.value = null
  await loadMonths()
  await timeline.reset(currentFilter())
}

async function toggleMonth(month: string): Promise<void> {
  if (!selectedYear.value) return
  // 点同一个月标题再次取消筛选
  if (activeMonth.value === month) {
    activeMonth.value = null
    await timeline.reset({ ...currentFilterNoMonth() })
    return
  }
  activeMonth.value = month
  await timeline.reset({
    ...timeline.filter,
    month,
    year: undefined,
    date: undefined,
  })
}

function currentFilterNoMonth(): RecordFilter {
  const filter = { ...timeline.filter }
  delete filter.month
  delete filter.date
  if (selectedYear.value) filter.year = selectedYear.value
  return filter
}

// 月份标题上的条数来自服务端聚合，不是已加载条数
function monthCount(month: string): number {
  return months.value.find((item) => item.month === month)?.count ?? 0
}

function submitSearch() {
  const parsed = parseSearchInput(searchText.value)
  void timeline.reset({ ...parsed, ...currentFilter() })
}

function clearSearch() {
  searchText.value = ''
  void timeline.reset(currentFilter())
}

function retryLogin() {
  auth.logout()
  void auth.ensureSession()
}

function retryLoad() {
  void timeline.reset(currentFilter())
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
            <text class="scope-indicator__value">{{ scopeLabel }}</text>
          </view>
        </view>

        <YearAxis
          class="timeline-years"
          :items="years"
          :selected="selectedYear"
          @select="selectYear"
        />

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

        <view v-else class="timeline-groups">
          <section v-for="group in groups" :key="group.month" class="month-group">
            <button
              class="month-group__header"
              :class="{ 'month-group__header--active': activeMonth === group.month }"
              :disabled="!selectedYear"
              @click="toggleMonth(group.month)"
            >
              <view>
                <text class="month-group__title">{{ group.label }}</text>
                <text class="month-group__hint">
                  {{ activeMonth === group.month ? '当前只看这个月，再次点击返回全年' : selectedYear ? '点击只看这个月' : '浏览全部年份' }}
                </text>
              </view>
              <view class="month-group__meta">
                <text
                  v-if="selectedYear && !activeMonth"
                  class="month-group__count"
                >{{ monthCount(group.month) }} 条</text>
                <AppIcon
                  v-if="selectedYear"
                  class="month-group__arrow"
                  :name="activeMonth === group.month ? 'close' : 'chevron-right'"
                />
              </view>
            </button>

            <view class="month-group__records">
              <RecordCard
                v-for="record in group.records"
                :key="record.id"
                :record="record"
              />
            </view>
          </section>

          <view v-if="timeline.loading" class="loading-more">
            <text>正在继续翻阅…</text>
          </view>
          <view v-else-if="!timeline.nextCursor" class="list-end">
            <text>已经翻到最早的一页</text>
          </view>
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

.timeline-years {
  margin-bottom: 28px;
}

.timeline-groups {
  display: flex;
  flex-direction: column;
  gap: 30px;
}

.month-group + .month-group {
  padding-top: 4px;
}

.month-group__header {
  display: flex;
  width: 100%;
  min-height: 58px;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  margin: 0 0 11px;
  padding: 8px 3px 10px;
  border: 0;
  border-bottom: 1px solid var(--color-border);
  border-radius: 0;
  background: transparent;
  color: var(--color-text);
  text-align: left;
}

.month-group__header:disabled {
  opacity: 1;
}

.month-group__header:not(:disabled):hover .month-group__title {
  color: var(--color-accent);
}

.month-group__header--active {
  border-bottom-color: var(--color-accent);
}

.month-group__title {
  display: block;
  color: var(--color-ink);
  font-family: var(--font-display);
  font-size: 22px;
  font-weight: 700;
  letter-spacing: 0.02em;
}

.month-group__hint {
  display: block;
  margin-top: 4px;
  color: var(--color-muted);
  font-size: 10px;
  letter-spacing: 0.04em;
}

.month-group__meta {
  display: flex;
  flex: none;
  align-items: center;
  gap: 10px;
  color: var(--color-muted);
}

.month-group__count {
  font-size: 11px;
  letter-spacing: 0.08em;
}

.month-group__arrow {
  width: 15px;
  height: 15px;
}

.month-group__records {
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

  .timeline-years {
    margin-bottom: 22px;
  }

  .month-group__header {
    min-height: 52px;
  }

  .month-group__title {
    font-size: 19px;
  }

  .month-group__records {
    gap: 10px;
  }
}
</style>
