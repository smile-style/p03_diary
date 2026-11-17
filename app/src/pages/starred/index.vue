<script setup lang="ts">
import { onShow } from '@dcloudio/uni-app'
import { ref } from 'vue'
import AppIcon from '../../components/AppIcon.vue'
import AppShell from '../../components/AppShell.vue'
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
  <AppShell
    active="topics"
    title="我看好的"
    eyebrow="精选摘抄"
    description="把值得反复看的句子，从记录里单独留出来。"
    back
  >
    <scroll-view class="page-scroll" scroll-y lower-threshold="80" @scrolltolower="loadMore">
      <view class="starred-inner">
        <view class="starred-intro">
          <view class="starred-intro__mark">
            <AppIcon name="star" />
          </view>
          <view>
            <text class="starred-intro__eyebrow">FAVORITES</text>
            <text class="starred-intro__title">那些让你停下来的句子</text>
            <text class="starred-intro__hint">这里收集所有记录里被你标星的摘抄与想法。</text>
          </view>
        </view>

        <view v-if="loading" class="page-state">
          <text class="page-state__title">正在整理精选摘抄</text>
        </view>

        <view v-else-if="error" class="page-state">
          <text class="page-state__title">精选摘抄没有加载出来</text>
          <text class="page-state__error">{{ error }}</text>
          <button class="app-button app-button--primary" @click="loadPage">重试</button>
        </view>

        <EmptyState
          v-else-if="items.length === 0"
          title="还没有标星摘抄"
          text="在记录里遇到值得留下的句子时，点亮那颗星，它会来到这里。"
        />

        <template v-else>
          <view class="starred-grid">
            <article
              v-for="item in items"
              :key="item.excerpt.id"
              class="starred-card"
            >
              <view class="starred-card__meta">
                <text class="starred-card__date">
                  {{ formatDateLabel(item.record.recordDate) }}
                </text>
                <text class="starred-card__topic">{{ topicName(item) }}</text>
              </view>

              <view class="starred-card__quote">
                <AppIcon class="starred-card__mark" name="star" />
                <text class="starred-card__quote-text">{{ item.excerpt.quote }}</text>
              </view>

              <text v-if="item.excerpt.thought" class="starred-card__thought">
                {{ item.excerpt.thought }}
              </text>

              <button class="record-link" @click="openRecord(item.record.id)">
                查看原记录
                <AppIcon name="chevron-right" />
              </button>
            </article>
          </view>

          <view v-if="loadingMore" class="loading-more">
            <text>正在继续加载…</text>
          </view>
          <view v-else-if="!nextCursor" class="list-end">
            <text>所有精选摘抄都在这里</text>
          </view>
        </template>
      </view>
    </scroll-view>
  </AppShell>
</template>

<style scoped>
.starred-inner {
  width: 100%;
  max-width: 980px;
  margin: 0 auto;
  padding: 28px 42px 56px;
}

.starred-intro {
  display: flex;
  align-items: center;
  gap: 18px;
  margin-bottom: 24px;
  padding: 22px 25px;
  border: 1px solid color-mix(in srgb, var(--color-star) 24%, var(--color-border));
  border-radius: var(--radius-card);
  background:
    radial-gradient(circle at 92% 20%, rgba(180, 83, 9, 0.12), transparent 34%),
    var(--color-star-soft);
}

.starred-intro__mark {
  display: flex;
  width: 54px;
  height: 54px;
  flex: none;
  align-items: center;
  justify-content: center;
  border-radius: 17px;
  background: var(--color-surface);
  color: var(--color-star);
  box-shadow: var(--shadow-soft);
}

.starred-intro__mark .app-icon {
  width: 22px;
  height: 22px;
}

.starred-intro__eyebrow {
  display: block;
  color: var(--color-star);
  font-size: 9px;
  font-weight: 700;
  letter-spacing: 0.16em;
}

.starred-intro__title {
  display: block;
  margin-top: 4px;
  color: var(--color-ink);
  font-family: var(--font-display);
  font-size: 21px;
  font-weight: 700;
}

.starred-intro__hint {
  display: block;
  margin-top: 5px;
  color: var(--color-muted);
  font-size: 10px;
}

.starred-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  align-items: start;
  gap: 13px;
}

.starred-card {
  padding: 20px;
  border: 1px solid var(--color-border);
  border-radius: 16px;
  background: var(--color-surface);
  box-shadow: var(--shadow-soft);
}

.starred-card__meta {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.starred-card__date {
  color: var(--color-muted);
  font-family: var(--font-display);
  font-size: 11px;
}

.starred-card__topic {
  max-width: 48%;
  overflow: hidden;
  color: var(--color-accent);
  font-size: 10px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.starred-card__quote {
  display: flex;
  align-items: flex-start;
  gap: 9px;
  margin-top: 16px;
  padding: 15px 16px;
  border-left: 2px solid var(--color-star);
  border-radius: 0 10px 10px 0;
  background: var(--color-star-soft);
}

.starred-card__mark {
  width: 12px;
  height: 12px;
  margin-top: 6px;
  color: var(--color-star);
}

.starred-card__quote-text {
  min-width: 0;
  flex: 1;
  color: var(--color-text);
  font-family: var(--font-display);
  font-size: 15px;
  line-height: 1.75;
}

.starred-card__thought {
  display: block;
  margin-top: 13px;
  color: var(--color-muted);
  font-size: 11px;
  line-height: 1.7;
}

.record-link {
  display: inline-flex;
  min-height: 44px;
  align-items: center;
  gap: 4px;
  margin: 12px 0 0;
  padding: 0;
  border: 0;
  background: transparent;
  color: var(--color-accent);
  font-size: 10px;
}

.record-link .app-icon {
  width: 12px;
  height: 12px;
}

@media (max-width: 820px) {
  .starred-grid {
    grid-template-columns: 1fr;
  }
}

@media (max-width: 980px) {
  .starred-inner {
    padding-right: 28px;
    padding-left: 28px;
  }
}

@media (max-width: 699px) {
  .starred-inner {
    padding: 18px 16px 38px;
  }

  .starred-intro {
    align-items: flex-start;
    padding: 18px;
  }
}
</style>
