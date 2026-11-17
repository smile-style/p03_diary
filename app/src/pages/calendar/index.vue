<script setup lang="ts">
import { onShow } from '@dcloudio/uni-app'
import { computed, ref } from 'vue'
import AppIcon from '../../components/AppIcon.vue'
import AppShell from '../../components/AppShell.vue'
import EmptyState from '../../components/EmptyState.vue'
import RecordCard from '../../components/RecordCard.vue'
import { getCalendar } from '../../api/queries'
import { listRecords } from '../../api/records'
import type { RecordView } from '../../api/types'
import { useAuthStore } from '../../stores/auth'
import {
  calendarCells,
  calendarCountMap,
  formatDateLabel,
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
const selectedDateLabel = computed(() => formatDateLabel(selectedDate.value))
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
  void loadMonth(nextMonth, nextMonth + '-01')
}

function goToday(): void {
  void loadMonth(monthOf(today), today)
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
  <AppShell
    active="calendar"
    title="日历"
    eyebrow="按月翻阅"
    description="从一个月里挑一天，看看那天留下了什么。"
  >
    <template #actions>
      <button class="app-button" @click="goToday">
        <AppIcon name="calendar" />
        今天
      </button>
    </template>

    <scroll-view
      class="page-scroll"
      scroll-y
      lower-threshold="80"
      @scrolltolower="loadMoreRecords"
    >
      <view class="calendar-inner">
        <view class="calendar-heading">
          <view>
            <text class="calendar-heading__month">{{ title }}</text>
            <text class="calendar-heading__hint">有记录的日子会留下一个暖色圆点</text>
          </view>
          <view class="month-switch">
            <button
              class="icon-button month-switch__button"
              aria-label="上个月"
              @click="changeMonth(-1)"
            >
              <AppIcon name="chevron-left" />
            </button>
            <button
              class="icon-button month-switch__button"
              aria-label="下个月"
              @click="changeMonth(1)"
            >
              <AppIcon name="chevron-right" />
            </button>
          </view>
        </view>

        <view class="calendar-layout">
          <view class="calendar-card" :class="{ 'calendar-card--loading': monthLoading }">
            <view class="weekday-row" aria-hidden="true">
              <text v-for="weekday in ['日', '一', '二', '三', '四', '五', '六']" :key="weekday">
                {{ weekday }}
              </text>
            </view>

            <view class="calendar-grid">
              <button
                v-for="cell in cells"
                :key="cell.date"
                class="calendar-cell"
                :class="{
                  'calendar-cell--outside': !cell.inMonth,
                  'calendar-cell--today': cell.date === today,
                  'calendar-cell--selected': cell.date === selectedDate,
                  'calendar-cell--has-record': dayCounts[cell.date],
                }"
                :aria-label="cell.date + (dayCounts[cell.date] ? '，' + dayCounts[cell.date] + ' 条记录' : '')"
                @click="selectDay(cell.date)"
              >
                <text class="calendar-cell__day">{{ Number(cell.date.slice(-2)) }}</text>
                <view v-if="dayCounts[cell.date]" class="calendar-cell__dot" />
              </button>
            </view>

            <view class="calendar-legend">
              <view class="calendar-legend__item">
                <view class="calendar-legend__dot" />
                <text>有记录</text>
              </view>
              <view class="calendar-legend__item">
                <view class="calendar-legend__today" />
                <text>今天</text>
              </view>
            </view>

            <view v-if="monthError" class="calendar-error">
              <text>{{ monthError }}</text>
              <button class="app-button app-button--small" @click="retry">重试</button>
            </view>
          </view>

          <view class="day-panel">
            <view class="day-panel__header">
              <view>
                <text class="day-panel__eyebrow">所选日期</text>
                <text class="day-panel__title">{{ selectedDateLabel }}</text>
              </view>
              <text class="day-panel__count">
                {{ records.length ? records.length + ' 条' : '空' }}
              </text>
            </view>

            <view v-if="isInitialRecordsLoading" class="page-state day-panel__state">
              <text class="page-state__title">正在找这一天的记录</text>
            </view>

            <view v-else-if="recordsError" class="page-state day-panel__state">
              <text class="page-state__error">{{ recordsError }}</text>
              <button class="app-button app-button--small" @click="loadDay(selectedDate, true)">重试</button>
            </view>

            <EmptyState
              v-else-if="records.length === 0"
              title="这一天很安静"
              text="没有记录也没关系，空白也是日子的一部分。"
            />

            <template v-else>
              <view class="day-panel__records">
                <RecordCard
                  v-for="record in records"
                  :key="record.id"
                  :record="record"
                  :show-date="false"
                />
              </view>
              <view v-if="recordsLoadingMore" class="loading-more">
                <text>正在继续加载…</text>
              </view>
              <view v-else-if="!nextCursor" class="list-end">
                <text>这一天的记录都在这里</text>
              </view>
            </template>
          </view>
        </view>
      </view>
    </scroll-view>
  </AppShell>
</template>

<style scoped>
.calendar-inner {
  width: 100%;
  max-width: 1180px;
  margin: 0 auto;
  padding: 28px 42px 56px;
}

.calendar-heading {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 20px;
  margin-bottom: 18px;
}

