<script setup lang="ts">
import { computed } from 'vue'
import type { RecordView } from '../api/types'
import { formatDateLabel } from '../utils/date'
import AppIcon from './AppIcon.vue'

const props = withDefaults(
  defineProps<{
    record: RecordView
    readonly?: boolean
    showDate?: boolean
  }>(),
  {
    readonly: false,
    showDate: true,
  },
)

const dateLabel = computed(() => formatDateLabel(props.record.recordDate))
const dateParts = computed(() => {
  const [, month = '1', day = '1'] = props.record.recordDate.split('-')
  return {
    day: String(Number(day)),
    month: `${Number(month)}月`,
  }
})
const visibleExcerpts = computed(() => props.record.excerpts.slice(0, 2))
const visibleImages = computed(() =>
  props.record.images.filter((image) => image.status !== 'rejected'),
)

function openDetail() {
  if (props.readonly) return
  uni.navigateTo({ url: `/pages/record/detail?id=${encodeURIComponent(props.record.id)}` })
}

function handleCardKey(event: KeyboardEvent) {
  if (event.key === 'Enter' || event.key === ' ') openDetail()
}

function openTopic() {
  if (props.readonly || !props.record.topic) return
  uni.navigateTo({
    url: `/pages/topic/detail?id=${encodeURIComponent(props.record.topic.id)}`,
  })
}

function openTag(name: string) {
  if (props.readonly) return
  uni.navigateTo({ url: `/pages/tag/detail?name=${encodeURIComponent(name)}` })
}

function previewImage(url: string) {
  const urls = visibleImages.value
    .filter((image) => image.status === 'ok' && image.url)
    .map((image) => image.url as string)
  if (urls.length) uni.previewImage({ urls, current: url })
}
</script>

<template>
  <view
    class="record-card"
    :class="{
      'record-card--readonly': readonly,
      'record-card--no-date': !showDate,
    }"
    :role="readonly ? undefined : 'button'"
    :tabindex="readonly ? undefined : 0"
    :aria-label="readonly ? undefined : `查看 ${dateLabel} 的记录`"
    @click="openDetail"
    @keydown.enter="handleCardKey"
    @keydown.space.prevent="handleCardKey"
  >
    <view v-if="showDate" class="record-card__date-column" aria-hidden="true">
      <text class="record-card__day">{{ dateParts.day }}</text>
      <text class="record-card__month">{{ dateParts.month }}</text>
      <text class="record-card__date-label">{{ dateLabel }}</text>
    </view>

    <view class="record-card__content">
      <view class="record-card__meta">
        <text v-if="showDate" class="record-card__eyebrow">当天的记录</text>
        <text v-else class="record-card__eyebrow">这一天</text>
        <button
          v-if="record.topic"
          class="record-card__topic"
          :disabled="readonly"
          @click.stop="openTopic"
        >
          {{ record.topic.name }}
        </button>
      </view>

      <text v-if="record.body" class="record-card__body">{{ record.body }}</text>
      <text v-else class="record-card__placeholder">这条记录没有正文</text>

      <view v-if="visibleExcerpts.length" class="record-card__excerpts">
        <view
          v-for="(excerpt, index) in visibleExcerpts"
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

      <view v-if="record.tags.length" class="record-card__tags">
        <button
          v-for="tag in record.tags"
          :key="tag"
          class="tag-pill"
          :disabled="readonly"
          @click.stop="openTag(tag)"
        >
          #{{ tag }}
        </button>
      </view>

      <view v-if="visibleImages.length" class="record-card__images">
        <view
          v-for="(image, index) in visibleImages"
          :key="image.id || index"
          class="record-card__image-wrap"
        >
          <image
            v-if="image.status === 'ok' && image.url"
            class="record-card__image"
            :src="image.url"
            mode="aspectFill"
            @click.stop="previewImage(image.url)"
          />
          <view v-else class="record-card__image-placeholder">
            <AppIcon name="image" />
            <text>处理中</text>
          </view>
        </view>
        <text class="record-card__image-count">{{ visibleImages.length }} 张图片</text>
      </view>
    </view>
  </view>
</template>

<style scoped>
.record-card {
  display: grid;
  grid-template-columns: 82px minmax(0, 1fr);
  gap: 24px;
  padding: 22px 24px;
  border: 1px solid var(--color-border);
  border-radius: 16px;
  background: var(--color-surface);
  box-shadow: var(--shadow-soft);
  cursor: pointer;
  transition:
    border-color 180ms ease,
    box-shadow 180ms ease,
    transform 180ms ease;
  animation: surface-rise 320ms ease both;
}

.record-card:hover {
  border-color: var(--color-border-strong);
  box-shadow: var(--shadow-card);
  transform: translateY(-2px);
}

.record-card:focus-visible {
  outline: 2px solid var(--color-focus);
  outline-offset: 3px;
}

