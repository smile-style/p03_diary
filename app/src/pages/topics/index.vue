<script setup lang="ts">
import { onShow } from '@dcloudio/uni-app'
import { computed, ref } from 'vue'
import AppIcon from '../../components/AppIcon.vue'
import AppShell from '../../components/AppShell.vue'
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

const starredTotal = computed(() => {
  if (!overview.value) return 0
  return [...overview.value.categories.flatMap((category) => category.topics), ...overview.value.uncategorized]
    .reduce((total, topic) => total + topic.starredCount, 0)
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
  uni.navigateTo({ url: '/pages/topic/detail?id=' + encodeURIComponent(id) })
}

function openTag(name: string): void {
  uni.navigateTo({ url: '/pages/tag/detail?name=' + encodeURIComponent(name) })
}

function openCategoryManagement(): void {
  uni.switchTab({ url: '/pages/mine/index' })
}

function openCreateMenu(): void {
  uni.showActionSheet({
    itemList: ['新建主题', '管理分类'],
    success: (result) => {
      if (result.tapIndex === 0) askTopicName()
      if (result.tapIndex === 1) openCategoryManagement()
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
  <AppShell
    active="topics"
    title="主题"
    eyebrow="按线索整理"
    description="把零散记录收进主题里，也把值得反复看的摘抄留下来。"
  >
    <template #actions>
      <button class="app-button" @click="openCategoryManagement">管理分类</button>
      <button class="app-button app-button--primary" @click="askTopicName">
        <AppIcon name="plus" />
        新建主题
      </button>
    </template>

    <scroll-view class="page-scroll" scroll-y>
      <view class="topics-inner">
        <button class="starred-entry" @click="openStarred">
          <view class="starred-entry__mark">
            <AppIcon name="star" />
          </view>
          <view class="starred-entry__copy">
            <text class="starred-entry__eyebrow">精选摘抄</text>
            <text class="starred-entry__title">我看好的</text>
            <text class="starred-entry__hint">
              {{ starredTotal ? '已经留下 ' + starredTotal + ' 段标星摘抄' : '翻到值得记住的句子时，就把它标星' }}
            </text>
          </view>
          <AppIcon class="starred-entry__arrow" name="chevron-right" />
        </button>

        <view v-if="loading && !overview" class="page-state">
          <text class="page-state__title">正在整理主题</text>
          <text class="page-state__message">马上就好。</text>
        </view>

        <view v-else-if="error" class="page-state">
          <text class="page-state__title">主题没有加载出来</text>
          <text class="page-state__error">{{ error }}</text>
          <button class="app-button app-button--primary" @click="loadPage">重试</button>
        </view>

        <template v-else-if="overview">
          <EmptyState
            v-if="overview.categories.every((category) => category.topics.length === 0) && overview.uncategorized.length === 0"
            title="还没有主题"
            text="新建一个主题，让同一类想法慢慢聚到一起。"
          />

          <view v-else class="topic-sections">
            <section
              v-for="category in overview.categories"
              :key="category.id"
              class="topic-group"
            >
              <view class="group-header">
                <view class="group-header__copy">
                  <text class="group-header__title">{{ category.name }}</text>
                  <text class="group-header__hint">{{ category.topics.length }} 个主题</text>
                </view>
                <view class="group-header__line" />
              </view>

              <view v-if="category.topics.length" class="topic-grid">
                <button
                  v-for="topic in category.topics"
                  :key="topic.id"
                  class="topic-card"
                  @click="openTopic(topic.id)"
                >
                  <view class="topic-card__topline">
                    <text class="topic-card__name">{{ topic.name }}</text>
                    <AppIcon class="topic-card__arrow" name="chevron-right" />
                  </view>
                  <text class="topic-card__meta">{{ topicMeta(topic) }}</text>
                </button>
              </view>
              <text v-else class="group-empty">这个分类还没有主题</text>
            </section>

            <section v-if="overview.uncategorized.length" class="topic-group">
              <view class="group-header">
                <view class="group-header__copy">
                  <text class="group-header__title">未分类</text>
                  <text class="group-header__hint">{{ overview.uncategorized.length }} 个主题</text>
                </view>
                <view class="group-header__line" />
              </view>
              <view class="topic-grid">
                <button
                  v-for="topic in overview.uncategorized"
                  :key="topic.id"
                  class="topic-card"
                  @click="openTopic(topic.id)"
                >
                  <view class="topic-card__topline">
                    <text class="topic-card__name">{{ topic.name }}</text>
                    <AppIcon class="topic-card__arrow" name="chevron-right" />
                  </view>
                  <text class="topic-card__meta">{{ topicMeta(topic) }}</text>
                </button>
              </view>
            </section>
          </view>

          <view v-if="tags.length" class="tags-section">
            <view class="group-header">
              <view class="group-header__copy">
                <text class="group-header__title">常用标签</text>
                <text class="group-header__hint">从记录正文里自动整理</text>
              </view>
              <view class="group-header__line" />
            </view>

            <view class="tag-list">
              <button
                v-for="tag in tags"
                :key="tag.name"
                class="tag-pill"
                @click="openTag(tag.name)"
              >
                <text class="tag-pill__name">#{{ tag.name }}</text>
                <text class="tag-pill__count">{{ tag.count }}</text>
              </button>
            </view>
          </view>
        </template>

        <button class="mobile-create" aria-label="新建主题或管理分类" @click="openCreateMenu">
          <AppIcon name="plus" />
        </button>
      </view>
    </scroll-view>
  </AppShell>
</template>

<style scoped>
.topics-inner {
  position: relative;
  width: 100%;
  max-width: 1080px;
  margin: 0 auto;
  padding: 28px 42px 56px;
}

.starred-entry {
  display: flex;
  width: 100%;
  min-height: 126px;
  align-items: center;
  gap: 18px;
  margin: 0 0 34px;
  padding: 24px 28px;
  border: 1px solid color-mix(in srgb, var(--color-star) 24%, var(--color-border));
  border-radius: var(--radius-card);
  background:
    radial-gradient(circle at 92% 18%, rgba(180, 83, 9, 0.11), transparent 34%),
    var(--color-star-soft);
  color: var(--color-text);
  text-align: left;
}

.starred-entry:hover {
  border-color: color-mix(in srgb, var(--color-star) 44%, var(--color-border));
  transform: translateY(-2px);
}

.starred-entry__mark {
  display: flex;
  width: 58px;
  height: 58px;
  flex: none;
  align-items: center;
  justify-content: center;
  border-radius: 18px;
  background: var(--color-surface);
  color: var(--color-star);
  box-shadow: var(--shadow-soft);
}

.starred-entry__mark .app-icon {
  width: 24px;
  height: 24px;
}

.starred-entry__copy {
  min-width: 0;
  flex: 1;
}

.starred-entry__eyebrow {
  display: block;
  color: var(--color-star);
  font-size: 9px;
  font-weight: 700;
  letter-spacing: 0.16em;
}

.starred-entry__title {
  display: block;
  margin-top: 5px;
  color: var(--color-ink);
  font-family: var(--font-display);
  font-size: 25px;
  font-weight: 700;
}

.starred-entry__hint {
  display: block;
  margin-top: 5px;
  color: var(--color-muted);
  font-size: 11px;
}

.starred-entry__arrow {
  width: 20px;
  height: 20px;
  color: var(--color-star);
}

.topic-sections {
  display: flex;
  flex-direction: column;
  gap: 30px;
}

.group-header {
  display: flex;
  align-items: flex-end;
  gap: 15px;
  margin-bottom: 13px;
}

.group-header__copy {
  flex: none;
}

.group-header__title {
  display: block;
  color: var(--color-ink);
  font-family: var(--font-display);
  font-size: 21px;
  font-weight: 700;
}

.group-header__hint {
  display: block;
  margin-top: 3px;
  color: var(--color-muted);
  font-size: 10px;
}

.group-header__line {
  height: 1px;
  flex: 1;
  margin-bottom: 7px;
  background: var(--color-border);
}

.topic-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px;
}

.topic-card {
  display: flex;
  min-height: 104px;
  flex-direction: column;
  justify-content: space-between;
  margin: 0;
  padding: 18px 19px;
  border: 1px solid var(--color-border);
  border-radius: 15px;
  background: var(--color-surface);
  box-shadow: var(--shadow-soft);
  color: var(--color-text);
  text-align: left;
}

.topic-card:hover {
  border-color: var(--color-border-strong);
  box-shadow: var(--shadow-card);
  transform: translateY(-2px);
}

.topic-card__topline {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
}

.topic-card__name {
  color: var(--color-ink);
  font-family: var(--font-display);
  font-size: 18px;
  font-weight: 700;
  line-height: 1.35;
}

.topic-card__arrow {
  width: 15px;
  height: 15px;
  margin-top: 4px;
  color: var(--color-muted);
}

.topic-card__meta {
  display: block;
  margin-top: 13px;
  color: var(--color-muted);
  font-size: 10px;
  line-height: 1.5;
}

.group-empty {
  display: block;
  padding: 18px;
  border: 1px dashed var(--color-border);
  border-radius: 13px;
  color: var(--color-muted);
  font-size: 11px;
}

.tags-section {
  margin-top: 38px;
  padding-top: 2px;
}

.tag-list {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.tag-pill {
  position: relative;
  display: inline-flex;
  min-height: 34px;
  align-items: center;
  gap: 8px;
  margin: 0;
  padding: 0 12px;
  border: 1px solid var(--color-border);
  border-radius: 999px;
  background: var(--color-surface);
  color: var(--color-muted-strong);
}

.tag-pill::after {
  position: absolute;
  inset: -5px -2px;
  content: '';
}

.tag-pill:hover {
  border-color: color-mix(in srgb, var(--color-accent) 45%, var(--color-border));
  color: var(--color-accent);
}

.tag-pill__name {
  font-size: 11px;
}

.tag-pill__count {
  display: flex;
  min-width: 18px;
  height: 18px;
  align-items: center;
  justify-content: center;
  border-radius: 50%;
  background: var(--color-surface-muted);
  color: var(--color-muted);
  font-size: 9px;
}

.mobile-create {
  display: none;
}

@media (max-width: 980px) {
  .topics-inner {
    padding-right: 28px;
    padding-left: 28px;
  }
}

@media (max-width: 760px) {
  .topic-grid {
    grid-template-columns: 1fr;
  }
}

@media (max-width: 699px) {
  .topics-inner {
    padding: 18px 16px 92px;
  }

  .starred-entry {
    min-height: 108px;
    margin-bottom: 26px;
    padding: 18px;
  }

  .starred-entry__title {
    font-size: 21px;
  }

  .mobile-create {
    position: fixed;
    right: 22px;
    bottom: 84px;
    display: flex;
    width: 52px;
    height: 52px;
    align-items: center;
    justify-content: center;
    margin: 0;
    padding: 0;
    border: 0;
    border-radius: 50%;
    background: var(--color-accent);
    box-shadow: 0 10px 24px rgba(154, 52, 18, 0.26);
    color: var(--color-on-accent);
  }
}
</style>
