<script setup lang="ts">
withDefaults(defineProps<{ text?: string }>(), {
  text: '暂无内容',
})
</script>

<template>
  <view class="empty-state">
    <text class="empty-state__mark">○</text>
    <text class="empty-state__text">{{ text }}</text>
  </view>
</template>

<style scoped>
.empty-state {
  display: flex;
  min-height: 360rpx;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 16rpx;
  padding: 40rpx;
}

.empty-state__mark {
  color: #cccccc;
  font-size: 72rpx;
  line-height: 1;
}

.empty-state__text {
  color: var(--color-muted);
  font-size: 26rpx;
  text-align: center;
}
</style>
