<script setup lang="ts">
import { onLoad, onShow } from '@dcloudio/uni-app'
import { computed, ref } from 'vue'
import AppIcon from '../../components/AppIcon.vue'
import AppShell from '../../components/AppShell.vue'
import { deleteRecord, getRecord } from '../../api/records'
import type { RecordView } from '../../api/types'
import { useAuthStore } from '../../stores/auth'
import { formatDateLabel } from '../../utils/date'
import { clearDraft, draftKeyFor } from '../../utils/draft'
import {
  copyableLinks,
  previewableImageUrls,
  topicLabel,
} from '../../utils/record-display'

const auth = useAuthStore()
const recordId = ref('')
const record = ref<RecordView | null>(null)
const loading = ref(false)
const deleting = ref(false)
const error = ref<string | null>(null)

const dateLabel = computed(() =>
  record.value ? formatDateLabel(record.value.recordDate) : '',
)
const images = computed(() =>
  record.value ? previewableImageUrls(record.value) : [],
)
const links = computed(() => (record.value ? copyableLinks(record.value) : []))
const topicName = computed(() => topicLabel(record.value?.topic ?? null))

onLoad((options) => {
  recordId.value = options?.id || ''
})

onShow(() => {
  void loadRecord()
})

function messageOf(value: unknown): string {
  return value instanceof Error && value.message ? value.message : '加载失败'
}

function showToast(title: string): void {
  uni.showToast({ title, icon: 'none' })
}

async function loadRecord(): Promise<void> {
  if (!recordId.value) {
    error.value = '缺少记录 id'
    return
  }

  await auth.ensureSession()
  if (auth.baseMessage) {
    error.value = auth.baseMessage
    return
  }

  loading.value = true
  error.value = null
  try {
    record.value = await getRecord(recordId.value)
  } catch (loadError) {
    error.value = messageOf(loadError)
  } finally {
    loading.value = false
  }
}

function editRecord(): void {
  if (!recordId.value) return
  uni.navigateTo({
    url: `/pages/record/edit?id=${encodeURIComponent(recordId.value)}`,
  })
}

function openTopic(): void {
  const topic = record.value?.topic
  if (!topic) return
  uni.navigateTo({ url: `/pages/topic/detail?id=${encodeURIComponent(topic.id)}` })
}

function openTag(name: string): void {
  uni.navigateTo({ url: `/pages/tag/detail?name=${encodeURIComponent(name)}` })
}

function previewImage(url: string): void {
  if (!images.value.length) return
  uni.previewImage({ urls: images.value, current: url })
}

function copyLink(link: string): void {
  uni.setClipboardData({
    data: link,
    success: () => showToast('链接已复制'),
  })
}

function confirmDelete(): void {
  if (deleting.value) return
  uni.showModal({
    title: '删除记录',
    content: '删除后无法恢复，确定删除这条记录吗？',
    confirmText: '删除',
    confirmColor: '#d94b4b',
    success: (result) => {
      if (result.confirm) void removeRecord()
    },
  })
}

async function removeRecord(): Promise<void> {
  if (!recordId.value || deleting.value) return
  deleting.value = true
  try {
    await deleteRecord(recordId.value)
    clearDraft(draftKeyFor(recordId.value))
    uni.showToast({ title: '已删除', icon: 'success' })
    setTimeout(() => uni.navigateBack(), 350)
  } catch (deleteError) {
    showToast(messageOf(deleteError))
  } finally {
    deleting.value = false
  }
}
</script>

