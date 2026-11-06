<script setup lang="ts">
import { onShow } from '@dcloudio/uni-app'
import { computed, ref } from 'vue'
import EmptyState from '../../components/EmptyState.vue'
import RecordCard from '../../components/RecordCard.vue'
import { getCalendar } from '../../api/queries'
import { listRecords } from '../../api/records'
import type { RecordView } from '../../api/types'
import { useAuthStore } from '../../stores/auth'
import {
  calendarCells,
  calendarCountMap,
  monthOf,
  monthTitle,
  shiftMonth,
  todayLocal,
} from '../../utils/date'

const auth = useAuthStore()
const today = todayLocal()
const currentMonth = ref(monthOf(today))
const selectedDate = ref(today)
const dayCounts = ref<Record<string, number>>({})
const records = ref<RecordView[]>([])
const nextCursor = ref<string | null>(null)
const monthLoading = ref(false)
const recordsLoading = ref(false)
const recordsLoadingMore = ref(false)
const monthError = ref<string | null>(null)
const recordsError = ref<string | null>(null)
let monthRequestVersion = 0
let recordsRequestVersion = 0
let initialized = false

const cells = computed(() => calendarCells(currentMonth.value))
const title = computed(() => monthTitle(currentMonth.value))
const isInitialRecordsLoading = computed(
  () => recordsLoading.value && records.value.length === 0,
)

onShow(async () => {
  await auth.ensureSession()
  if (auth.baseMessage) {
    monthError.value = auth.baseMessage
    return
  }

  if (!initialized) {
    initialized = true
    currentMonth.value = monthOf(today)
    selectedDate.value = today
  }
  await loadMonth(currentMonth.value, selectedDate.value)
})

function messageOf(value: unknown): string {
  return value instanceof Error && value.message ? value.message : '加载失败'
}

async function loadMonth(month: string, selected: string): Promise<void> {
  const version = ++monthRequestVersion
  monthLoading.value = true
  monthError.value = null
  currentMonth.value = month
  selectedDate.value = selected

  try {
    const [calendar] = await Promise.all([
      getCalendar(month),
      loadDay(selected, false),
    ])
    if (version !== monthRequestVersion) return
    dayCounts.value = calendarCountMap(calendar.days)
  } catch (error) {
    if (version !== monthRequestVersion) return
    monthError.value = messageOf(error)
  } finally {
    if (version === monthRequestVersion) monthLoading.value = false
  }
}

function changeMonth(delta: number): void {
  const nextMonth = shiftMonth(currentMonth.value, delta)
  void loadMonth(nextMonth, `${nextMonth}-01`)
}

function selectDay(date: string): void {
  if (monthOf(date) !== currentMonth.value) {
    void loadMonth(monthOf(date), date)
    return
  }
  selectedDate.value = date
  void loadDay(date, true)
}

async function loadDay(date: string, clearImmediately: boolean): Promise<void> {
  const version = ++recordsRequestVersion
  if (clearImmediately) {
    records.value = []
    nextCursor.value = null
  }
  recordsLoading.value = true
  recordsError.value = null

  try {
    const page = await listRecords({ date, limit: 20 })
    if (version !== recordsRequestVersion) return
    records.value = page.items
    nextCursor.value = page.nextCursor
  } catch (error) {
    if (version !== recordsRequestVersion) return
    recordsError.value = messageOf(error)
  } finally {
    if (version === recordsRequestVersion) recordsLoading.value = false
  }
}

async function loadMoreRecords(): Promise<void> {
  if (recordsLoading.value || recordsLoadingMore.value || !nextCursor.value) return
  const version = recordsRequestVersion
  recordsLoadingMore.value = true
  recordsError.value = null

  try {
    const page = await listRecords({
      date: selectedDate.value,
      cursor: nextCursor.value,
      limit: 20,
    })
    if (version !== recordsRequestVersion) return
    const existingIds = new Set(records.value.map((record) => record.id))
    records.value.push(...page.items.filter((record) => !existingIds.has(record.id)))
    nextCursor.value = page.nextCursor
  } catch (error) {
    if (version === recordsRequestVersion) recordsError.value = messageOf(error)
  } finally {
    if (version === recordsRequestVersion) recordsLoadingMore.value = false
  }
}

function retry(): void {
  void loadMonth(currentMonth.value, selectedDate.value)
}
</script>

