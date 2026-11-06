<script setup lang="ts">
import { onLoad, onUnload } from '@dcloudio/uni-app'
import { computed, reactive, ref, watch } from 'vue'
import { ApiError } from '../../api/client'
import { uploadImageApi } from '../../api/images'
import { createRecord, getRecord, updateRecord } from '../../api/records'
import { getTopicOverview } from '../../api/topics'
import type { RecordView } from '../../api/types'
import { todayLocal } from '../../utils/date'
import {
  clearDraft,
  draftKeyFor,
  emptyDraft,
  loadDraft,
  saveDraft,
  type EditorDraft,
} from '../../utils/draft'
import { buildRecordInput, validateDraft } from '../../utils/record-input'

type TopicChoice = {
  id: string | null
  label: string
}

const draft = reactive<EditorDraft>(emptyDraft(todayLocal()))
const recordId = ref<string | null>(null)
const hydrated = ref(false)
const saved = ref(false)
const saving = ref(false)
const uploading = ref(0)
const topicChoices = ref<TopicChoice[]>([{ id: null, label: '不选主题' }])
const imagePreviews = reactive<Record<string, string | null>>({})
let draftTimer: ReturnType<typeof setTimeout> | null = null

const isEditing = computed(() => recordId.value !== null)
const pageTitle = computed(() => (isEditing.value ? '编辑记录' : '新记录'))
const draftKey = computed(() => draftKeyFor(recordId.value ?? undefined))
const topicLabels = computed(() => topicChoices.value.map((topic) => topic.label))
const topicPickerIndex = computed(() => {
  const index = topicChoices.value.findIndex((topic) => topic.id === draft.topicId)
  return index >= 0 ? index : 0
})
const canAddImage = computed(() => uploading.value === 0 && draft.imageIds.length < 9)

function normalizeDraft(value: EditorDraft): EditorDraft {
  const today = todayLocal()
  return {
    topicId: typeof value.topicId === 'string' ? value.topicId : null,
    recordDate:
      typeof value.recordDate === 'string' && value.recordDate
        ? value.recordDate
        : today,
    body: typeof value.body === 'string' ? value.body : '',
    excerpts: Array.isArray(value.excerpts)
      ? value.excerpts.map((excerpt) => ({
          quote: typeof excerpt.quote === 'string' ? excerpt.quote : '',
          thought: typeof excerpt.thought === 'string' ? excerpt.thought : '',
          starred: Boolean(excerpt.starred),
        }))
      : [],
    links: Array.isArray(value.links)
      ? value.links.map((link) => (typeof link === 'string' ? link : ''))
      : [],
    imageIds: Array.isArray(value.imageIds)
      ? value.imageIds.filter((id): id is string => typeof id === 'string')
      : [],
  }
}

function fillFromRecord(record: RecordView): void {
  Object.assign(
    draft,
    normalizeDraft({
      topicId: record.topicId,
      recordDate: record.recordDate,
      body: record.body,
      excerpts: record.excerpts.map((excerpt) => ({
        quote: excerpt.quote,
        thought: excerpt.thought,
        starred: excerpt.starred,
      })),
      links: record.links,
      imageIds: record.images.map((image) => image.id),
    }),
  )
  record.images.forEach((image) => {
    imagePreviews[image.id] = image.url
  })
}

async function loadTopics(): Promise<void> {
  try {
    const overview = await getTopicOverview()
    const choices: TopicChoice[] = [{ id: null, label: '不选主题' }]
    overview.categories.forEach((category) => {
      category.topics.forEach((topic) => {
        choices.push({ id: topic.id, label: `${category.name} / ${topic.name}` })
      })
    })
    overview.uncategorized.forEach((topic) => {
      choices.push({ id: topic.id, label: `未分类 / ${topic.name}` })
    })
    topicChoices.value = choices
  } catch (error) {
    showToast(messageOf(error))
  }
}

