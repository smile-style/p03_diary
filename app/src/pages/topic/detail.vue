<script setup lang="ts">
import { onLoad, onShow } from '@dcloudio/uni-app'
import { computed, ref } from 'vue'
import AppIcon from '../../components/AppIcon.vue'
import AppShell from '../../components/AppShell.vue'
import EmptyState from '../../components/EmptyState.vue'
import RecordCard from '../../components/RecordCard.vue'
import { listRecords } from '../../api/records'
import { getTopic } from '../../api/topics'
import type { RecordView, TopicSummary } from '../../api/types'
import { useAuthStore } from '../../stores/auth'
import {
  topicStatsLabel,
} from '../../utils/topics'

const auth = useAuthStore()
const topicId = ref('')
const topic = ref<TopicSummary | null>(null)
const records = ref<RecordView[]>([])
const nextCursor = ref<string | null>(null)
const filter = ref<'all' | 'starred'>('all')
const loading = ref(false)
const loadingMore = ref(false)
const error = ref<string | null>(null)
let requestVersion = 0

const topicMeta = computed(() => (topic.value ? topicStatsLabel(topic.value) : ''))
const isInitialLoading = computed(
  () => loading.value && records.value.length === 0,
)

onLoad((options) => {
  topicId.value = options?.id || ''
})

onShow(() => {
  void loadPage()
})

function messageOf(value: unknown): string {
  return value instanceof Error && value.message ? value.message : '加载失败'
}

function showToast(title: string): void {
  uni.showToast({ title, icon: 'none' })
}

async function loadPage(): Promise<void> {
  if (!topicId.value) {
    error.value = '缺少主题 id'
    return
  }

  await auth.ensureSession()
  if (auth.baseMessage) {
    error.value = auth.baseMessage
    return
  }

  const version = ++requestVersion
  loading.value = true
  error.value = null
  try {
    const [nextTopic, page] = await Promise.all([
      getTopic(topicId.value),
      listRecords({
        topicId: topicId.value,
        starred: filter.value === 'starred',
        limit: 20,
      }),
    ])
    if (version !== requestVersion) return
    topic.value = nextTopic
    records.value = page.items
    nextCursor.value = page.nextCursor
  } catch (loadError) {
    if (version !== requestVersion) return
    error.value = messageOf(loadError)
  } finally {
    if (version === requestVersion) loading.value = false
  }
}

async function loadMore(): Promise<void> {
  if (loading.value || loadingMore.value || !nextCursor.value) return
  const version = requestVersion
  loadingMore.value = true
  try {
    const page = await listRecords({
      topicId: topicId.value,
      starred: filter.value === 'starred',
      cursor: nextCursor.value,
      limit: 20,
    })
    if (version !== requestVersion) return
    const existingIds = new Set(records.value.map((record) => record.id))
    records.value.push(...page.items.filter((record) => !existingIds.has(record.id)))
    nextCursor.value = page.nextCursor
  } catch (loadError) {
    if (version === requestVersion) showToast(messageOf(loadError))
  } finally {
    if (version === requestVersion) loadingMore.value = false
  }
}

function changeFilter(next: 'all' | 'starred'): void {
  if (filter.value === next) return
  filter.value = next
  records.value = []
  nextCursor.value = null
  void loadPage()
}

function createRecord(): void {
  if (!topicId.value) return
  uni.navigateTo({
    url: `/pages/record/edit?topicId=${encodeURIComponent(topicId.value)}`,
  })
}
</script>

