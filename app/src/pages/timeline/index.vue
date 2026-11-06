<script setup lang="ts">
import { onShow } from '@dcloudio/uni-app'
import { computed, ref } from 'vue'
import EmptyState from '../../components/EmptyState.vue'
import RecordCard from '../../components/RecordCard.vue'
import { useAuthStore } from '../../stores/auth'
import { useTimelineStore } from '../../stores/timeline'
import { parseSearchInput } from '../../utils/search'

const auth = useAuthStore()
const timeline = useTimelineStore()
const searchText = ref('')

const isInitialLoading = computed(
  () => timeline.loading && timeline.items.length === 0,
)

onShow(async () => {
  await auth.ensureSession()
  if (auth.baseMessage) return
  await timeline.reset(timeline.filter)
})

function submitSearch() {
  void timeline.reset(parseSearchInput(searchText.value))
}

function clearSearch() {
  searchText.value = ''
  void timeline.reset({})
}

function retryLogin() {
  auth.logout()
  void auth.ensureSession()
}

function retryLoad() {
  void timeline.reset()
}

function createRecord() {
  uni.navigateTo({ url: '/pages/record/edit' })
}
</script>

<template>
  <view class="timeline-page">
    <view v-if="!auth.ready" class="session-state">
      <text>正在登录…</text>
    </view>

    <view v-else-if="auth.baseMessage" class="session-state">
      <text class="session-state__title">登录失败</text>
      <text class="session-state__message">{{ auth.baseMessage }}</text>
      <button class="session-state__button" @click="retryLogin">重试</button>
    </view>

    <template v-else>
      <view class="search-bar">
        <input
          v-model="searchText"
          class="search-bar__input"
          confirm-type="search"
          placeholder="搜索记录，或输入 #标签"
          @confirm="submitSearch"
        />
        <text v-if="searchText" class="search-bar__clear" @click="clearSearch">清除</text>
      </view>

      <scroll-view
        class="timeline-scroll"
        scroll-y
        lower-threshold="80"
        @scrolltolower="timeline.loadMore"
      >
        <view v-if="isInitialLoading" class="list-state">
          <text>正在加载…</text>
        </view>

        <view v-else-if="timeline.error" class="list-state">
          <text class="list-state__error">{{ timeline.error }}</text>
          <button class="list-state__retry" @click="retryLoad">重试</button>
        </view>

        <EmptyState
          v-else-if="timeline.items.length === 0"
          text="还没有记录，点右下角 ＋ 写下第一条"
        />

        <template v-else>
          <RecordCard
            v-for="record in timeline.items"
            :key="record.id"
            :record="record"
          />
          <view v-if="timeline.loading" class="loading-more">
            <text>正在加载更多…</text>
          </view>
          <view v-else-if="!timeline.nextCursor" class="list-end">
            <text>已经到底了</text>
          </view>
        </template>
      </scroll-view>

      <button class="create-button" aria-label="新建记录" @click="createRecord">＋</button>
    </template>
  </view>
</template>

<style scoped>
.timeline-page {
  min-height: 100vh;
  background: var(--color-bg);
}

.search-bar {
  display: flex;
  align-items: center;
  gap: 16rpx;
  padding: 20rpx 24rpx;
  background: #ffffff;
  border-bottom: 1rpx solid var(--color-border);
}

.search-bar__input {
  height: 72rpx;
  flex: 1;
  padding: 0 24rpx;
  border-radius: 36rpx;
  background: #f3f3f3;
  font-size: 26rpx;
}

.search-bar__clear {
  color: var(--color-primary);
  font-size: 24rpx;
}

.timeline-scroll {
  height: calc(100vh - 113rpx);
  padding-bottom: 160rpx;
}

.session-state,
.list-state {
  display: flex;
  min-height: 540rpx;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 20rpx;
  padding: 48rpx;
  color: var(--color-muted);
  text-align: center;
}

.session-state__title {
  color: var(--color-text);
  font-size: 36rpx;
  font-weight: 600;
}

.session-state__message,
.list-state__error {
  color: #d94b4b;
  font-size: 26rpx;
}

.session-state__button,
.list-state__retry {
  margin-top: 12rpx;
  padding: 0 40rpx;
  border-radius: 36rpx;
  background: var(--color-primary);
  color: #ffffff;
  font-size: 26rpx;
  line-height: 72rpx;
}

.loading-more,
.list-end {
  padding: 28rpx;
  color: var(--color-muted);
  font-size: 24rpx;
  text-align: center;
}

.create-button {
  position: fixed;
  right: 32rpx;
  bottom: 132rpx;
  width: 104rpx;
  height: 104rpx;
  padding: 0;
  border-radius: 52rpx;
  background: var(--color-primary);
  box-shadow: 0 10rpx 24rpx rgba(7, 193, 96, 0.3);
  color: #ffffff;
  font-size: 58rpx;
  line-height: 100rpx;
}
</style>
