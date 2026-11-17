<script setup lang="ts">
import AppIcon from './AppIcon.vue'

withDefaults(
  defineProps<{
    text?: string
    title?: string
  }>(),
  {
    text: '暂无内容',
    title: '这里还是空白',
  },
)
</script>

<template>
  <view class="empty-state">
    <view class="empty-state__mark" aria-hidden="true">
      <AppIcon name="quote" />
    </view>
    <text class="empty-state__title">{{ title }}</text>
    <text class="empty-state__text">{{ text }}</text>
  </view>
</template>

<style scoped>
.empty-state {
  display: flex;
  min-height: 320px;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 10px;
  padding: 48px 24px;
  border: 1px dashed var(--color-border-strong);
  border-radius: var(--radius-card);
  background: color-mix(in srgb, var(--color-surface) 64%, transparent);
  text-align: center;
}

.empty-state__mark {
  display: flex;
  width: 52px;
  height: 52px;
  align-items: center;
  justify-content: center;
  margin-bottom: 4px;
  border-radius: 50%;
  background: var(--color-accent-soft);
  color: var(--color-accent);
}

.empty-state__mark .app-icon {
  width: 22px;
  height: 22px;
}

.empty-state__title {
  color: var(--color-ink);
  font-family: var(--font-display);
  font-size: 20px;
  font-weight: 700;
}

.empty-state__text {
  max-width: 440px;
  color: var(--color-muted);
  font-size: 13px;
  line-height: 1.7;
}

@media (max-width: 699px) {
  .empty-state {
    min-height: 240px;
  }
}
</style>
