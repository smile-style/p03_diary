<script setup lang="ts">
import { onShow } from '@dcloudio/uni-app'
import { useAuthStore } from '../../stores/auth'

const auth = useAuthStore()

onShow(() => {
  void auth.ensureSession()
})

function retry() {
  auth.logout()
  void auth.ensureSession()
}
</script>

<template>
  <view class="page">
    <view v-if="!auth.ready" class="state">
      <text class="state__hint">正在登录…</text>
    </view>
    <view v-else-if="auth.baseMessage" class="state">
      <text class="state__title">登录失败</text>
      <text class="state__hint">{{ auth.baseMessage }}</text>
      <button class="retry-button" @click="retry">重试</button>
    </view>
    <view v-else class="state">
      <text class="state__title">已登录</text>
    </view>
  </view>
</template>

<style scoped>
.page {
  min-height: 100vh;
  padding: 48rpx 32rpx;
  background: var(--color-bg);
}

.state {
  display: flex;
  min-height: 480rpx;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 20rpx;
}

.state__title {
  color: var(--color-text);
  font-size: 38rpx;
  font-weight: 600;
}

.state__hint {
  color: var(--color-muted);
  font-size: 28rpx;
}

.retry-button {
  margin-top: 20rpx;
  border-radius: 40rpx;
  background: var(--color-primary);
  color: #ffffff;
  font-size: 28rpx;
}
</style>
