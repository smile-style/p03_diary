<script setup lang="ts">
import { onLoad, onShow } from '@dcloudio/uni-app'
import { computed, ref } from 'vue'
import AppShell from '../../components/AppShell.vue'
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
  <AppShell
    active="topics"
    title="标签归档"
    eyebrow="按标签回看"
    :description="tagName ? '所有带有 #' + tagName + ' 的记录' : '从标签回看记录'"
    back
  >
    <scroll-view class="page-scroll" scroll-y lower-threshold="80" @scrolltolower="loadMore">
      <view class="tag-inner">
        <view class="tag-summary">
          <text class="tag-summary__hash">#</text>
          <view>
            <text class="tag-summary__eyebrow">TAG ARCHIVE</text>
            <text class="tag-summary__title">{{ pageTitle }}</text>
            <text class="tag-summary__hint">这个标签下的全部记录</text>
          </view>
        </view>

        <view v-if="isInitialLoading" class="page-state">
          <text class="page-state__title">正在整理标签记录</text>
        </view>

        <view v-else-if="error" class="page-state">
          <text class="page-state__title">标签记录没有加载出来</text>
          <text class="page-state__error">{{ error }}</text>
          <button class="app-button app-button--primary" @click="loadPage">重试</button>
        </view>

        <EmptyState
          v-else-if="records.length === 0"
          title="这个标签还是空的"
          text="记录正文里写上 #标签，相关内容就会自动归到这里。"
        />

        <template v-else>
          <view class="record-list">
            <RecordCard v-for="record in records" :key="record.id" :record="record" />
          </view>
          <view v-if="loadingMore" class="loading-more">
            <text>正在继续加载…</text>
          </view>
          <view v-else-if="!nextCursor" class="list-end">
            <text>这个标签的记录都在这里</text>
          </view>
        </template>
      </view>
    </scroll-view>
  </AppShell>
</template>

<style scoped>
.tag-inner {
  width: 100%;
  max-width: 940px;
  margin: 0 auto;
  padding: 28px 42px 56px;
}

.tag-summary {
  display: flex;
  align-items: center;
  gap: 20px;
  margin-bottom: 22px;
  padding: 22px 26px;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-card);
  background: var(--color-surface);
  box-shadow: var(--shadow-soft);
}

.tag-summary__hash {
  display: flex;
  width: 58px;
  height: 58px;
  flex: none;
  align-items: center;
  justify-content: center;
  border-radius: 18px;
  background: var(--color-accent-soft);
  color: var(--color-accent);
  font-family: var(--font-display);
  font-size: 30px;
  font-weight: 700;
}

.tag-summary__eyebrow {
  display: block;
  color: var(--color-accent);
  font-size: 9px;
  font-weight: 700;
  letter-spacing: 0.17em;
}

.tag-summary__title {
  display: block;
  margin-top: 4px;
  color: var(--color-ink);
  font-family: var(--font-display);
  font-size: 27px;
  font-weight: 700;
}

.tag-summary__hint {
  display: block;
  margin-top: 5px;
  color: var(--color-muted);
  font-size: 10px;
}

.record-list {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

@media (max-width: 980px) {
  .tag-inner {
    padding-right: 28px;
    padding-left: 28px;
  }
}

@media (max-width: 699px) {
  .tag-inner {
    padding: 18px 16px 38px;
  }

  .tag-summary {
    padding: 18px;
  }

  .tag-summary__title {
    font-size: 23px;
  }
}
</style>
