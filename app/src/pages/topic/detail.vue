<script setup lang="ts">
import { onLoad, onShow } from '@dcloudio/uni-app'
import { computed, ref } from 'vue'
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
  <view class="topic-detail-page">
    <scroll-view class="page-scroll" scroll-y lower-threshold="80" @scrolltolower="loadMore">
      <view v-if="topic" class="topic-header">
        <text class="topic-header__name">{{ topic.name }}</text>
        <text class="topic-header__meta">{{ topicMeta }}</text>
      </view>

      <view class="segment-control">
        <text
          class="segment-control__item"
          :class="{ 'segment-control__item--active': filter === 'all' }"
          @click="changeFilter('all')"
        >
          全部
        </text>
        <text
          class="segment-control__item"
          :class="{ 'segment-control__item--active': filter === 'starred' }"
          @click="changeFilter('starred')"
        >
          只看 ★
        </text>
      </view>

      <view v-if="isInitialLoading" class="state-view">
        <text>正在加载…</text>
      </view>

      <view v-else-if="error" class="state-view">
        <text class="state-view__error">{{ error }}</text>
        <button class="state-view__button" @click="loadPage">重试</button>
      </view>

      <EmptyState
        v-else-if="records.length === 0"
        :text="filter === 'starred' ? '这个主题还没有 ★ 摘抄' : '这个主题还没有记录'"
      />

      <template v-else>
        <RecordCard v-for="record in records" :key="record.id" :record="record" />
        <view v-if="loadingMore" class="loading-more">
          <text>正在加载更多…</text>
        </view>
        <view v-else-if="!nextCursor" class="list-end">
          <text>已经到底了</text>
        </view>
      </template>

      <view class="safe-area" />
    </scroll-view>

    <button class="create-button" aria-label="在该主题下新建记录" @click="createRecord">
      ＋
    </button>
  </view>
</template>

<style scoped>
.topic-detail-page {
  height: 100vh;
  background: var(--color-bg);
}

.page-scroll {
  height: 100vh;
}

.topic-header {
  margin: 20rpx 24rpx 0;
  padding: 28rpx;
  border-radius: 24rpx;
  background: linear-gradient(135deg, #effbf4, #ffffff);
}

.topic-header__name {
  display: block;
  color: var(--color-text);
  font-size: 38rpx;
  font-weight: 700;
}

.topic-header__meta {
  display: block;
  margin-top: 10rpx;
  color: var(--color-muted);
  font-size: 23rpx;
}

.segment-control {
  display: flex;
  margin: 20rpx 24rpx;
  padding: 6rpx;
  border-radius: 18rpx;
  background: #ececec;
}

.segment-control__item {
  flex: 1;
  padding: 14rpx 0;
  border-radius: 14rpx;
  color: var(--color-muted);
  font-size: 25rpx;
  text-align: center;
}

.segment-control__item--active {
  background: #ffffff;
  box-shadow: 0 3rpx 10rpx rgba(0, 0, 0, 0.06);
  color: var(--color-primary);
  font-weight: 600;
}

.state-view {
  display: flex;
  min-height: 420rpx;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 20rpx;
  padding: 48rpx;
  color: var(--color-muted);
  text-align: center;
}

.state-view__error {
  color: #d94b4b;
  font-size: 25rpx;
}

.state-view__button {
  min-width: 180rpx;
  border-radius: 36rpx;
  background: var(--color-primary);
  color: #ffffff;
  font-size: 26rpx;
  line-height: 72rpx;
}

.loading-more,
.list-end {
  padding: 26rpx;
  color: var(--color-muted);
  font-size: 23rpx;
  text-align: center;
}

.create-button {
  position: fixed;
  right: 32rpx;
  bottom: 64rpx;
  width: 104rpx;
  height: 104rpx;
  margin: 0;
  padding: 0;
  border-radius: 52rpx;
  background: var(--color-primary);
  box-shadow: 0 10rpx 24rpx rgba(7, 193, 96, 0.3);
  color: #ffffff;
  font-size: 56rpx;
  line-height: 100rpx;
}

.safe-area {
  height: calc(150rpx + env(safe-area-inset-bottom));
}
</style>