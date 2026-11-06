<script setup lang="ts">
import { onShow } from '@dcloudio/uni-app'
import { ref } from 'vue'
import EmptyState from '../../components/EmptyState.vue'
import { getTags } from '../../api/queries'
import {
  createTopic,
  getTopicOverview,
} from '../../api/topics'
import type { TagCount, TopicOverview, TopicSummary } from '../../api/types'
import { useAuthStore } from '../../stores/auth'
import {
  topicCategoryChoices,
  topicStatsLabel,
} from '../../utils/topics'

const auth = useAuthStore()
const overview = ref<TopicOverview | null>(null)
const tags = ref<TagCount[]>([])
const loading = ref(false)
const error = ref<string | null>(null)
let requestVersion = 0

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
  await auth.ensureSession()
  if (auth.baseMessage) {
    error.value = auth.baseMessage
    return
  }

  const version = ++requestVersion
  loading.value = true
  error.value = null
  try {
    const [nextOverview, nextTags] = await Promise.all([
      getTopicOverview(),
      getTags(),
    ])
    if (version !== requestVersion) return
    overview.value = nextOverview
    tags.value = nextTags.items
  } catch (loadError) {
    if (version !== requestVersion) return
    error.value = messageOf(loadError)
  } finally {
    if (version === requestVersion) loading.value = false
  }
}

function openStarred(): void {
  uni.navigateTo({ url: '/pages/starred/index' })
}

function openTopic(id: string): void {
  uni.navigateTo({ url: `/pages/topic/detail?id=${encodeURIComponent(id)}` })
}

function openTag(name: string): void {
  uni.navigateTo({ url: `/pages/tag/detail?name=${encodeURIComponent(name)}` })
}

function openCreateMenu(): void {
  uni.showActionSheet({
    itemList: ['新建主题', '管理分类'],
    success: (result) => {
      if (result.tapIndex === 0) askTopicName()
      if (result.tapIndex === 1) uni.switchTab({ url: '/pages/mine/index' })
    },
  })
}

function askTopicName(): void {
  uni.showModal({
    title: '新建主题',
    editable: true,
    placeholderText: '输入主题名称',
    confirmText: '下一步',
    success: (result) => {
      const name = String((result as typeof result & { content?: string }).content ?? '').trim()
      if (result.confirm && name) chooseCategory(name)
    },
  })
}

function chooseCategory(name: string): void {
  if (!overview.value) {
    showToast('主题数据尚未加载')
    return
  }

  const choices = topicCategoryChoices(overview.value)
  uni.showActionSheet({
    itemList: choices.map((choice) => choice.label),
    success: async (result) => {
      const category = choices[result.tapIndex]
      if (!category) return
      try {
        await createTopic(name, category.id)
        showToast('主题已创建')
        await loadPage()
      } catch (createError) {
        showToast(messageOf(createError))
      }
    },
  })
}

function topicMeta(topic: TopicSummary): string {
  return topicStatsLabel(topic)
}
</script>

<template>
  <view class="topics-page">
    <scroll-view class="page-scroll" scroll-y>
      <view class="top-actions">
        <view class="starred-entry" @click="openStarred">
          <text class="starred-entry__star">★</text>
          <text class="starred-entry__title">我看好的</text>
          <text class="starred-entry__arrow">›</text>
        </view>
        <button class="add-button" aria-label="新建主题或管理分类" @click="openCreateMenu">＋</button>
      </view>

      <view v-if="loading && !overview" class="state-view">
        <text>正在加载…</text>
      </view>

      <view v-else-if="error" class="state-view">
        <text class="state-view__error">{{ error }}</text>
        <button class="state-view__button" @click="loadPage">重试</button>
      </view>

      <template v-else-if="overview">
        <EmptyState
          v-if="overview.categories.every((category) => category.topics.length === 0) && overview.uncategorized.length === 0"
          text="还没有主题，点右上角 ＋ 新建一个"
        />

        <view
          v-for="category in overview.categories"
          :key="category.id"
          class="topic-group"
        >
          <view class="group-header">
            <text class="group-header__title">{{ category.name }}</text>
            <text class="group-header__count">{{ category.topics.length }} 个主题</text>
          </view>
          <view
            v-for="topic in category.topics"
            :key="topic.id"
            class="topic-card"
            @click="openTopic(topic.id)"
          >
            <view class="topic-card__content">
              <text class="topic-card__name">{{ topic.name }}</text>
              <text class="topic-card__meta">{{ topicMeta(topic) }}</text>
            </view>
            <text class="topic-card__arrow">›</text>
          </view>
        </view>

        <view v-if="overview.uncategorized.length" class="topic-group">
          <view class="group-header">
            <text class="group-header__title">未分类</text>
            <text class="group-header__count">{{ overview.uncategorized.length }} 个主题</text>
          </view>
          <view
            v-for="topic in overview.uncategorized"
            :key="topic.id"
            class="topic-card"
            @click="openTopic(topic.id)"
          >
            <view class="topic-card__content">
              <text class="topic-card__name">{{ topic.name }}</text>
              <text class="topic-card__meta">{{ topicMeta(topic) }}</text>
            </view>
            <text class="topic-card__arrow">›</text>
          </view>
        </view>

        <view v-if="tags.length" class="tags-section">
          <view class="group-header">
            <text class="group-header__title">常用标签</text>
          </view>
          <view class="tag-list">
            <text
              v-for="tag in tags"
              :key="tag.name"
              class="tag-pill"
              @click="openTag(tag.name)"
            >
              #{{ tag.name }} · {{ tag.count }}
            </text>
          </view>
        </view>
      </template>

      <view class="safe-area" />
    </scroll-view>
  </view>