.record-card--readonly {
  cursor: default;
}

.record-card--readonly:hover {
  border-color: var(--color-border);
  box-shadow: var(--shadow-soft);
  transform: none;
}

.record-card--no-date {
  grid-template-columns: minmax(0, 1fr);
}

.record-card__date-column {
  display: flex;
  min-height: 92px;
  flex-direction: column;
  align-items: center;
  justify-content: flex-start;
  padding: 2px 18px 0 0;
  border-right: 1px solid var(--color-border);
}

.record-card__day {
  color: var(--color-ink);
  font-family: var(--font-display);
  font-size: 34px;
  font-weight: 700;
  line-height: 1;
}

.record-card__month {
  margin-top: 5px;
  color: var(--color-accent);
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.12em;
}

.record-card__date-label {
  margin-top: 9px;
  color: var(--color-muted);
  font-size: 9px;
  letter-spacing: 0.05em;
}

.record-card__content {
  min-width: 0;
}

.record-card__meta {
  display: flex;
  min-height: 24px;
  align-items: center;
  justify-content: space-between;
  gap: 14px;
  margin-bottom: 10px;
}

.record-card__eyebrow {
  color: var(--color-muted);
  font-size: 10px;
  letter-spacing: 0.12em;
}

.record-card__topic {
  position: relative;
  max-width: 45%;
  min-height: 28px;
  margin: 0;
  padding: 0 10px;
  overflow: hidden;
  border: 1px solid color-mix(in srgb, var(--color-accent) 18%, transparent);
  border-radius: 999px;
  background: var(--color-accent-soft);
  color: var(--color-accent);
  font-size: 11px;
  font-weight: 600;
  line-height: 26px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.record-card__topic:hover {
  border-color: color-mix(in srgb, var(--color-accent) 38%, transparent);
}

.record-card__body {
  display: -webkit-box;
  overflow: hidden;
  color: var(--color-text);
  font-size: 15px;
  line-height: 1.8;
  white-space: pre-wrap;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 3;
}

.record-card__placeholder {
  color: var(--color-muted);
  font-size: 13px;
}

.record-card__excerpts {
  display: flex;
  flex-direction: column;
  gap: 9px;
  margin-top: 17px;
}

.excerpt {
  padding: 13px 15px;
  border-left: 2px solid var(--color-border-strong);
  border-radius: 0 10px 10px 0;
  background: var(--color-surface-muted);
}

.excerpt--starred {
  border-left-color: var(--color-star);
  background: var(--color-star-soft);
}

.excerpt__quote-row {
  display: flex;
  align-items: flex-start;
  gap: 8px;
}

.excerpt__star {
  width: 12px;
  height: 12px;
  margin-top: 5px;
  color: var(--color-star);
}

.excerpt__quote {
  min-width: 0;
  flex: 1;
  color: var(--color-text);
  font-family: var(--font-display);
  font-size: 14px;
  line-height: 1.7;
}

.excerpt__thought {
  display: block;
  margin-top: 6px;
  padding-left: 20px;
  color: var(--color-muted);
  font-size: 12px;
  line-height: 1.65;
}

.record-card__tags {
  display: flex;
  flex-wrap: wrap;
  gap: 7px;
  margin-top: 15px;
}

.tag-pill {
  position: relative;
  min-height: 28px;
  margin: 0;
  padding: 0 10px;
  border: 1px solid var(--color-border);
  border-radius: 999px;
  background: transparent;
  color: var(--color-muted-strong);
  font-size: 11px;
  line-height: 26px;
}

.tag-pill:hover {
  border-color: var(--color-accent);
  color: var(--color-accent);
}

.record-card__topic::after,
.tag-pill::after {
  position: absolute;
  inset: -8px -4px;
  content: '';
}

.record-card__images {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 9px;
  margin-top: 16px;
}

.record-card__image-wrap,
.record-card__image,
.record-card__image-placeholder {
  width: 82px;
  height: 82px;
  border-radius: 11px;
}

.record-card__image-wrap {
  overflow: hidden;
  background: var(--color-surface-muted);
}

.record-card__image {
  width: 100%;
  height: 100%;
}

.record-card__image-placeholder {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 5px;
  color: var(--color-muted);
  font-size: 9px;
}

.record-card__image-count {
  color: var(--color-muted);
  font-size: 10px;
  letter-spacing: 0.06em;
}

@media (max-width: 699px) {
  .record-card {
    grid-template-columns: 58px minmax(0, 1fr);
    gap: 14px;
    padding: 17px;
  }

  .record-card__date-column {
    min-height: 78px;
    padding-right: 11px;
  }

  .record-card__day {
    font-size: 28px;
  }

  .record-card__body {
    font-size: 14px;
  }

  .record-card__excerpts {
    margin-top: 13px;
  }
}
</style>