<template>
  <AppShell
    active="timeline"
    title="记录详情"
    :eyebrow="dateLabel || '生活记录'"
    :description="topicName"
    back
  >
    <template #actions>
      <button v-if="record" class="app-button app-button--small" @click="editRecord">
        <AppIcon name="edit" />
        编辑
      </button>
      <button
        v-if="record"
        class="app-button app-button--small app-button--danger"
        :disabled="deleting"
        @click="confirmDelete"
      >
        <AppIcon name="trash" />
        {{ deleting ? '删除中' : '删除' }}
      </button>
    </template>

    <scroll-view v-if="record" class="page-scroll" scroll-y>
      <view class="detail-inner">
        <view class="detail-layout">
          <article class="detail-card">
            <view class="detail-card__header">
              <text class="detail-card__eyebrow">RECORD</text>
              <text class="detail-card__date">{{ dateLabel }}</text>
            </view>

            <text v-if="record.body" class="detail-body">{{ record.body }}</text>
            <text v-else class="detail-placeholder">这条记录没有正文</text>

            <view v-if="record.excerpts.length" class="excerpt-list">
              <view
                v-for="(excerpt, index) in record.excerpts"
                :key="index"
                class="excerpt"
                :class="{ 'excerpt--starred': excerpt.starred }"
              >
                <view class="excerpt__quote-row">
                  <AppIcon v-if="excerpt.starred" class="excerpt__star" name="star" />
                  <text class="excerpt__quote">{{ excerpt.quote }}</text>
                </view>
                <text v-if="excerpt.thought" class="excerpt__thought">
                  {{ excerpt.thought }}
                </text>
              </view>
            </view>

            <view v-if="images.length" class="image-grid">
              <image
                v-for="url in images"
                :key="url"
                class="detail-image"
                :src="url"
                mode="aspectFill"
                @click="previewImage(url)"
              />
            </view>

            <view v-if="links.length" class="link-list">
              <text class="section-label">相关链接</text>
              <button v-for="link in links" :key="link" class="link-row" @click="copyLink(link)">
                <AppIcon name="link" />
                <text class="link-row__text">{{ link }}</text>
                <text class="link-row__action">复制</text>
              </button>
            </view>
          </article>

          <aside class="detail-side">
            <view class="side-card">
              <text class="side-card__eyebrow">RECORD INFO</text>
              <view class="side-row">
                <text class="side-row__label">日期</text>
                <text class="side-row__value">{{ dateLabel }}</text>
              </view>
              <view class="side-row">
                <text class="side-row__label">主题</text>
                <button class="side-row__link" @click="openTopic">{{ topicName }}</button>
              </view>
              <view class="side-row">
                <text class="side-row__label">摘抄</text>
                <text class="side-row__value">{{ record.excerpts.length }} 段</text>
              </view>
              <view class="side-row">
                <text class="side-row__label">图片</text>
                <text class="side-row__value">{{ images.length }} 张</text>
              </view>
            </view>

            <view v-if="record.tags.length" class="side-card">
              <text class="side-card__eyebrow">TAGS</text>
              <view class="tag-list">
                <button
                  v-for="tag in record.tags"
                  :key="tag"
                  class="tag-pill"
                  @click="openTag(tag)"
                >
                  #{{ tag }}
                </button>
              </view>
            </view>
          </aside>
        </view>
      </view>
    </scroll-view>

    <view v-else-if="loading" class="page-state">
      <text class="page-state__title">正在打开这条记录</text>
    </view>

    <view v-else class="page-state">
      <text class="page-state__title">记录没有加载出来</text>
      <text class="page-state__error">{{ error }}</text>
      <button class="app-button app-button--primary" @click="loadRecord">重试</button>
    </view>
  </AppShell>
</template>

<style scoped>
.detail-inner {
  width: 100%;
  max-width: 980px;
  margin: 0 auto;
  padding: 34px 42px 60px;
}

.detail-layout {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 250px;
  align-items: start;
  gap: 22px;
}

.detail-card,
.side-card {
  border: 1px solid var(--color-border);
  border-radius: var(--radius-card);
  background: var(--color-surface);
  box-shadow: var(--shadow-soft);
}

.detail-card {
  min-height: 520px;
  padding: 34px 38px;
}

.detail-card__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  margin-bottom: 28px;
  padding-bottom: 16px;
  border-bottom: 1px solid var(--color-border);
}

.detail-card__eyebrow,
.side-card__eyebrow {
  color: var(--color-accent);
  font-size: 9px;
  font-weight: 700;
  letter-spacing: 0.18em;
}

.detail-card__date {
  color: var(--color-muted);
  font-family: var(--font-display);
  font-size: 13px;
}

.detail-body {
  display: block;
  color: var(--color-text);
  font-size: 16px;
  line-height: 1.95;
  white-space: pre-wrap;
}

