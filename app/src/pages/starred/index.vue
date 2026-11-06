<script setup lang="ts">
import { onShow } from '@dcloudio/uni-app'
import { ref } from 'vue'
import EmptyState from '../../components/EmptyState.vue'
import { getStarredExcerpts } from '../../api/queries'
import type { StarredItem } from '../../api/types'
import { useAuthStore } from '../../stores/auth'
import { formatDateLabel } from '../../utils/date'

const auth = useAuthStore()
const items = ref<StarredItem[]>([])
const nextCursor = ref<string | null>(null)
const loading = ref(false)
const loadingMore = ref(false)
const error = ref<string | null>(null)
let requestVersion = 0

onShow(() => {
  void loadPage()
})

function messageOf(value: unknown): string {
  return value instanceof Error && value.message ? value.message : '加载失败'
}

async function loadPage(): Promise<void> {
  await auth.ensureSession()
  if (auth.baseMessage) {
    error.value = auth.baseMessage
    return
  }

  const version = ++requestVersion
  loading.value = true
  error.value = null
  items.value = []
  nextCursor.value = null
  try {
    const page = await getStarredExcerpts({ limit: 20 })
    if (version !== requestVersion) return
    items.value = page.items
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
    const page = await getStarredExcerpts({
      cursor: nextCursor.value,
      limit: 20,
    })
    if (version !== requestVersion) return
    const existingIds = new Set(items.value.map((item) => item.excerpt.id))
    items.value.push(...page.items.filter((item) => !existingIds.has(item.excerpt.id)))
    nextCursor.value = page.nextCursor
  } catch (loadError) {
    if (version === requestVersion) {
      uni.showToast({ title: messageOf(loadError), icon: 'none' })
    }
  } finally {
    if (version === requestVersion) loadingMore.value = false
  }
}

function openRecord(recordId: string): void {
  uni.navigateTo({ url: `/pages/record/detail?id=${encodeURIComponent(recordId)}` })
}

function topicName(item: StarredItem): string {
  return item.record.topic?.name ?? '未分类'
}
</script>

<template>
  <view class="starred-page">
    <scroll-view class="page-scroll" scroll-y lower-threshold="80" @scrolltolower="loadMore">
      <view class="page-intro">
        <text class="page-intro__star">★</text>
        <view>
          <text class="page-intro__title">我看好的</text>
          <text class="page-intro__subtitle">所有记录里被你标星的摘抄</text>
        </view>
      </view>

      <view v-if="loading" class="state-view">
        <text>正在加载…</text>
      </view>

      <view v-else-if="error" class="state-view">
        <text class="state-view__error">{{ error }}</text>
        <button class="state-view__button" @click="loadPage">重试</button>
      </view>

      <EmptyState v-else-if="items.length === 0" text="还没有 ★ 摘抄" />

      <template v-else>
        <view v-for="item in items" :key="item.excerpt.id" class="starred-card">
          <view class="starred-card__meta">
            <text class="starred-card__date">
              {{ formatDateLabel(item.record.recordDate) }}
            </text>
            <text class="starred-card__topic">{{ topicName(item) }}</text>
          </view>

          <view class="starred-card__quote">
            <text class="starred-card__mark">★</text>
            <text class="starred-card__quote-text">{{ item.excerpt.quote }}</text>
          </view>

          <text v-if="item.excerpt.thought" class="starred-card__thought">
            {{ item.excerpt.thought }}
          </text>

          <button class="record-link" @click="openRecord(item.record.id)">
            查看原记录 ›
          </button>
        </view>

        <view v-if="loadingMore" class="loading-more">
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
.starred-page {
  height: 100vh;
  background: var(--color-bg);
}

.page-scroll {
  height: 100vh;
}

.page-intro {
  display: flex;
  align-items: center;
  gap: 18rpx;
  margin: 20rpx 24rpx;
  padding: 26rpx 30rpx;
  border-radius: 24rpx;
  background: linear-gradient(135deg, #fff8e8, #ffffff);
}

.page-intro__star {
  color: var(--color-star);
  font-size: 52rpx;
}

.page-intro__title {
  display: block;
  color: var(--color-text);
  font-size: 32rpx;
  font-weight: 700;
}

.page-intro__subtitle {
  display: block;
  margin-top: 6rpx;
  color: var(--color-muted);
  font-size: 22rpx;
}

.starred-card {
  margin: 0 24rpx 18rpx;
  padding: 26rpx 28rpx;
  border-radius: 22rpx;
  background: #ffffff;
  box-shadow: 0 5rpx 20rpx rgba(0, 0, 0, 0.04);
}

.starred-card__meta {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.starred-card__date {
  color: var(--color-muted);
  font-size: 23rpx;
}

.starred-card__topic {
  padding: 6rpx 15rpx;
  border-radius: 18rpx;
  background: rgba(7, 193, 96, 0.1);
  color: var(--color-primary);
  font-size: 22rpx;
}

.starred-card__quote {
  display: flex;
  align-items: flex-start;
  margin-top: 22rpx;
  padding: 20rpx 22rpx;
  border-left: 6rpx solid var(--color-star);
  border-radius: 8rpx;
  background: #fffbf2;
}

.starred-card__mark {
  margin-right: 8rpx;
  color: var(--color-star);
  font-size: 28rpx;
}

.starred-card__quote-text {
  flex: 1;
  color: #333333;
  font-size: 28rpx;
  line-height: 1.65;
}

.starred-card__thought {
  display: block;
  margin-top: 16rpx;
  color: var(--color-muted);
  font-size: 25rpx;
  line-height: 1.6;
}

.record-link {
  margin: 20rpx 0 0 auto;
  padding: 0;
  background: transparent;
  color: var(--color-primary);
  font-size: 24rpx;
  line-height: 48rpx;
  text-align: right;
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

.safe-area {
  height: calc(40rpx + env(safe-area-inset-bottom));
}
</style>