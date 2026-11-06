<script setup lang="ts">
import { computed } from 'vue'
import type { RecordView } from '../api/types'
import { formatDateLabel } from '../utils/date'

const props = defineProps<{ record: RecordView }>()

const dateLabel = computed(() => formatDateLabel(props.record.recordDate))
const visibleExcerpts = computed(() => props.record.excerpts.slice(0, 2))
const visibleImages = computed(() =>
  props.record.images.filter((image) => image.status !== 'rejected'),
)

function openDetail() {
  uni.navigateTo({ url: `/pages/record/detail?id=${encodeURIComponent(props.record.id)}` })
}

function openTopic() {
  if (!props.record.topic) return
  uni.navigateTo({
    url: `/pages/topic/detail?id=${encodeURIComponent(props.record.topic.id)}`,
  })
}

function openTag(name: string) {
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
  <view class="record-card" @click="openDetail">
    <view class="record-card__meta">
      <text class="record-card__date">{{ dateLabel }}</text>
      <text v-if="record.topic" class="record-card__topic" @click.stop="openTopic">
        {{ record.topic.name }}
      </text>
    </view>

    <text v-if="record.body" class="record-card__body">{{ record.body }}</text>

    <view v-if="visibleExcerpts.length" class="record-card__excerpts">
      <view
        v-for="(excerpt, index) in visibleExcerpts"
        :key="index"
        class="excerpt"
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

    <view v-if="record.tags.length" class="record-card__tags">
      <text
        v-for="tag in record.tags"
        :key="tag"
        class="tag-pill"
        @click.stop="openTag(tag)"
      >
        #{{ tag }}
      </text>
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
        <view v-else class="record-card__image-placeholder">上传中</view>
      </view>
      <text class="record-card__image-count">{{ visibleImages.length }} 张图片</text>
    </view>
  </view>
</template>

<style scoped>
.record-card {
  margin: 20rpx 24rpx;
  padding: 28rpx;
  border-radius: 24rpx;
  background: #ffffff;
  box-shadow: 0 6rpx 24rpx rgba(0, 0, 0, 0.05);
}

.record-card__meta {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 18rpx;
}

.record-card__date {
  color: var(--color-muted);
  font-size: 24rpx;
}

.record-card__topic {
  padding: 8rpx 16rpx;
  border-radius: 20rpx;
  background: rgba(7, 193, 96, 0.1);
  color: var(--color-primary);
  font-size: 24rpx;
}

.record-card__body {
  display: -webkit-box;
  overflow: hidden;
  color: var(--color-text);
  font-size: 30rpx;
  line-height: 1.65;
  white-space: pre-wrap;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
}

.record-card__excerpts {
  margin-top: 20rpx;
  padding: 18rpx 20rpx;
  border-left: 6rpx solid var(--color-primary);
  border-radius: 8rpx;
  background: #f6fbf8;
}

.excerpt + .excerpt {
  margin-top: 16rpx;
  padding-top: 16rpx;
  border-top: 1rpx solid var(--color-border);
}

.excerpt__quote-row {
  display: flex;
  align-items: flex-start;
}

.excerpt__star {
  margin-right: 8rpx;
  color: var(--color-star);
}

.excerpt__quote {
  flex: 1;
  color: #444444;
  font-size: 26rpx;
  line-height: 1.6;
}

.excerpt__thought {
  display: block;
  margin-top: 8rpx;
  color: var(--color-muted);
  font-size: 24rpx;
  line-height: 1.5;
}

.record-card__tags {
  display: flex;
  flex-wrap: wrap;
  gap: 12rpx;
  margin-top: 20rpx;
}

.tag-pill {
  padding: 6rpx 16rpx;
  border-radius: 20rpx;
  background: #eef8f2;
  color: var(--color-primary);
  font-size: 22rpx;
}

.record-card__images {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 12rpx;
  margin-top: 20rpx;
}

.record-card__image-wrap,
.record-card__image,
.record-card__image-placeholder {
  width: 132rpx;
  height: 132rpx;
  border-radius: 14rpx;
}

.record-card__image-placeholder {
  display: flex;
  align-items: center;
  justify-content: center;
  background: #eeeeee;
  color: var(--color-muted);
  font-size: 20rpx;
}

.record-card__image-count {
  color: var(--color-muted);
  font-size: 22rpx;
}
</style>
