<script setup lang="ts">
import { onLoad, onShow } from '@dcloudio/uni-app'
import { computed, ref } from 'vue'
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
  <view class="detail-page">
    <view v-if="loading" class="state-view">
      <text>正在加载…</text>
    </view>

    <view v-else-if="error" class="state-view">
      <text class="state-view__error">{{ error }}</text>
      <button class="state-view__button" @click="loadRecord">重试</button>
    </view>

    <scroll-view v-else-if="record" class="detail-scroll" scroll-y>
      <view class="detail-header">
        <view class="detail-header__meta">
          <text class="detail-header__date">{{ dateLabel }}</text>
          <text class="detail-header__topic" @click="openTopic">
            {{ topicName }}
          </text>
        </view>
        <button class="edit-button" @click="editRecord">编辑</button>
      </view>

      <view class="detail-card">
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
              <text v-if="excerpt.starred" class="excerpt__star">★</text>
              <text class="excerpt__quote">{{ excerpt.quote }}</text>
            </view>
            <text v-if="excerpt.thought" class="excerpt__thought">
              {{ excerpt.thought }}
            </text>
          </view>
        </view>

        <view v-if="record.tags.length" class="tag-list">
          <text
            v-for="tag in record.tags"
            :key="tag"
            class="tag-pill"
            @click="openTag(tag)"
          >
            #{{ tag }}
          </text>
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
          <text class="section-label">链接</text>
          <view v-for="link in links" :key="link" class="link-row" @click="copyLink(link)">
            <text class="link-row__text">{{ link }}</text>
            <text class="link-row__action">复制</text>
          </view>
        </view>
      </view>

      <button class="delete-button" :disabled="deleting" @click="confirmDelete">
        {{ deleting ? '删除中…' : '删除记录' }}
      </button>
      <view class="safe-area" />
    </scroll-view>
  </view>
</template>

<style scoped>
.detail-page {
  min-height: 100vh;
  background: var(--color-bg);
}

.detail-scroll {
  height: 100vh;
}

.detail-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 28rpx 32rpx 8rpx;
}

.detail-header__meta {
  display: flex;
  align-items: center;
  gap: 16rpx;
}

.detail-header__date {
  color: var(--color-muted);
  font-size: 24rpx;
}

.detail-header__topic {
  padding: 6rpx 16rpx;
  border-radius: 18rpx;
  background: rgba(7, 193, 96, 0.1);
  color: var(--color-primary);
  font-size: 23rpx;
}

.edit-button {
  margin: 0;
  padding: 0 8rpx;
  background: transparent;
  color: var(--color-primary);
  font-size: 26rpx;
  line-height: 60rpx;
}

.detail-card {
  margin: 20rpx 24rpx;
  padding: 32rpx;
  border-radius: 24rpx;
  background: #ffffff;
  box-shadow: 0 6rpx 24rpx rgba(0, 0, 0, 0.05);
}

.detail-body {
  display: block;
  color: var(--color-text);
  font-size: 31rpx;
  line-height: 1.75;
  white-space: pre-wrap;
}

.detail-placeholder {
  color: var(--color-muted);
  font-size: 26rpx;
}

.excerpt-list {
  margin-top: 30rpx;
}

.excerpt {
  padding: 22rpx 24rpx;
  border-left: 6rpx solid var(--color-border);
  border-radius: 8rpx;
  background: #f8f8f8;
}

.excerpt + .excerpt {
  margin-top: 18rpx;
}

.excerpt--starred {
  border-left-color: var(--color-star);
  background: #fff9ec;
}

.excerpt__quote-row {
  display: flex;
  align-items: flex-start;
}

.excerpt__star {
  margin-right: 8rpx;
  color: var(--color-star);
  font-size: 30rpx;
}

.excerpt__quote {
  flex: 1;
  color: #333333;
  font-size: 28rpx;
  line-height: 1.65;
}

.excerpt__thought {
  display: block;
  margin-top: 12rpx;
  color: var(--color-muted);
  font-size: 25rpx;
  line-height: 1.6;
}

.tag-list {
  display: flex;
  flex-wrap: wrap;
  gap: 12rpx;
  margin-top: 28rpx;
}

.tag-pill {
  padding: 7rpx 16rpx;
  border-radius: 20rpx;
  background: #eef8f2;
  color: var(--color-primary);
  font-size: 23rpx;
}

.image-grid {
  display: flex;
  flex-wrap: wrap;
  gap: 14rpx;
  margin-top: 28rpx;
}

.detail-image {
  width: 196rpx;
  height: 196rpx;
  border-radius: 14rpx;
  background: #eeeeee;
}

.link-list {
  margin-top: 30rpx;
  padding-top: 24rpx;
  border-top: 1rpx solid var(--color-border);
}

.section-label {
  display: block;
  margin-bottom: 12rpx;
  color: var(--color-text);
  font-size: 26rpx;
  font-weight: 600;
}

.link-row {
  display: flex;
  align-items: center;
  gap: 16rpx;
  padding: 16rpx 18rpx;
  border-radius: 12rpx;
  background: #f6f6f6;
}

.link-row + .link-row {
  margin-top: 10rpx;
}

.link-row__text {
  min-width: 0;
  flex: 1;
  overflow: hidden;
  color: #4b4b4b;
  font-size: 24rpx;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.link-row__action {
  flex: none;
  color: var(--color-primary);
  font-size: 23rpx;
}

.delete-button {
  margin: 40rpx 24rpx 0;
  border: 1rpx solid #e8b4b4;
  border-radius: 20rpx;
  background: #ffffff;
  color: #d94b4b;
  font-size: 27rpx;
  line-height: 88rpx;
}

.delete-button[disabled] {
  opacity: 0.5;
}

.state-view {
  display: flex;
  min-height: 70vh;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 22rpx;
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
  height: calc(72rpx + env(safe-area-inset-bottom));
}
</style>