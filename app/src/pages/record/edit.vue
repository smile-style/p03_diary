<script setup lang="ts">
import { onLoad, onUnload } from '@dcloudio/uni-app'
import { computed, reactive, ref, watch } from 'vue'
import { ApiError } from '../../api/client'
import AppIcon from '../../components/AppIcon.vue'
import AppShell from '../../components/AppShell.vue'
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
  <AppShell
    active="timeline"
    :title="pageTitle"
    eyebrow="写作"
    description="先写下来，再慢慢整理成可以回看的样子。"
    back
  >
    <template #actions>
      <button class="app-button app-button--ghost" @click="cancelEditor">取消</button>
      <button
        class="app-button app-button--primary"
        :disabled="saving || !hydrated"
        @click="save"
      >
        {{ saving ? '保存中…' : '保存记录' }}
      </button>
    </template>

    <view v-if="!hydrated" class="page-state">
      <text class="page-state__title">正在准备这张纸</text>
      <text class="page-state__message">草稿与主题信息马上就好。</text>
    </view>

    <scroll-view v-else class="page-scroll" scroll-y>
      <view class="editor-inner">
        <view class="editor-layout">
          <view class="editor-main">
            <view class="writing-card">
              <view class="card-heading">
                <view>
                  <text class="card-heading__eyebrow">TODAY</text>
                  <text class="card-heading__title">写点什么</text>
                </view>
                <text class="card-heading__meta">{{ draft.recordDate }}</text>
              </view>

              <textarea
                v-model="draft.body"
                class="body-input"
                auto-height
                maxlength="-1"
                placeholder="今天发生了什么，或者此刻在想什么…"
              />

              <view class="editor-toolbar">
                <button class="toolbar__button" @click="addExcerpt">
                  <AppIcon name="quote" />
                  <text>摘抄</text>
                </button>
                <button class="toolbar__button" @click="appendHashtag">
                  <text class="toolbar__hash">#</text>
                  <text>标签</text>
                </button>
                <button class="toolbar__button" @click="chooseImages">
                  <AppIcon name="image" />
                  <text>图片</text>
                </button>
                <button class="toolbar__button" @click="addLink">
                  <AppIcon name="link" />
                  <text>链接</text>
                </button>
              </view>
            </view>

            <view v-if="draft.excerpts.length" class="excerpt-section">
              <view class="section-heading">
                <view>
                  <text class="section-heading__eyebrow">EXCERPTS</text>
                  <text class="section-heading__title">摘抄与想法</text>
                </view>
                <text class="section-heading__count">{{ draft.excerpts.length }} 段</text>
              </view>

              <view
                v-for="(excerpt, index) in draft.excerpts"
                :key="index"
                class="excerpt-card"
                :class="{ 'excerpt-card--starred': excerpt.starred }"
              >
                <view class="excerpt-card__header">
                  <text class="excerpt-card__title">摘抄 {{ index + 1 }}</text>
                  <view class="excerpt-card__star">
                    <AppIcon name="star" />
                    <switch
                      :checked="excerpt.starred"
                      color="#b45309"
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
                  删除这段摘抄
                </button>
              </view>
            </view>

            <button class="add-excerpt-button" @click="addExcerpt">
              <AppIcon name="plus" />
              添加一段摘抄
            </button>
          </view>

          <view class="editor-side">
            <view class="side-card">
              <view class="side-card__heading">
                <text class="side-card__eyebrow">DETAILS</text>
                <text class="side-card__title">记录信息</text>
              </view>

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
                  <AppIcon class="meta-picker__arrow" name="chevron-right" />
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
                  <AppIcon class="meta-picker__arrow" name="chevron-right" />
                </view>
              </picker>
            </view>

            <view class="side-card">
              <view class="side-card__heading side-card__heading--row">
                <view>
                  <text class="side-card__eyebrow">IMAGES</text>
                  <text class="side-card__title">图片</text>
                </view>
                <text class="side-card__meta">{{ draft.imageIds.length }}/9</text>
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
                  <button class="image-remove" aria-label="移除图片" @click="removeImage(index)">
                    <AppIcon name="close" />
                  </button>
                </view>

                <button v-if="draft.imageIds.length < 9" class="image-add" @click="chooseImages">
                  <AppIcon v-if="uploading === 0" name="plus" />
                  <text v-if="uploading === 0" class="image-add__label">添加图片</text>
                  <text v-else class="image-add__loading">上传中</text>
                </button>
              </view>
            </view>

            <view class="side-card">
              <view class="side-card__heading side-card__heading--row">
                <view>
                  <text class="side-card__eyebrow">LINKS</text>
                  <text class="side-card__title">相关链接</text>
                </view>
                <button class="text-button" @click="addLink">添加链接</button>
              </view>

              <view v-if="draft.links.length === 0" class="section-empty">
                暂时没有链接
              </view>
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
          </view>
        </view>
      </view>
    </scroll-view>
  </AppShell>
