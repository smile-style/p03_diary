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
import AppIcon from '../../components/AppIcon.vue'
import AppShell from '../../components/AppShell.vue'
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
  <AppShell
    active="mine"
    title="我的"
    eyebrow="本机与设置"
    description="管理分类、数据位置、缓存和应用更新。"
  >
    <template #actions>
      <view class="version-badge">
        <view class="version-badge__dot" />
        <text>v{{ appVersion }}</text>
      </view>
    </template>

    <scroll-view class="page-scroll" scroll-y>
      <view class="mine-inner">
        <view class="account-card">
          <view class="account-card__avatar" aria-hidden="true">
            <text>本</text>
          </view>
          <view class="account-card__info">
            <text class="account-card__eyebrow">LOCAL FIRST</text>
            <text class="account-card__name">本机单用户</text>
            <text class="account-card__hint">记录与图片保存在这台电脑上，不依赖云端账号。</text>
          </view>
          <view class="account-card__badge">
            <view class="account-card__status" />
            <text>本机数据</text>
          </view>
        </view>

        <view class="mine-layout">
          <view class="section-card categories-card">
            <view class="section-header">
              <view>
                <text class="section-header__eyebrow">ORGANIZE</text>
                <text class="section-header__title">分类管理</text>
                <text class="section-header__hint">分类用来整理主题，不会影响已有记录。</text>
              </view>
              <button class="app-button app-button--small app-button--primary" :disabled="busy" @click="addCategory">
                <AppIcon name="plus" />
                新增分类
              </button>
            </view>

            <view v-if="loading" class="section-state">
              <text>正在加载分类…</text>
            </view>

            <view v-else-if="error" class="section-state">
              <text class="section-state__error">{{ error }}</text>
              <button class="app-button app-button--small" @click="loadCategories">重试</button>
            </view>

            <view v-else-if="categories.length === 0" class="section-state">
              <text>还没有分类，新增一个开始整理。</text>
            </view>

            <view v-else class="category-list">
              <view
                v-for="(category, index) in categories"
                :key="category.id"
                class="category-item"
              >
                <view class="category-item__index">{{ String(index + 1).padStart(2, '0') }}</view>
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

          <view class="side-stack">
            <view class="section-card update-card">
              <view class="update-card__header">
                <view>
                  <text class="section-header__eyebrow">DESKTOP</text>
                  <text class="update-card__title">应用更新</text>
                </view>
                <view class="update-card__version">当前 v{{ appVersion }}</view>
              </view>

              <view v-if="!hasBridge" class="update-card__state">
                <text class="update-card__hint">桌面版可检查并安装更新。</text>
              </view>

              <template v-else>
                <view v-if="updateState.kind === 'idle'" class="update-card__actions">
                  <text class="update-card__hint">保持应用为最新版本，数据不会受到影响。</text>
                  <button class="app-button app-button--small" @click="bridgeCall('check', '无法检查更新')">检查更新</button>
                </view>
                <view v-else-if="updateState.kind === 'checking'" class="update-card__state">
                  <text class="update-card__hint">正在检查版本…</text>
                </view>
                <view v-else-if="updateState.kind === 'up-to-date'" class="update-card__state">
                  <text class="update-card__hint">已经是最新版本。</text>
                </view>
                <view v-else-if="updateState.kind === 'available'" class="update-card__state">
                  <text class="update-card__hint">发现新版本 v{{ updateState.version }}</text>
                  <text v-if="updateState.notes" class="update-card__notes">{{ updateState.notes }}</text>
                  <button class="app-button app-button--small app-button--primary" @click="bridgeCall('download', '无法下载更新')">立即更新</button>
                </view>
                <view v-else-if="updateState.kind === 'downloading'" class="update-card__state">
                  <view class="progress-track">
                    <view class="progress-track__bar" :style="{ width: updateState.percent + '%' }" />
                  </view>
                  <text class="update-card__hint">下载中 {{ updateState.percent }}%</text>
                </view>
                <view v-else-if="updateState.kind === 'downloaded'" class="update-card__state">
                  <text class="update-card__hint">下载完成，重启后生效。</text>
                  <button class="app-button app-button--small app-button--primary" @click="applyUpdate">立即重启</button>
                </view>
                <view v-else-if="updateState.kind === 'error'" class="update-card__state">
                  <text class="update-card__error">{{ updateState.message }}</text>
                  <button class="app-button app-button--small" @click="bridgeCall('check', '无法检查更新')">重试</button>
                </view>
              </template>
            </view>

            <view class="section-card settings-card">
              <view class="settings-card__header">
                <text class="section-header__eyebrow">DATA</text>
                <text class="update-card__title">数据与设置</text>
              </view>

              <button class="setting-item" @click="openDataFolder">
                <view class="setting-item__icon">
                  <AppIcon name="topics" />
                </view>
                <view class="setting-item__copy">
                  <text class="setting-item__title">打开数据文件夹</text>
                  <text class="setting-item__hint">{{ dataPath }}</text>
                </view>
                <AppIcon class="setting-item__arrow" name="chevron-right" />
              </button>

              <button class="setting-item" @click="clearLocalCache">
                <view class="setting-item__icon setting-item__icon--danger">
                  <AppIcon name="trash" />
                </view>
                <view class="setting-item__copy">
                  <text class="setting-item__title">清除本地缓存</text>
                  <text class="setting-item__hint">删除草稿与登录信息，不删除已有记录。</text>
                </view>
                <AppIcon class="setting-item__arrow" name="chevron-right" />
              </button>

              <view class="setting-item setting-item--about">
                <view class="setting-item__icon">
                  <AppIcon name="settings" />
                </view>
                <view class="setting-item__copy">
                  <text class="setting-item__title">关于生活记录</text>
                  <text class="setting-item__hint">Windows 桌面版 · 本机存储</text>
                </view>
                <text class="setting-item__version">v{{ appVersion }}</text>
              </view>
            </view>
          </view>
        </view>
      </view>
    </scroll-view>
  </AppShell>
