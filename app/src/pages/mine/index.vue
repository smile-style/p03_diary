<script setup lang="ts">
import { onShow } from '@dcloudio/uni-app'
import { onMounted, onUnmounted, ref } from 'vue'
import {
  createCategory,
  deleteCategory,
  listCategories,
  updateCategory,
} from '../../api/categories'
import type { Category } from '../../api/types'
import manifest from '../../manifest.json'
import { DRAFT_KEY_PREFIX, TOKEN_KEY } from '../../config'
import { useAuthStore } from '../../stores/auth'

const auth = useAuthStore()
const categories = ref<Category[]>([])
const loading = ref(false)
const busy = ref(false)
const error = ref<string | null>(null)
type UpdateState =
  | { kind: 'idle' }
  | { kind: 'checking' }
  | { kind: 'up-to-date' }
  | { kind: 'available'; version: string; notes: string | null }
  | { kind: 'downloading'; percent: number }
  | { kind: 'downloaded'; version: string }
  | { kind: 'error'; message: string }

const updateState = ref<UpdateState>({ kind: 'idle' })
const appVersion = ref(manifest.versionName)
const hasBridge = ref(false)
let unsubscribe: (() => void) | null = null
let requestVersion = 0
const dataPath = ref('桌面版可查看')

function openDataFolder(): void {
  const bridge = (globalThis as any).wxDailyDesktop
  if (bridge?.openDataFolder) bridge.openDataFolder()
}

onMounted(async () => {
  const bridge = (globalThis as any).wxDailyDesktop
  if (!bridge) return
  hasBridge.value = true
  if (bridge.dataPath) dataPath.value = bridge.dataPath
  if (bridge.version) appVersion.value = bridge.version

  // 顺序不能反：先拉一次已缓存的状态（启动静默检查可能早已结束），再订阅后续推送。
  // 反过来会在两次调用之间漏掉状态。
  if (bridge.update?.getState) {
    try {
      const cached = (await bridge.update.getState()) as UpdateState | undefined
      if (cached) updateState.value = cached
    } catch {
      // 拿不到缓存就保持 idle，不阻断页面
    }
  }
  if (bridge.update?.onState) {
    unsubscribe = bridge.update.onState((state: UpdateState) => {
      updateState.value = state
    })
  }
})

onUnmounted(() => {
  unsubscribe?.()
})

function bridgeCall(name: 'check' | 'download', fallbackMessage: string): void {
  const bridge = (globalThis as any).wxDailyDesktop
  const fn = bridge?.update?.[name]
  if (!fn) {
    updateState.value = { kind: 'error', message: fallbackMessage }
    return
  }
  updateState.value = name === 'check' ? { kind: 'checking' } : updateState.value
  void Promise.resolve(fn())
    .then((result: UpdateState | undefined) => {
      if (result) updateState.value = result
    })
    .catch((error: unknown) => {
      updateState.value = {
        kind: 'error',
        message: error instanceof Error ? error.message : '更新失败',
      }
    })
}

function applyUpdate(): void {
  const bridge = (globalThis as any).wxDailyDesktop
  bridge?.update?.install?.()
}

onShow(() => {
  void loadCategories()
})

function messageOf(value: unknown): string {
  return value instanceof Error && value.message ? value.message : '操作失败'
}

function showToast(title: string): void {
  uni.showToast({ title, icon: 'none' })
}

function modalInput(result: { content?: string }): string {
  return String(result.content ?? '').trim()
}

async function loadCategories(): Promise<void> {
  await auth.ensureSession()
  if (auth.baseMessage) {
    error.value = auth.baseMessage
    return
  }

  const currentVersion = ++requestVersion
  loading.value = true
  error.value = null
  try {
    const response = await listCategories()
    if (currentVersion !== requestVersion) return
    categories.value = response.items
  } catch (loadError) {
    if (currentVersion !== requestVersion) return
    error.value = messageOf(loadError)
  } finally {
    if (currentVersion === requestVersion) loading.value = false
  }
}

function addCategory(): void {
  if (busy.value) return
  uni.showModal({
    title: '新增分类',
    editable: true,
    placeholderText: '输入分类名称',
    confirmText: '新增',
    success: (result) => {
      if (!result.confirm) return
      const name = modalInput(result)
      if (!name) {
        showToast('分类名称不能为空')
        return
      }
      void createCategoryAndReload(name)
    },
  })
}

