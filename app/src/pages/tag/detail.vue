<script setup lang="ts">
import { onLoad, onShow } from '@dcloudio/uni-app'
import { computed, ref } from 'vue'
import EmptyState from '../../components/EmptyState.vue'
import RecordCard from '../../components/RecordCard.vue'
import { listRecords } from '../../api/records'
import type { RecordView } from '../../api/types'
import { useAuthStore } from '../../stores/auth'

const auth = useAuthStore()
const tagName = ref('')
const records = ref<RecordView[]>([])
const nextCursor = ref<string | null>(null)
const loading = ref(false)
const loadingMore = ref(false)
const error = ref<string | null>(null)
let requestVersion = 0

const pageTitle = computed(() => (tagName.value ? `#${tagName.value}` : '#标签'))
const isInitialLoading = computed(
  () => loading.value && records.value.length === 0,
)

onLoad((options) => {
  const rawName = typeof options?.name === 'string' ? options.name : ''
  tagName.value = decodeOption(rawName)
  if (tagName.value) {
    uni.setNavigationBarTitle({ title: pageTitle.value })
  }
})

onShow(() => {
  void loadPage()
})

function decodeOption(value: string): string {
  try {
    return decodeURIComponent(value)
  } catch {
    return value
  }
}

function messageOf(value: unknown): string {
  return value instanceof Error && value.message ? value.message : '加载失败'
}

function showToast(title: string): void {
  uni.showToast({ title, icon: 'none' })
}

async function loadPage(): Promise<void> {
  if (!tagName.value) {
    error.value = '缺少标签名称'
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
  records.value = []
  nextCursor.value = null
  try {
    const page = await listRecords({ tag: tagName.value, limit: 20 })
    if (version !== requestVersion) return
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
      tag: tagName.value,
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
</script>

<template>
  <view class="tag-page">
    <scroll-view class="page-scroll" scroll-y lower-threshold="80" @scrolltolower="loadMore">
      <view class="tag-header">
        <text class="tag-header__title">{{ pageTitle }}</text>
        <text class="tag-header__hint">这个标签下的全部记录</text>
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
        text="这个标签下还没有记录"
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
  </view>
</template>

<style scoped>
.tag-page {
  height: 100vh;
  background: var(--color-bg);
}

.page-scroll {
  height: 100vh;
}

.tag-header {
  margin: 20rpx 24rpx 8rpx;
  padding: 28rpx 30rpx;
  border-radius: 24rpx;
  background: linear-gradient(135deg, #effbf4, #ffffff);
}

.tag-header__title {
  display: block;
  color: var(--color-primary);
  font-size: 38rpx;
  font-weight: 700;
}

.tag-header__hint {
  display: block;
  margin-top: 10rpx;
  color: var(--color-muted);
  font-size: 23rpx;
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