async function initialize(options: Record<string, string | undefined>): Promise<void> {
  recordId.value = options.id || null
  const key = draftKeyFor(recordId.value ?? undefined)
  const stored = loadDraft(key)

  try {
    if (stored) {
      Object.assign(draft, normalizeDraft(stored))
      if (recordId.value) {
        const record = await getRecord(recordId.value)
        record.images.forEach((image) => {
          imagePreviews[image.id] = image.url
        })
      }
    } else if (recordId.value) {
      fillFromRecord(await getRecord(recordId.value))
    } else {
      Object.assign(draft, emptyDraft(todayLocal()))
      if (options.topicId) draft.topicId = options.topicId
    }
  } catch (error) {
    showToast(messageOf(error))
  } finally {
    hydrated.value = true
  }

  await loadTopics()
}

onLoad((options) => {
  void initialize(options ?? {})
})

function messageOf(error: unknown): string {
  return error instanceof Error && error.message ? error.message : '操作失败'
}

function showToast(title: string): void {
  uni.showToast({ title, icon: 'none' })
}

function persistDraft(): void {
  if (!hydrated.value || saved.value) return
  saveDraft(draftKey.value, normalizeDraft(draft))
}

function scheduleDraftSave(): void {
  if (!hydrated.value || saved.value) return
  if (draftTimer) clearTimeout(draftTimer)
  draftTimer = setTimeout(() => {
    draftTimer = null
    persistDraft()
  }, 800)
}

watch(draft, scheduleDraftSave, { deep: true })

onUnload(() => {
  if (draftTimer) {
    clearTimeout(draftTimer)
    draftTimer = null
  }
  persistDraft()
})

function changeTopic(event: { detail: { value: string | number } }): void {
  const index = Number(event.detail.value)
  draft.topicId = topicChoices.value[index]?.id ?? null
}

function changeDate(event: { detail: { value: string | number } }): void {
  draft.recordDate = String(event.detail.value)
}

function addExcerpt(): void {
  draft.excerpts.push({ quote: '', thought: '', starred: false })
}

function removeExcerpt(index: number): void {
  draft.excerpts.splice(index, 1)
}

function changeStar(index: number, event: Event): void {
  const excerpt = draft.excerpts[index]
  const detail = (event as Event & { detail?: { value?: boolean } }).detail
  if (excerpt) excerpt.starred = Boolean(detail?.value)
}

function appendHashtag(): void {
  draft.body += '#'
  showToast('已在正文末尾插入 #')
}

function addLink(): void {
  if (draft.links.length >= 10) {
    showToast('链接不能超过 10 条')
    return
  }
  draft.links.push('')
}

function removeLink(index: number): void {
  draft.links.splice(index, 1)
}

function chooseImages(): void {
  if (!canAddImage.value) {
    showToast(uploading.value ? '图片正在上传' : '图片不能超过 9 张')
    return
  }

  const remaining = 9 - draft.imageIds.length
  uni.chooseImage({
    count: remaining,
    sizeType: ['compressed'],
    sourceType: ['album', 'camera'],
    success: (result) => {
      const paths = Array.isArray(result.tempFilePaths)
        ? result.tempFilePaths
        : [result.tempFilePaths]
      void uploadImages(paths)
    },
    fail: (error) => {
      const message = error.errMsg || ''
      if (!message.includes('cancel')) showToast(message || '选择图片失败')
    },
  })
}

async function uploadImages(paths: string[]): Promise<void> {
  for (const path of paths) {
    uploading.value += 1
    try {
      const uploaded = await uploadImageApi(path)
      if (!draft.imageIds.includes(uploaded.id)) draft.imageIds.push(uploaded.id)
      imagePreviews[uploaded.id] = uploaded.url
      if (uploaded.status !== 'ok') showToast('图片正在处理中，请稍后再试')
    } catch (error) {
      showToast(messageOf(error))
    } finally {
      uploading.value -= 1
    }
  }
}

function removeImage(index: number): void {
  const [id] = draft.imageIds.splice(index, 1)
  if (id) delete imagePreviews[id]
}

function previewImage(id: string): void {
  const urls = draft.imageIds
    .map((imageId) => imagePreviews[imageId])
    .filter((url): url is string => Boolean(url))
  const current = imagePreviews[id]
  if (current && urls.length) uni.previewImage({ urls, current })
}

function cancelEditor(): void {
  if (draftTimer) {
    clearTimeout(draftTimer)
    draftTimer = null
  }
  persistDraft()
  showToast('草稿已保存')
  setTimeout(() => uni.navigateBack(), 350)
}