async function createCategoryAndReload(name: string): Promise<void> {
  if (busy.value) return
  busy.value = true
  try {
    await createCategory(name)
    showToast('分类已新增')
    await loadCategories()
  } catch (createError) {
    showToast(messageOf(createError))
  } finally {
    busy.value = false
  }
}

function renameCategory(category: Category): void {
  if (busy.value) return
  uni.showModal({
    title: '重命名分类',
    editable: true,
    content: category.name,
    placeholderText: '输入新的分类名称',
    confirmText: '保存',
    success: (result) => {
      if (!result.confirm) return
      const name = modalInput(result)
      if (!name) {
        showToast('分类名称不能为空')
        return
      }
      if (name === category.name) return
      void renameCategoryAndReload(category.id, name)
    },
  })
}

async function renameCategoryAndReload(id: string, name: string): Promise<void> {
  if (busy.value) return
  busy.value = true
  try {
    await updateCategory(id, { name })
    showToast('分类已更新')
    await loadCategories()
  } catch (updateError) {
    showToast(messageOf(updateError))
  } finally {
    busy.value = false
  }
}

function confirmDeleteCategory(category: Category): void {
  if (busy.value) return
  uni.showModal({
    title: '删除分类',
    content: '分类下的主题会归入未分类。确定删除这个分类吗？',
    confirmText: '删除',
    confirmColor: '#d94b4b',
    success: (result) => {
      if (result.confirm) void deleteCategoryAndReload(category)
    },
  })
}

async function deleteCategoryAndReload(category: Category): Promise<void> {
  if (busy.value) return
  busy.value = true
  try {
    await deleteCategory(category.id)
    showToast('分类已删除')
    await loadCategories()
  } catch (deleteError) {
    showToast(messageOf(deleteError))
  } finally {
    busy.value = false
  }
}

function clearLocalCache(): void {
  uni.showModal({
    title: '清除本地缓存',
    content: '将删除本机草稿与登录信息，重新进入后会自动恢复会话。',
    confirmText: '清除',
    confirmColor: '#d94b4b',
    success: (result) => {
      if (!result.confirm) return
      try {
        const storage = uni.getStorageInfoSync()
        for (const key of storage.keys) {
          if (key.startsWith(DRAFT_KEY_PREFIX)) uni.removeStorageSync(key)
        }
        uni.removeStorageSync(TOKEN_KEY)
        auth.logout()
        uni.showModal({
          title: '已清除',
          content: '草稿与登录信息已清除，重新进入后会自动恢复会话。',
          showCancel: false,
        })
      } catch (clearError) {
        showToast(messageOf(clearError))
      }
    },
  })
}
</script>