.calendar-heading__month {
  display: block;
  color: var(--color-ink);
  font-family: var(--font-display);
  font-size: 25px;
  font-weight: 700;
  letter-spacing: 0.03em;
}

.calendar-heading__hint {
  display: block;
  margin-top: 5px;
  color: var(--color-muted);
  font-size: 11px;
}

.month-switch {
  display: flex;
  gap: 8px;
}

.month-switch__button {
  width: 42px;
  height: 42px;
}

.month-switch__button .app-icon {
  width: 16px;
  height: 16px;
}

.calendar-layout {
  display: grid;
  grid-template-columns: minmax(0, 1.2fr) minmax(280px, 0.8fr);
  align-items: start;
  gap: 22px;
}

.calendar-card,
.day-panel {
  border: 1px solid var(--color-border);
  border-radius: var(--radius-card);
  background: var(--color-surface);
  box-shadow: var(--shadow-card);
}

.calendar-card {
  padding: 22px 24px 18px;
  transition: opacity 180ms ease;
}

.calendar-card--loading {
  opacity: 0.68;
}

.weekday-row,
.calendar-grid {
  display: grid;
  grid-template-columns: repeat(7, minmax(0, 1fr));
}

.weekday-row {
  padding: 0 4px 10px;
  color: var(--color-muted);
  font-size: 10px;
  letter-spacing: 0.08em;
  text-align: center;
}

.calendar-grid {
  gap: 5px;
}

.calendar-cell {
  position: relative;
  display: flex;
  min-height: 54px;
  align-items: center;
  justify-content: center;
  margin: 0;
  padding: 0;
  border: 1px solid transparent;
  border-radius: 12px;
  background: transparent;
  color: var(--color-text);
  font-family: var(--font-display);
  font-size: 16px;
}

.calendar-cell:hover {
  border-color: var(--color-border);
  background: var(--color-surface-muted);
}

.calendar-cell--outside {
  color: color-mix(in srgb, var(--color-muted) 52%, transparent);
}

.calendar-cell--today {
  border-color: color-mix(in srgb, var(--color-accent) 46%, var(--color-border));
}

.calendar-cell--selected {
  border-color: var(--color-accent);
  background: var(--color-accent);
  color: var(--color-on-accent);
  box-shadow: 0 8px 18px rgba(154, 52, 18, 0.18);
}

.calendar-cell--selected:hover {
  border-color: var(--color-accent-hover);
  background: var(--color-accent-hover);
}

.calendar-cell__day {
  line-height: 1;
}

.calendar-cell__dot {
  position: absolute;
  bottom: 7px;
  width: 4px;
  height: 4px;
  border-radius: 50%;
  background: var(--color-star);
}

.calendar-cell--selected .calendar-cell__dot {
  background: var(--color-surface);
}

.calendar-legend {
  display: flex;
  gap: 18px;
  margin-top: 16px;
  padding-top: 14px;
  border-top: 1px solid var(--color-border);
  color: var(--color-muted);
  font-size: 10px;
}

.calendar-legend__item {
  display: flex;
  align-items: center;
  gap: 6px;
}

.calendar-legend__dot {
  width: 5px;
  height: 5px;
  border-radius: 50%;
  background: var(--color-star);
}

.calendar-legend__today {
  width: 12px;
  height: 12px;
  border: 1px solid var(--color-accent);
  border-radius: 50%;
}

.calendar-error {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 14px;
  margin-top: 12px;
  padding: 10px 12px;
  border-radius: 10px;
  background: var(--color-danger-soft);
  color: var(--color-danger);
  font-size: 11px;
}

.day-panel {
  min-height: 520px;
  padding: 22px;
}

.day-panel__header {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 18px;
  padding-bottom: 15px;
  border-bottom: 1px solid var(--color-border);
}

.day-panel__eyebrow {
  display: block;
  color: var(--color-muted);
  font-size: 9px;
  letter-spacing: 0.13em;
}

.day-panel__title {
  display: block;
  margin-top: 4px;
  color: var(--color-ink);
  font-family: var(--font-display);
  font-size: 22px;
  font-weight: 700;
}

.day-panel__count {
  color: var(--color-muted);
  font-size: 11px;
  letter-spacing: 0.08em;
}

.day-panel__records {
  display: flex;
  flex-direction: column;
  gap: 11px;
}

.day-panel__state {
  min-height: 340px;
}

.day-panel :deep(.empty-state) {
  min-height: 340px;
}

@media (max-width: 1050px) {
  .calendar-layout {
    grid-template-columns: minmax(0, 1.15fr) minmax(280px, 0.85fr);
  }

  .calendar-inner {
    padding-right: 28px;
    padding-left: 28px;
  }
}

@media (max-width: 840px) {
  .calendar-layout {
    grid-template-columns: 1fr;
  }

  .day-panel {
    min-height: 0;
  }

  .day-panel__state,
  .day-panel :deep(.empty-state) {
    min-height: 240px;
  }
}

@media (max-width: 699px) {
  .calendar-inner {
    padding: 18px 16px 38px;
  }

  .calendar-cell {
    min-height: 44px;
    font-size: 14px;
  }

  .calendar-card {
    padding: 16px 14px;
  }
}
</style>