function handleSaveError(error: unknown): void {
  const message = messageOf(error)
  if (
    error instanceof ApiError &&
    (error.code === 'CONTENT_REJECTED' || error.code === 'CHECK_UNAVAILABLE')
  ) {
    uni.showModal({
      title: '保存失败',
      content: `${message}\n\n内容已保存在草稿里`,
      showCancel: false,
    })
    return
  }
  showToast(message)
}

async function save(): Promise<void> {
  if (saving.value) return
  const validationMessage = validateDraft(draft)
  if (validationMessage) {
    showToast(validationMessage)
    return
  }

  saving.value = true
  try {
    const input = buildRecordInput(draft)
    if (recordId.value) {
      await updateRecord(recordId.value, input)
    } else {
      await createRecord(input)
    }

    saved.value = true
    if (draftTimer) {
      clearTimeout(draftTimer)
      draftTimer = null
    }
    clearDraft(draftKey.value)
    uni.showToast({ title: '已保存', icon: 'success' })
    setTimeout(() => uni.navigateBack(), 350)
  } catch (error) {
    handleSaveError(error)
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <view class="editor-page">
    <view class="editor-header">
      <button class="editor-header__action" @click="cancelEditor">取消</button>
      <text class="editor-header__title">{{ pageTitle }}</text>
      <button
        class="editor-header__action editor-header__save"
        :disabled="saving || !hydrated"
        @click="save"
      >
        {{ saving ? '保存中' : '保存' }}
      </button>
    </view>

    <view v-if="!hydrated" class="loading-state">
      <text>正在加载…</text>
    </view>

    <scroll-view v-else class="editor-scroll" scroll-y>
      <view class="form-card meta-row">
        <picker
          class="meta-picker"
          mode="selector"
          :range="topicLabels"
          :value="topicPickerIndex"
          @change="changeTopic"
        >
          <view class="meta-picker__content">
            <text class="meta-picker__label">主题</text>
            <text class="meta-picker__value">{{ topicLabels[topicPickerIndex] }}</text>
            <text class="meta-picker__arrow">›</text>
          </view>
        </picker>
        <picker
          class="meta-picker"
          mode="date"
          :value="draft.recordDate"
          @change="changeDate"
        >
          <view class="meta-picker__content">
            <text class="meta-picker__label">日期</text>
            <text class="meta-picker__value">{{ draft.recordDate }}</text>
            <text class="meta-picker__arrow">›</text>
          </view>
        </picker>
      </view>

      <view class="form-card body-card">
        <textarea
          v-model="draft.body"
          class="body-input"
          auto-height
          maxlength="-1"
          placeholder="写点什么…"
        />
      </view>

      <view
        v-for="(excerpt, index) in draft.excerpts"
        :key="index"
        class="excerpt-card"
      >
        <view class="excerpt-card__header">
          <text class="excerpt-card__title">摘抄 {{ index + 1 }}</text>
          <view class="excerpt-card__star">
            <text>★</text>
            <switch
              :checked="excerpt.starred"
              color="#f0a020"
              @change="changeStar(index, $event)"
            />
          </view>
        </view>
        <textarea
          v-model="excerpt.quote"
          class="excerpt-input"
          auto-height
          maxlength="-1"
          placeholder="摘抄原文"
        />
        <textarea
          v-model="excerpt.thought"
          class="excerpt-input excerpt-input--thought"
          auto-height
          maxlength="-1"
          placeholder="我的想法"
        />
        <button class="text-button text-button--danger" @click="removeExcerpt(index)">
          删除
        </button>
      </view>

      <button class="outline-button" @click="addExcerpt">＋ 添加一段摘抄</button>

      <view class="form-card image-section">
        <view class="section-title-row">
          <text class="section-title">图片</text>
          <text class="section-hint">{{ draft.imageIds.length }}/9</text>
        </view>
        <view class="image-grid">
          <view
            v-for="(imageId, index) in draft.imageIds"
            :key="imageId"
            class="image-item"
          >
            <image
              v-if="imagePreviews[imageId]"
              class="image-thumb"
              :src="imagePreviews[imageId] || ''"
              mode="aspectFill"
              @click="previewImage(imageId)"
            />
            <view v-else class="image-thumb image-thumb--pending">
              <text>已上传</text>
            </view>
            <button class="image-remove" @click="removeImage(index)">×</button>
          </view>
          <button v-if="draft.imageIds.length < 9" class="image-add" @click="chooseImages">
            <text v-if="uploading === 0" class="image-add__plus">＋</text>
            <text v-else class="image-add__loading">上传中</text>
            <text v-if="uploading === 0" class="image-add__label">添加图片</text>
          </button>
        </view>
      </view>

      <view class="form-card">
        <view class="section-title-row">
          <text class="section-title">链接</text>
          <button class="text-button" @click="addLink">＋ 添加链接</button>
        </view>
        <view v-if="draft.links.length === 0" class="section-empty">暂无链接</view>
        <view v-for="(link, index) in draft.links" :key="index" class="link-row">
          <input
            v-model="draft.links[index]"
            class="link-input"
            type="text"
            placeholder="https://"
          />
          <button class="link-remove" @click="removeLink(index)">删除</button>
        </view>
      </view>

      <view class="toolbar">
        <button class="toolbar__button" @click="addExcerpt">
          <text class="toolbar__icon">❝</text>
          <text>摘抄</text>
        </button>
        <button class="toolbar__button" @click="appendHashtag">
          <text class="toolbar__icon">#</text>
          <text>标签</text>
        </button>
        <button class="toolbar__button" @click="chooseImages">
          <text class="toolbar__icon">▧</text>
          <text>图片</text>
        </button>
        <button class="toolbar__button" @click="addLink">
          <text class="toolbar__icon">↗</text>
          <text>链接</text>
        </button>
      </view>

      <view class="safe-area" />
    </scroll-view>
  </view>
</template>

<style scoped>
.editor-page {
  min-height: 100vh;
  background: var(--color-bg);
}

.editor-header {
  position: sticky;
  z-index: 10;
  top: 0;
  display: flex;
  height: 96rpx;
  align-items: center;
  justify-content: space-between;
  padding: 0 24rpx;
  background: #ffffff;
  border-bottom: 1rpx solid var(--color-border);
}

.editor-header__title {
  color: var(--color-text);
  font-size: 32rpx;
  font-weight: 600;
}

.editor-header__action {
  min-width: 112rpx;
  margin: 0;
  padding: 0;
  background: transparent;
  color: var(--color-muted);
  font-size: 28rpx;
  line-height: 72rpx;
  text-align: left;
}

.editor-header__save {
  color: var(--color-primary);
  font-weight: 600;
  text-align: right;
}

.editor-header__action[disabled] {
  opacity: 0.45;
}

.editor-scroll {
  height: calc(100vh - 96rpx);
}

.loading-state {
  display: flex;
  height: 60vh;
  align-items: center;
  justify-content: center;
  color: var(--color-muted);
}

.form-card,
.excerpt-card {
  margin: 20rpx 24rpx;
  padding: 24rpx 28rpx;
  border-radius: 22rpx;
  background: #ffffff;
  box-shadow: 0 6rpx 22rpx rgba(0, 0, 0, 0.04);
}

.meta-row {
  display: flex;
  gap: 18rpx;
  padding: 8rpx 12rpx;
}

.meta-picker {
  min-width: 0;
  flex: 1;
}

.meta-picker__content {
  display: flex;
  min-height: 88rpx;
  align-items: center;
  padding: 0 16rpx;
}

.meta-picker__label {
  flex: none;
  margin-right: 14rpx;
  color: var(--color-muted);
  font-size: 24rpx;
}

.meta-picker__value {
  min-width: 0;
  flex: 1;
  overflow: hidden;
  color: var(--color-text);
  font-size: 26rpx;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.meta-picker__arrow {
  margin-left: 8rpx;
  color: #bbbbbb;
  font-size: 34rpx;
}

.body-card {
  padding: 20rpx 24rpx;
}

.body-input {
  width: 100%;
  min-height: 300rpx;
  color: var(--color-text);
  font-size: 30rpx;
  line-height: 1.7;
}

.excerpt-card {
  padding-bottom: 18rpx;
}

.excerpt-card__header,
.section-title-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.excerpt-card__header {
  margin-bottom: 12rpx;
}

.excerpt-card__title,
.section-title {
  color: var(--color-text);
  font-size: 28rpx;
  font-weight: 600;
}

.excerpt-card__star {
  display: flex;
  align-items: center;
  gap: 8rpx;
  color: var(--color-star);
  font-size: 30rpx;
}

.excerpt-card__star switch {
  transform: scale(0.75);
}

.excerpt-input {
  width: 100%;
  min-height: 100rpx;
  padding: 16rpx 0;
  border-bottom: 1rpx solid var(--color-border);
  color: #333333;
  font-size: 28rpx;
  line-height: 1.6;
}

.excerpt-input--thought {
  color: var(--color-muted);
  font-size: 26rpx;
}

.text-button {
  display: inline-flex;
  min-width: 0;
  margin: 0;
  padding: 8rpx 0;
  background: transparent;
  color: var(--color-primary);
  font-size: 24rpx;
  line-height: 1.4;
}

.text-button--danger {
  margin-top: 10rpx;
  color: #d94b4b;
}

.outline-button {
  margin: 20rpx 24rpx;
  border: 1rpx dashed var(--color-primary);
  border-radius: 20rpx;
  background: rgba(7, 193, 96, 0.04);
  color: var(--color-primary);
  font-size: 26rpx;
  line-height: 84rpx;
}

.section-title-row {
  min-height: 52rpx;
}

.section-hint {
  color: var(--color-muted);
  font-size: 22rpx;
}

.image-grid {
  display: flex;
  flex-wrap: wrap;
  gap: 16rpx;
  margin-top: 18rpx;
}

.image-item,
.image-thumb,
.image-add {
  position: relative;
  width: 166rpx;
  height: 166rpx;
  border-radius: 14rpx;
}

.image-thumb {
  display: block;
}

.image-thumb--pending {
  display: flex;
  align-items: center;
  justify-content: center;
  background: #f1f1f1;
  color: var(--color-muted);
  font-size: 22rpx;
}

.image-remove {
  position: absolute;
  top: -10rpx;
  right: -10rpx;
  width: 42rpx;
  height: 42rpx;
  margin: 0;
  padding: 0;
  border-radius: 21rpx;
  background: rgba(0, 0, 0, 0.65);
  color: #ffffff;
  font-size: 28rpx;
  line-height: 38rpx;
}

.image-add {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  border: 1rpx dashed #cccccc;
  background: #fafafa;
  color: var(--color-muted);
}

.image-add__plus {
  font-size: 56rpx;
  line-height: 1;
}

.image-add__label,
.image-add__loading {
  margin-top: 10rpx;
  font-size: 22rpx;
}

.section-empty {
  padding: 24rpx 0 8rpx;
  color: var(--color-muted);
  font-size: 24rpx;
}

.link-row {
  display: flex;
  align-items: center;
  gap: 12rpx;
  padding-top: 18rpx;
}

.link-input {
  min-width: 0;
  height: 72rpx;
  flex: 1;
  padding: 0 18rpx;
  border-radius: 12rpx;
  background: #f5f5f5;
  color: var(--color-text);
  font-size: 24rpx;
}

.link-remove {
  min-width: 92rpx;
  margin: 0;
  padding: 0;
  background: transparent;
  color: #d94b4b;
  font-size: 22rpx;
  line-height: 64rpx;
}

.toolbar {
  display: flex;
  margin: 32rpx 24rpx 0;
  padding: 12rpx 0;
  border-radius: 22rpx;
  background: #ffffff;
  box-shadow: 0 6rpx 22rpx rgba(0, 0, 0, 0.04);
}

.toolbar__button {
  display: flex;
  min-width: 0;
  flex: 1;
  flex-direction: column;
  align-items: center;
  gap: 4rpx;
  margin: 0;
  padding: 10rpx 0;
  background: transparent;
  color: var(--color-muted);
  font-size: 21rpx;
  line-height: 1.4;
}

.toolbar__icon {
  color: var(--color-primary);
  font-size: 34rpx;
  line-height: 1.2;
}

.safe-area {
  height: calc(72rpx + env(safe-area-inset-bottom));
}
</style>