<template>
  <AppShell
    active="topics"
    title="主题详情"
    eyebrow="主题"
    :description="topic ? topic.name + ' · ' + topicMeta : '按主题回看记录'"
    back
  >
    <template #actions>
      <button class="app-button app-button--primary" @click="createRecord">
        <AppIcon name="plus" />
        在这个主题下记录
      </button>
    </template>

    <scroll-view class="page-scroll" scroll-y lower-threshold="80" @scrolltolower="loadMore">
      <view class="topic-inner">
        <view v-if="topic" class="topic-summary">
          <view>
            <text class="topic-summary__eyebrow">TOPIC</text>
            <text class="topic-summary__name">{{ topic.name }}</text>
            <text class="topic-summary__meta">{{ topicMeta }}</text>
          </view>
          <view class="topic-summary__stamp">
            <AppIcon name="topics" />
          </view>
        </view>

        <view class="segment-control" aria-label="筛选主题记录">
          <button
            class="segment-control__item"
            :class="{ 'segment-control__item--active': filter === 'all' }"
            @click="changeFilter('all')"
          >
            全部记录
            <text v-if="topic" class="segment-control__count">{{ topic.recordCount }}</text>
          </button>
          <button
            class="segment-control__item"
            :class="{ 'segment-control__item--active': filter === 'starred' }"
            @click="changeFilter('starred')"
          >
            <AppIcon name="star" />
            只看看好
            <text v-if="topic" class="segment-control__count">{{ topic.starredCount }}</text>
          </button>
        </view>

        <view v-if="isInitialLoading" class="page-state">
          <text class="page-state__title">正在翻阅这个主题</text>
        </view>

        <view v-else-if="error" class="page-state">
          <text class="page-state__title">主题没有加载出来</text>
          <text class="page-state__error">{{ error }}</text>
          <button class="app-button app-button--primary" @click="loadPage">重试</button>
        </view>

        <EmptyState
          v-else-if="records.length === 0"
          :title="filter === 'starred' ? '还没有标星摘抄' : '这个主题还是空的'"
          :text="filter === 'starred' ? '在记录里给值得留下的句子标星，它们会出现在这里。' : '从这个主题写下第一条记录吧。'"
        />

        <template v-else>
          <view class="record-list">
            <RecordCard v-for="record in records" :key="record.id" :record="record" />
          </view>
          <view v-if="loadingMore" class="loading-more">
            <text>正在继续加载…</text>
          </view>
          <view v-else-if="!nextCursor" class="list-end">
            <text>这个主题的记录都在这里</text>
          </view>
        </template>
      </view>
    </scroll-view>
  </AppShell>
</template>

<style scoped>
.topic-inner {
  width: 100%;
  max-width: 960px;
  margin: 0 auto;
  padding: 28px 42px 56px;
}

.topic-summary {
  display: flex;
  min-height: 132px;
  align-items: center;
  justify-content: space-between;
  gap: 24px;
  padding: 26px 30px;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-card);
  background:
    radial-gradient(circle at 88% 20%, rgba(154, 52, 18, 0.09), transparent 35%),
    var(--color-surface);
  box-shadow: var(--shadow-card);
}

.topic-summary__eyebrow {
  display: block;
  color: var(--color-accent);
  font-size: 9px;
  font-weight: 700;
  letter-spacing: 0.18em;
}

.topic-summary__name {
  display: block;
  margin-top: 6px;
  color: var(--color-ink);
  font-family: var(--font-display);
  font-size: 30px;
  font-weight: 700;
}

.topic-summary__meta {
  display: block;
  margin-top: 7px;
  color: var(--color-muted);
  font-size: 11px;
}

.topic-summary__stamp {
  display: flex;
  width: 58px;
  height: 58px;
  flex: none;
  align-items: center;
  justify-content: center;
  border-radius: 18px;
  background: var(--color-accent-soft);
  color: var(--color-accent);
}

.topic-summary__stamp .app-icon {
  width: 24px;
  height: 24px;
}

.segment-control {
  display: inline-flex;
  gap: 4px;
  margin: 22px 0 20px;
  padding: 4px;
  border: 1px solid var(--color-border);
  border-radius: 13px;
  background: var(--color-surface-muted);
}

.segment-control__item {
  display: inline-flex;
  min-height: 44px;
  align-items: center;
  gap: 7px;
  margin: 0;
  padding: 0 14px;
  border: 1px solid transparent;
  border-radius: 10px;
  background: transparent;
  color: var(--color-muted-strong);
  font-size: 11px;
}

.segment-control__item:hover {
  color: var(--color-ink);
}

.segment-control__item--active {
  border-color: var(--color-border);
  background: var(--color-surface);
  box-shadow: 0 5px 14px rgba(61, 47, 35, 0.06);
  color: var(--color-accent);
  font-weight: 600;
}

.segment-control__item .app-icon {
  width: 12px;
  height: 12px;
}

.segment-control__count {
  display: flex;
  min-width: 19px;
  height: 19px;
  align-items: center;
  justify-content: center;
  border-radius: 50%;
  background: var(--color-surface-muted);
  color: var(--color-muted);
  font-size: 9px;
}

.record-list {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

@media (max-width: 980px) {
  .topic-inner {
    padding-right: 28px;
    padding-left: 28px;
  }
}

@media (max-width: 699px) {
  .topic-inner {
    padding: 18px 16px 38px;
  }

  .topic-summary {
    min-height: 112px;
    padding: 20px;
  }

  .topic-summary__name {
    font-size: 24px;
  }

  .topic-summary__stamp {
    width: 48px;
    height: 48px;
  }

  .segment-control {
    display: flex;
    width: 100%;
  }

  .segment-control__item {
    flex: 1;
    justify-content: center;
  }
}
</style>