<template>
  <view class="mine-page">
    <scroll-view class="page-scroll" scroll-y>
      <view class="account-card">
        <view class="account-card__avatar">
          <text>本</text>
        </view>
        <view class="account-card__info">
          <text class="account-card__name">本机单用户</text>
          <text class="account-card__hint">数据保存在这台电脑上，不联网也能用</text>
        </view>
      </view>

      <view class="section-card">
        <view class="section-header">
          <view>
            <text class="section-header__title">分类管理</text>
            <text class="section-header__hint">用于整理主题</text>
          </view>
          <button class="add-button" :disabled="busy" @click="addCategory">
            新增分类
          </button>
        </view>

        <view v-if="loading" class="section-state">
          <text>正在加载分类…</text>
        </view>

        <view v-else-if="error" class="section-state">
          <text class="section-state__error">{{ error }}</text>
          <button class="retry-button" @click="loadCategories">重试</button>
        </view>

        <view v-else-if="categories.length === 0" class="section-state">
          <text>还没有分类，点击“新增分类”开始整理。</text>
        </view>

        <view v-else class="category-list">
          <view
            v-for="category in categories"
            :key="category.id"
            class="category-item"
          >
            <view class="category-item__main">
              <text class="category-item__name">{{ category.name }}</text>
              <text class="category-item__order">排序 {{ category.sortOrder }}</text>
            </view>
            <view class="category-item__actions">
              <button
                class="text-button"
                :disabled="busy"
                @click="renameCategory(category)"
              >
                改名
              </button>
              <button
                class="text-button text-button--danger"
                :disabled="busy"
                @click="confirmDeleteCategory(category)"
              >
                删除
              </button>
            </view>
          </view>
        </view>
      </view>

      <view class="section-card update-card">
        <view class="update-card__header">
          <text class="update-card__title">应用更新</text>
          <text class="update-card__version">v{{ appVersion }}</text>
        </view>

        <view v-if="!hasBridge" class="update-card__state">
          <text class="update-card__hint">桌面版可用</text>
        </view>

        <template v-else>
          <view v-if="updateState.kind === 'idle'" class="update-card__actions">
            <button class="update-button" @click="bridgeCall('check', '无法检查更新')">检查更新</button>
          </view>
          <view v-else-if="updateState.kind === 'checking'" class="update-card__state">
            <text class="update-card__hint">正在检查…</text>
          </view>
          <view v-else-if="updateState.kind === 'up-to-date'" class="update-card__state">
            <text class="update-card__hint">已是最新版本</text>
          </view>
          <view v-else-if="updateState.kind === 'available'" class="update-card__state">
            <text class="update-card__hint">发现新版本 v{{ updateState.version }}</text>
            <text v-if="updateState.notes" class="update-card__notes">{{ updateState.notes }}</text>
            <button class="update-button" @click="bridgeCall('download', '无法下载更新')">立即更新</button>
          </view>
          <view v-else-if="updateState.kind === 'downloading'" class="update-card__state">
            <text class="update-card__hint">下载中 {{ updateState.percent }}%</text>
          </view>
          <view v-else-if="updateState.kind === 'downloaded'" class="update-card__state">
            <text class="update-card__hint">下载完成，重启后生效</text>
            <button class="update-button" @click="applyUpdate">立即重启</button>
          </view>
          <view v-else-if="updateState.kind === 'error'" class="update-card__state">
            <text class="update-card__error">{{ updateState.message }}</text>
            <button class="update-button" @click="bridgeCall('check', '无法检查更新')">重试</button>
          </view>
        </template>
      </view>

      <view class="section-card settings-card">
        <view class="setting-item" @click="openDataFolder">
          <view>
            <text class="setting-item__title">打开数据文件夹</text>
            <text class="setting-item__hint">{{ dataPath }}</text>
          </view>
          <text class="setting-item__arrow">›</text>
        </view>
        <view class="setting-divider" />
        <view class="setting-item" @click="clearLocalCache">
          <view>
            <text class="setting-item__title">清除本地缓存</text>
            <text class="setting-item__hint">删除草稿与登录信息</text>
          </view>
          <text class="setting-item__arrow">›</text>
        </view>
        <view class="setting-divider" />
        <view class="setting-item setting-item--about">
          <text class="setting-item__title">关于</text>
          <text class="setting-item__version">版本 {{ appVersion }}</text>
        </view>
      </view>

      <view class="safe-area" />
    </scroll-view>
  </view>
</template>

<style scoped>
.mine-page {
  height: 100vh;
  background: var(--color-bg);
}

.page-scroll {
  height: 100vh;
}

.account-card {
  display: flex;
  align-items: center;
  gap: 22rpx;
  margin: 20rpx 24rpx;
  padding: 30rpx;
  border-radius: 24rpx;
  background: linear-gradient(135deg, #effbf4, #ffffff);
}

.account-card__avatar {
  display: flex;
  width: 96rpx;
  height: 96rpx;
  align-items: center;
  justify-content: center;
  border: 4rpx solid rgba(7, 193, 96, 0.16);
  border-radius: 48rpx;
  background: #ffffff;
  color: var(--color-primary);
  font-size: 38rpx;
  font-weight: 700;
}

.account-card__info {
  flex: 1;
}

.account-card__name {
  display: block;
  color: var(--color-text);
  font-size: 32rpx;
  font-weight: 700;
}

.account-card__hint {
  display: block;
  margin-top: 8rpx;
  color: var(--color-muted);
  font-size: 23rpx;
}

.section-card {
  margin: 20rpx 24rpx;
  padding: 26rpx 28rpx;
  border-radius: 24rpx;
  background: #ffffff;
  box-shadow: 0 6rpx 22rpx rgba(0, 0, 0, 0.04);
}

.section-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 20rpx;
  padding-bottom: 18rpx;
  border-bottom: 1rpx solid var(--color-border);
}