</template>

<style scoped>
.topics-page {
  height: 100vh;
  background: var(--color-bg);
}

.page-scroll {
  height: 100vh;
}

.top-actions {
  display: flex;
  align-items: center;
  gap: 18rpx;
  padding: 24rpx;
}

.starred-entry {
  display: flex;
  min-width: 0;
  height: 94rpx;
  flex: 1;
  align-items: center;
  gap: 12rpx;
  padding: 0 26rpx;
  border-radius: 22rpx;
  background: #fff9ec;
  box-shadow: 0 6rpx 22rpx rgba(240, 160, 32, 0.08);
}

.starred-entry__star {
  color: var(--color-star);
  font-size: 36rpx;
}

.starred-entry__title {
  color: var(--color-text);
  font-size: 28rpx;
  font-weight: 600;
}

.starred-entry__arrow {
  margin-left: auto;
  color: var(--color-star);
  font-size: 38rpx;
}

.add-button {
  width: 94rpx;
  height: 94rpx;
  margin: 0;
  padding: 0;
  border-radius: 22rpx;
  background: var(--color-primary);
  box-shadow: 0 6rpx 18rpx rgba(7, 193, 96, 0.22);
  color: #ffffff;
  font-size: 48rpx;
  line-height: 90rpx;
}

.topic-group,
.tags-section {
  margin: 0 24rpx 20rpx;
}

.group-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12rpx 8rpx 16rpx;
}

.group-header__title {
  color: var(--color-text);
  font-size: 29rpx;
  font-weight: 600;
}

.group-header__count {
  color: var(--color-muted);
  font-size: 22rpx;
}

.topic-card {
  display: flex;
  min-height: 122rpx;
  align-items: center;
  padding: 22rpx 24rpx;
  border-radius: 20rpx;
  background: #ffffff;
  box-shadow: 0 5rpx 20rpx rgba(0, 0, 0, 0.04);
}

.topic-card + .topic-card {
  margin-top: 14rpx;
}

.topic-card__content {
  min-width: 0;
  flex: 1;
}

.topic-card__name {
  display: block;
  color: var(--color-text);
  font-size: 29rpx;
  font-weight: 600;
}

.topic-card__meta {
  display: block;
  margin-top: 9rpx;
  color: var(--color-muted);
  font-size: 22rpx;
}

.topic-card__arrow {
  margin-left: 16rpx;
  color: #bbbbbb;
  font-size: 40rpx;
}

.tags-section {
  margin-top: 30rpx;
  padding: 8rpx 24rpx 28rpx;
  border-radius: 22rpx;
  background: #ffffff;
}

.tag-list {
  display: flex;
  flex-wrap: wrap;
  gap: 14rpx;
}

.tag-pill {
  padding: 10rpx 20rpx;
  border-radius: 26rpx;
  background: #eef8f2;
  color: var(--color-primary);
  font-size: 24rpx;
}

.state-view {
  display: flex;
  min-height: 60vh;
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
  font-size: 26rpx;
}

.state-view__button {
  min-width: 180rpx;
  border-radius: 36rpx;
  background: var(--color-primary);
  color: #ffffff;
  font-size: 26rpx;
  line-height: 72rpx;
}

.safe-area {
  height: calc(48rpx + env(safe-area-inset-bottom));
}
</style>