</template>

<style scoped>
.mine-inner {
  width: 100%;
  max-width: 1080px;
  margin: 0 auto;
  padding: 28px 42px 56px;
}

.version-badge {
  display: flex;
  min-height: 38px;
  align-items: center;
  gap: 8px;
  padding: 0 13px;
  border: 1px solid var(--color-border);
  border-radius: 999px;
  background: var(--color-surface);
  color: var(--color-muted-strong);
  font-size: 11px;
}

.version-badge__dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--color-success);
}

.account-card {
  display: flex;
  min-height: 128px;
  align-items: center;
  gap: 20px;
  margin-bottom: 22px;
  padding: 24px 28px;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-card);
  background:
    radial-gradient(circle at 90% 16%, rgba(63, 107, 84, 0.09), transparent 32%),
    var(--color-surface);
  box-shadow: var(--shadow-card);
}

.account-card__avatar {
  display: flex;
  width: 68px;
  height: 68px;
  flex: none;
  align-items: center;
  justify-content: center;
  border: 1px solid color-mix(in srgb, var(--color-success) 26%, var(--color-border));
  border-radius: 50%;
  background: var(--color-success-soft);
  color: var(--color-success);
  font-family: var(--font-display);
  font-size: 28px;
  font-weight: 700;
}

.account-card__info {
  min-width: 0;
  flex: 1;
}

.account-card__eyebrow,
.section-header__eyebrow {
  display: block;
  color: var(--color-success);
  font-size: 9px;
  font-weight: 700;
  letter-spacing: 0.16em;
}

.account-card__name {
  display: block;
  margin-top: 4px;
  color: var(--color-ink);
  font-family: var(--font-display);
  font-size: 24px;
  font-weight: 700;
}

.account-card__hint {
  display: block;
  margin-top: 5px;
  color: var(--color-muted);
  font-size: 11px;
  line-height: 1.65;
}

.account-card__badge {
  display: flex;
  flex: none;
  align-items: center;
  gap: 7px;
  padding: 7px 11px;
  border: 1px solid var(--color-border);
  border-radius: 999px;
  color: var(--color-muted-strong);
  font-size: 10px;
}

.account-card__status {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--color-success);
}

.mine-layout {
  display: grid;
  grid-template-columns: minmax(0, 1.2fr) minmax(270px, 0.8fr);
  align-items: start;
  gap: 20px;
}

.side-stack {
  display: flex;
  flex-direction: column;
  gap: 20px;
}

.section-card {
  padding: 24px;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-card);
  background: var(--color-surface);
  box-shadow: var(--shadow-soft);
}

.section-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 20px;
  padding-bottom: 18px;
  border-bottom: 1px solid var(--color-border);
}

.section-header__title,
.update-card__title {
  display: block;
  margin-top: 4px;
  color: var(--color-ink);
  font-family: var(--font-display);
  font-size: 21px;
  font-weight: 700;
}

.section-header__hint {
  display: block;
  max-width: 380px;
  margin-top: 5px;
  color: var(--color-muted);
  font-size: 10px;
  line-height: 1.55;
}

.section-state {
  display: flex;
  min-height: 200px;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 12px;
  color: var(--color-muted);
  font-size: 12px;
  text-align: center;
}

.section-state__error {
  color: var(--color-danger);
}

.category-list {
  display: flex;
  flex-direction: column;
}