.detail-placeholder {
  color: var(--color-muted);
  font-size: 13px;
}

.excerpt-list {
  display: flex;
  flex-direction: column;
  gap: 12px;
  margin-top: 28px;
}

.excerpt {
  padding: 17px 19px;
  border-left: 2px solid var(--color-border-strong);
  border-radius: 0 12px 12px 0;
  background: var(--color-surface-muted);
}

.excerpt--starred {
  border-left-color: var(--color-star);
  background: var(--color-star-soft);
}

.excerpt__quote-row {
  display: flex;
  align-items: flex-start;
  gap: 9px;
}

.excerpt__star {
  width: 13px;
  height: 13px;
  margin-top: 7px;
  color: var(--color-star);
}

.excerpt__quote {
  min-width: 0;
  flex: 1;
  color: var(--color-text);
  font-family: var(--font-display);
  font-size: 16px;
  line-height: 1.75;
}

.excerpt__thought {
  display: block;
  margin-top: 8px;
  padding-left: 22px;
  color: var(--color-muted);
  font-size: 12px;
  line-height: 1.7;
}

.image-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px;
  margin-top: 30px;
}

.detail-image {
  width: 100%;
  aspect-ratio: 4 / 3;
  border-radius: 12px;
  background: var(--color-surface-muted);
  cursor: pointer;
}

.link-list {
  margin-top: 30px;
  padding-top: 22px;
  border-top: 1px solid var(--color-border);
}

.section-label {
  display: block;
  margin-bottom: 11px;
  color: var(--color-ink);
  font-family: var(--font-display);
  font-size: 16px;
  font-weight: 700;
}

.link-row {
  display: flex;
  width: 100%;
  min-height: 44px;
  align-items: center;
  gap: 10px;
  margin: 0;
  padding: 8px 12px;
  border: 1px solid var(--color-border);
  border-radius: 10px;
  background: var(--color-surface-muted);
  color: var(--color-muted-strong);
  text-align: left;
}

.link-row + .link-row {
  margin-top: 8px;
}

.link-row:hover {
  border-color: var(--color-border-strong);
}

.link-row .app-icon {
  width: 14px;
  height: 14px;
  flex: none;
}

.link-row__text {
  min-width: 0;
  flex: 1;
  overflow: hidden;
  font-size: 11px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.link-row__action {
  flex: none;
  color: var(--color-accent);
  font-size: 10px;
}

.detail-side {
  position: sticky;
  top: 0;
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.side-card {
  padding: 20px;
}

.side-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 11px 0;
  border-bottom: 1px solid var(--color-border);
}

.side-row:last-child {
  border-bottom: 0;
}

.side-row__label {
  color: var(--color-muted);
  font-size: 10px;
}

.side-row__value {
  color: var(--color-text);
  font-size: 11px;
}

.side-row__link {
  max-width: 150px;
  min-height: 30px;
  margin: 0;
  padding: 0;
  overflow: hidden;
  border: 0;
  background: transparent;
  color: var(--color-accent);
  font-size: 11px;
  text-align: right;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.tag-list {
  display: flex;
  flex-wrap: wrap;
  gap: 7px;
  margin-top: 14px;
}

.tag-pill {
  min-height: 30px;
  margin: 0;
  padding: 0 10px;
  border: 1px solid var(--color-border);
  border-radius: 999px;
  background: var(--color-surface-muted);
  color: var(--color-muted-strong);
  font-size: 10px;
}

.tag-pill:hover {
  border-color: var(--color-accent);
  color: var(--color-accent);
}

@media (max-width: 900px) {
  .detail-layout {
    grid-template-columns: 1fr;
  }

  .detail-side {
    position: static;
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}

@media (max-width: 980px) {
  .detail-inner {
    padding-right: 28px;
    padding-left: 28px;
  }
}

@media (max-width: 699px) {
  .detail-inner {
    padding: 18px 16px 38px;
  }

  .detail-card {
    padding: 22px 20px;
  }

  .detail-body {
    font-size: 15px;
  }

  .detail-side {
    grid-template-columns: 1fr;
  }

  .image-grid {
    grid-template-columns: 1fr;
  }
}
</style>