</template>

<style scoped>
.editor-inner {
  width: 100%;
  max-width: 1120px;
  margin: 0 auto;
  padding: 30px 42px 60px;
}

.editor-layout {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 306px;
  align-items: start;
  gap: 22px;
}

.editor-main,
.editor-side {
  display: flex;
  min-width: 0;
  flex-direction: column;
  gap: 14px;
}

.writing-card,
.excerpt-card,
.side-card,
.add-excerpt-button {
  border: 1px solid var(--color-border);
  border-radius: var(--radius-card);
  background: var(--color-surface);
  box-shadow: var(--shadow-soft);
}

.writing-card {
  padding: 26px 28px 18px;
}

.card-heading,
.section-heading {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
  margin-bottom: 20px;
  padding-bottom: 15px;
  border-bottom: 1px solid var(--color-border);
}

.card-heading__eyebrow,
.section-heading__eyebrow,
.side-card__eyebrow {
  display: block;
  color: var(--color-accent);
  font-size: 9px;
  font-weight: 700;
  letter-spacing: 0.17em;
}

.card-heading__title,
.section-heading__title,
.side-card__title {
  display: block;
  margin-top: 4px;
  color: var(--color-ink);
  font-family: var(--font-display);
  font-size: 20px;
  font-weight: 700;
}

.card-heading__meta,
.section-heading__count,
.side-card__meta {
  color: var(--color-muted);
  font-size: 10px;
  letter-spacing: 0.06em;
}

.body-input {
  width: 100%;
  min-height: 380px;
  color: var(--color-text);
  font-size: 16px;
  line-height: 1.95;
}

.editor-toolbar {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-top: 16px;
  padding-top: 14px;
  border-top: 1px solid var(--color-border);
}

.toolbar__button {
  position: relative;
  display: inline-flex;
  min-height: 34px;
  align-items: center;
  gap: 7px;
  margin: 0;
  padding: 0 11px;
  border: 1px solid var(--color-border);
  border-radius: 10px;
  background: var(--color-surface-muted);
  color: var(--color-muted-strong);
  font-size: 10px;
}

.toolbar__button::after {
  position: absolute;
  inset: -5px;
  content: '';
}

.toolbar__button:hover {
  border-color: var(--color-border-strong);
  color: var(--color-accent);
}

.toolbar__button .app-icon {
  width: 13px;
  height: 13px;
}

.toolbar__hash {
  color: var(--color-accent);
  font-family: var(--font-display);
  font-size: 15px;
  font-weight: 700;
}

.excerpt-section {
  display: flex;
  flex-direction: column;
  gap: 12px;
  margin-top: 8px;
}

.excerpt-card {
  padding: 20px 22px;
}

.excerpt-card--starred {
  border-left: 3px solid var(--color-star);
}

.excerpt-card__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 14px;
  margin-bottom: 8px;
}

.excerpt-card__title {
  color: var(--color-ink);
  font-family: var(--font-display);
  font-size: 16px;
  font-weight: 700;
}

.excerpt-card__star {
  display: flex;
  align-items: center;
  gap: 7px;
  color: var(--color-star);
}

.excerpt-card__star .app-icon {
  width: 12px;
  height: 12px;
}

.excerpt-card__star switch {
  transform: scale(0.72);
  transform-origin: right center;
}

.excerpt-input {
  width: 100%;
  min-height: 70px;
  padding: 12px 0;
  border-bottom: 1px solid var(--color-border);
  color: var(--color-text);
  font-family: var(--font-display);
  font-size: 15px;
  line-height: 1.7;
}

.excerpt-input--thought {
  color: var(--color-muted);
  font-family: var(--font-ui);
  font-size: 12px;
}

.text-button {
  position: relative;
  display: inline-flex;
  min-height: 32px;
  align-items: center;
  margin: 8px 0 0;
  padding: 0 7px;
  border: 0;
  border-radius: 8px;
  background: transparent;
  color: var(--color-accent);
  font-size: 10px;
}