.category-item {
  display: flex;
  min-height: 76px;
  align-items: center;
  gap: 14px;
  border-bottom: 1px solid var(--color-border);
}

.category-item:last-child {
  border-bottom: 0;
}

.category-item__index {
  display: flex;
  width: 34px;
  flex: none;
  align-items: center;
  justify-content: center;
  color: var(--color-muted);
  font-family: var(--font-display);
  font-size: 12px;
  letter-spacing: 0.05em;
}

.category-item__main {
  min-width: 0;
  flex: 1;
}

.category-item__name {
  display: block;
  overflow: hidden;
  color: var(--color-text);
  font-size: 14px;
  font-weight: 600;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.category-item__order {
  display: block;
  margin-top: 4px;
  color: var(--color-muted);
  font-size: 10px;
}

.category-item__actions {
  display: flex;
  flex: none;
  align-items: center;
  gap: 3px;
}

.text-button {
  position: relative;
  min-width: 48px;
  min-height: 34px;
  margin: 0;
  padding: 0 8px;
  border: 0;
  border-radius: 8px;
  background: transparent;
  color: var(--color-accent);
  font-size: 11px;
  line-height: 1;
}

.text-button::after {
  position: absolute;
  inset: -5px;
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

.text-button[disabled] {
  opacity: 0.45;
}

.update-card__header,
.settings-card__header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 15px;
  margin-bottom: 17px;
  padding-bottom: 16px;
  border-bottom: 1px solid var(--color-border);
}

.update-card__version {
  color: var(--color-muted);
  font-size: 10px;
}

.update-card__state,
.update-card__actions {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 12px;
}

.update-card__hint {
  color: var(--color-muted);
  font-size: 11px;
  line-height: 1.65;
}

.update-card__notes {
  max-height: 132px;
  overflow: auto;
  color: var(--color-muted);
  font-size: 10px;
  line-height: 1.55;
  white-space: pre-wrap;
}

.update-card__error {
  max-height: 170px;
  overflow: auto;
  color: var(--color-danger);
  font-size: 10px;
  line-height: 1.55;
  word-break: break-word;
}

.progress-track {
  width: 100%;
  height: 5px;
  overflow: hidden;
  border-radius: 999px;
  background: var(--color-surface-muted);
}

.progress-track__bar {
  height: 100%;
  border-radius: inherit;
  background: var(--color-accent);
  transition: width 180ms ease;
}

.settings-card {
  padding-bottom: 8px;
}

.settings-card__header {
  margin-bottom: 2px;
}

.setting-item {
  display: flex;
  width: 100%;
  min-height: 72px;
  align-items: center;
  gap: 12px;
  margin: 0;
  padding: 10px 0;
  border: 0;
  border-bottom: 1px solid var(--color-border);
  border-radius: 0;
  background: transparent;
  color: var(--color-text);
  text-align: left;
}

.setting-item:hover .setting-item__title {
  color: var(--color-accent);
}

.setting-item:last-child {
  border-bottom: 0;
}

.setting-item__icon {
  display: flex;
  width: 34px;
  height: 34px;
  flex: none;
  align-items: center;
  justify-content: center;
  border-radius: 10px;
  background: var(--color-surface-muted);
  color: var(--color-muted-strong);
}

.setting-item__icon--danger {
  background: var(--color-danger-soft);
  color: var(--color-danger);
}

.setting-item__icon .app-icon {
  width: 15px;
  height: 15px;
}

.setting-item__copy {
  min-width: 0;
  flex: 1;
}

.setting-item__title {
  display: block;
  color: var(--color-text);
  font-size: 12px;
  font-weight: 600;
}

.setting-item__hint {
  display: block;
  margin-top: 4px;
  overflow: hidden;
  color: var(--color-muted);
  font-size: 9px;
  line-height: 1.5;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.setting-item__version,
.setting-item__arrow {
  flex: none;
  color: var(--color-muted);
  font-size: 10px;
}

.setting-item__arrow {
  width: 14px;
  height: 14px;
}

@media (max-width: 1050px) {
  .mine-layout {
    grid-template-columns: 1fr;
  }

  .mine-inner {
    padding-right: 28px;
    padding-left: 28px;
  }
}

@media (max-width: 850px) {
  .mine-layout {
    grid-template-columns: 1fr;
  }
}

@media (max-width: 699px) {
  .mine-inner {
    padding: 18px 16px 38px;
  }

  .account-card {
    align-items: flex-start;
    padding: 20px;
  }

  .account-card__badge {
    display: none;
  }

  .section-card {
    padding: 19px;
  }

  .category-item {
    flex-wrap: wrap;
    padding: 10px 0;
  }

  .category-item__actions {
    width: 100%;
    justify-content: flex-end;
    padding-left: 48px;
  }
}
</style>