<template>
  <view class="calendar-page">
    <scroll-view class="page-scroll" scroll-y lower-threshold="80" @scrolltolower="loadMoreRecords">
      <view class="month-panel">
        <view class="month-header">
          <button class="month-switch" aria-label="上个月" @click="changeMonth(-1)">‹</button>
          <text class="month-title">{{ title }}</text>
          <button class="month-switch" aria-label="下个月" @click="changeMonth(1)">›</button>
        </view>

        <view class="weekday-row">
          <text v-for="weekday in ['日', '一', '二', '三', '四', '五', '六']" :key="weekday">
            {{ weekday }}
          </text>
        </view>

        <view class="calendar-grid" :class="{ 'calendar-grid--loading': monthLoading }">
          <view
            v-for="cell in cells"
            :key="cell.date"
            class="calendar-cell"
            :class="{
              'calendar-cell--outside': !cell.inMonth,
              'calendar-cell--today': cell.date === today,
              'calendar-cell--selected': cell.date === selectedDate,
            }"
            @click="selectDay(cell.date)"
          >
            <text class="calendar-cell__day">{{ Number(cell.date.slice(-2)) }}</text>
            <view v-if="dayCounts[cell.date]" class="calendar-cell__dot" />
          </view>
        </view>

        <view v-if="monthError" class="month-error">
          <text>{{ monthError }}</text>
          <text class="month-error__retry" @click="retry">重试</text>
        </view>
      </view>

      <view class="selected-header">
        <text class="selected-header__title">{{ selectedDate }}</text>
        <text class="selected-header__count">当天记录</text>
      </view>

      <view v-if="isInitialRecordsLoading" class="list-state">
        <text>正在加载…</text>
      </view>

      <view v-else-if="recordsError" class="list-state">
        <text class="list-state__error">{{ recordsError }}</text>
        <button class="list-state__retry" @click="loadDay(selectedDate, true)">重试</button>
      </view>

      <EmptyState
        v-else-if="records.length === 0"
        text="这一天还没有记录"
      />

      <template v-else>
        <RecordCard v-for="record in records" :key="record.id" :record="record" />
        <view v-if="recordsLoadingMore" class="loading-more">
          <text>正在加载更多…</text>
        </view>
        <view v-else-if="!nextCursor" class="list-end">
          <text>已经到底了</text>
        </view>
      </template>

      <view class="safe-area" />
    </scroll-view>
  </view>
</template>

<style scoped>
.calendar-page {
  height: 100vh;
  background: var(--color-bg);
}

.page-scroll {
  height: 100vh;
}

.month-panel {
  margin: 20rpx 24rpx;
  padding: 24rpx 18rpx 26rpx;
  border-radius: 24rpx;
  background: #ffffff;
  box-shadow: 0 6rpx 24rpx rgba(0, 0, 0, 0.05);
}

.month-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 10rpx 18rpx;
}

.month-title {
  color: var(--color-text);
  font-size: 34rpx;
  font-weight: 600;
}

.month-switch {
  width: 68rpx;
  height: 68rpx;
  margin: 0;
  padding: 0;
  border-radius: 34rpx;
  background: #f3f3f3;
  color: #555555;
  font-size: 42rpx;
  line-height: 64rpx;
}

.weekday-row,
.calendar-grid {
  display: grid;
  grid-template-columns: repeat(7, 1fr);
}

.weekday-row {
  padding-bottom: 10rpx;
  color: var(--color-muted);
  font-size: 22rpx;
  text-align: center;
}

.calendar-grid {
  row-gap: 8rpx;
  transition: opacity 0.2s;
}

.calendar-grid--loading {
  opacity: 0.55;
}

.calendar-cell {
  position: relative;
  display: flex;
  height: 82rpx;
  align-items: center;
  justify-content: center;
  border: 2rpx solid transparent;
  border-radius: 18rpx;
  color: var(--color-text);
  font-size: 26rpx;
}

.calendar-cell--outside {
  color: #cccccc;
}

.calendar-cell--today {
  border-color: var(--color-primary);
}

.calendar-cell--selected {
  border-color: var(--color-primary);
  background: var(--color-primary);
  color: #ffffff;
}

.calendar-cell__dot {
  position: absolute;
  bottom: 8rpx;
  width: 8rpx;
  height: 8rpx;
  border-radius: 4rpx;
  background: var(--color-primary);
}

.calendar-cell--selected .calendar-cell__dot {
  background: #ffffff;
}

.month-error {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 16rpx;
  padding-top: 18rpx;
  color: #d94b4b;
  font-size: 23rpx;
}

.month-error__retry {
  color: var(--color-primary);
}

.selected-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8rpx 30rpx;
}

.selected-header__title {
  color: var(--color-text);
  font-size: 30rpx;
  font-weight: 600;
}

.selected-header__count {
  color: var(--color-muted);
  font-size: 23rpx;
}

.list-state {
  display: flex;
  min-height: 280rpx;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 18rpx;
  color: var(--color-muted);
  text-align: center;
}

.list-state__error {
  color: #d94b4b;
  font-size: 24rpx;
}

.list-state__retry {
  padding: 0 36rpx;
  border-radius: 32rpx;
  background: var(--color-primary);
  color: #ffffff;
  font-size: 24rpx;
  line-height: 64rpx;
}

.loading-more,
.list-end {
  padding: 26rpx;
  color: var(--color-muted);
  font-size: 23rpx;
  text-align: center;
}

.safe-area {
  height: calc(40rpx + env(safe-area-inset-bottom));
}
</style>