.text-button::after {
  position: absolute;
  inset: -6px;
  content: '';
}

.text-button:hover {
  background: var(--color-accent-soft);
}

.text-button--danger {
  color: var(--color-danger);
}

.text-button--danger:hover {
  background: var(--color-danger-soft);
}

.add-excerpt-button {
  display: flex;
  min-height: 48px;
  align-items: center;
  justify-content: center;
  gap: 8px;
  margin: 0;
  border-style: dashed;
  color: var(--color-accent);
  font-size: 11px;
}

.add-excerpt-button:hover {
  background: var(--color-accent-soft);
}

.add-excerpt-button .app-icon {
  width: 13px;
  height: 13px;
}

.side-card {
  padding: 20px;
}

.side-card__heading {
  margin-bottom: 12px;
  padding-bottom: 13px;
  border-bottom: 1px solid var(--color-border);
}

.side-card__heading--row {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
}

.meta-picker {
  display: block;
}

.meta-picker__content {
  display: flex;
  min-height: 48px;
  align-items: center;
  gap: 10px;
  border-bottom: 1px solid var(--color-border);
}

.meta-picker:last-child .meta-picker__content {
  border-bottom: 0;
}

.meta-picker__label {
  width: 34px;
  flex: none;
  color: var(--color-muted);
  font-size: 10px;
}

.meta-picker__value {
  min-width: 0;
  flex: 1;
  overflow: hidden;
  color: var(--color-text);
  font-size: 11px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.meta-picker__arrow {
  width: 13px;
  height: 13px;
  color: var(--color-muted);
}

.image-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 9px;
}

.image-item,
.image-thumb,
.image-add {
  position: relative;
  width: 100%;
  aspect-ratio: 1;
  border-radius: 11px;
}

.image-thumb {
  height: 100%;
  background: var(--color-surface-muted);
}

.image-thumb--pending {
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--color-muted);
  font-size: 9px;
}

.image-remove {
  position: absolute;
  top: 5px;
  right: 5px;
  display: flex;
  width: 25px;
  height: 25px;
  align-items: center;
  justify-content: center;
  margin: 0;
  padding: 0;
  border: 0;
  border-radius: 50%;
  background: rgba(38, 33, 25, 0.72);
  color: #ffffff;
}

.image-remove::after {
  position: absolute;
  inset: -10px;
  content: '';
}

.image-remove .app-icon {
  width: 11px;
  height: 11px;
}

.image-add {
  display: flex;
  min-height: 92px;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 6px;
  margin: 0;
  padding: 0;
  border: 1px dashed var(--color-border-strong);
  background: var(--color-surface-muted);
  color: var(--color-muted);
  font-size: 9px;
}

.image-add:hover {
  border-color: var(--color-accent);
  color: var(--color-accent);
}

.image-add .app-icon {
  width: 16px;
  height: 16px;
}

.section-empty {
  padding: 18px 0;
  color: var(--color-muted);
  font-size: 10px;
  text-align: center;
}

.link-row {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 7px 0;
  border-bottom: 1px solid var(--color-border);
}

.link-row:last-child {
  border-bottom: 0;
}

.link-input {
  min-width: 0;
  height: 36px;
  flex: 1;
  padding: 0 9px;
  border: 1px solid var(--color-border);
  border-radius: 8px;
  background: var(--color-surface-muted);
  color: var(--color-text);
  font-size: 10px;
}

.link-remove {
  min-height: 32px;
  margin: 0;
  padding: 0 5px;
  border: 0;
  background: transparent;
  color: var(--color-danger);
  font-size: 9px;
}

@media (max-width: 950px) {
  .editor-layout {
    grid-template-columns: 1fr;
  }

  .editor-side {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .editor-side .side-card:last-child {
    grid-column: 1 / -1;
  }
}

@media (max-width: 980px) {
  .editor-inner {
    padding-right: 28px;
    padding-left: 28px;
  }
}

@media (max-width: 699px) {
  .editor-inner {
    padding: 18px 16px 38px;
  }

  .writing-card {
    padding: 20px;
  }

  .body-input {
    min-height: 300px;
    font-size: 15px;
  }

  .editor-side {
    display: flex;
  }

  .excerpt-card {
    padding: 17px;
  }
}
</style>