.section-header__title {
  display: block;
  color: var(--color-text);
  font-size: 30rpx;
  font-weight: 700;
}

.section-header__hint {
  display: block;
  margin-top: 6rpx;
  color: var(--color-muted);
  font-size: 22rpx;
}

.add-button {
  flex: none;
  margin: 0;
  padding: 0 22rpx;
  border-radius: 30rpx;
  background: var(--color-primary);
  color: #ffffff;
  font-size: 23rpx;
  line-height: 58rpx;
}

.add-button[disabled] {
  opacity: 0.5;
}

.section-state {
  display: flex;
  min-height: 180rpx;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 16rpx;
  color: var(--color-muted);
  font-size: 24rpx;
  text-align: center;
}

.section-state__error {
  color: #d94b4b;
}

.retry-button {
  min-width: 150rpx;
  margin: 0;
  border-radius: 28rpx;
  background: var(--color-primary);
  color: #ffffff;
  font-size: 23rpx;
  line-height: 56rpx;
}

.category-item {
  display: flex;
  align-items: center;
  gap: 18rpx;
  padding: 22rpx 0;
  border-bottom: 1rpx solid var(--color-border);
}

.category-item:last-child {
  border-bottom: 0;
}

.category-item__main {
  min-width: 0;
  flex: 1;
}

.category-item__name {
  display: block;
  overflow: hidden;
  color: var(--color-text);
  font-size: 28rpx;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.category-item__order {
  display: block;
  margin-top: 6rpx;
  color: var(--color-muted);
  font-size: 22rpx;
}

.category-item__actions {
  display: flex;
  align-items: center;
  gap: 10rpx;
}

.text-button {
  min-width: 84rpx;
  margin: 0;
  padding: 0;
  background: transparent;
  color: var(--color-primary);
  font-size: 23rpx;
  line-height: 52rpx;
}

.text-button--danger {
  color: #d94b4b;
}

.text-button[disabled] {
  opacity: 0.45;
}

.update-card {
  padding: 0;
}

.update-card__header {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  padding: 28rpx 28rpx 12rpx;
}

.update-card__title {
  color: var(--color-text);
  font-size: 30rpx;
  font-weight: 600;
}

.update-card__version {
  color: var(--color-muted);
  font-size: 24rpx;
}

.update-card__state,
.update-card__actions {
  display: flex;
  flex-direction: column;
  gap: 16rpx;
  padding: 8rpx 28rpx 28rpx;
}

.update-card__hint {
  color: var(--color-muted);
  font-size: 24rpx;
}

.update-card__notes {
  color: var(--color-muted);
  font-size: 22rpx;
  line-height: 1.5;
  white-space: pre-wrap;
}

.update-card__error {
  color: #d94b4b;
  font-size: 24rpx;
}

.update-button {
  align-self: flex-start;
  padding: 0 36rpx;
  border-radius: 32rpx;
  background: var(--color-primary);
  color: #ffffff;
  font-size: 24rpx;
  line-height: 64rpx;
}

.settings-card {
  padding-top: 0;
  padding-bottom: 0;
}

.setting-item {
  display: flex;
  min-height: 104rpx;
  align-items: center;
  justify-content: space-between;
  gap: 20rpx;
}

.setting-item--about {
  min-height: 92rpx;
}

.setting-item__title {
  display: block;
  color: var(--color-text);
  font-size: 27rpx;
}

.setting-item__hint {
  display: block;
  margin-top: 5rpx;
  color: var(--color-muted);
  font-size: 21rpx;
}

.setting-item__version,
.setting-item__arrow {
  color: var(--color-muted);
  font-size: 24rpx;
}

.setting-item__arrow {
  font-size: 36rpx;
}

.setting-divider {
  height: 1rpx;
  background: var(--color-border);
}

.safe-area {
  height: calc(40rpx + env(safe-area-inset-bottom));
}
</style>
