<script setup lang="ts">
import AppIcon from './AppIcon.vue'
import manifest from '../manifest.json'

type Section = 'timeline' | 'calendar' | 'topics' | 'mine'
type IconName =
  | 'timeline'
  | 'calendar'
  | 'topics'
  | 'settings'
  | 'plus'
  | 'star'
  | 'search'
  | 'close'
  | 'arrow-left'
  | 'chevron-left'
  | 'chevron-right'
  | 'edit'
  | 'trash'
  | 'image'
  | 'link'
  | 'quote'

withDefaults(
  defineProps<{
    active?: Section
    title: string
    eyebrow?: string
    description?: string
    back?: boolean
  }>(),
  {
    active: undefined,
    eyebrow: '生活记录',
    description: '',
    back: false,
  },
)

const navItems: {
  key: Section
  label: string
  hint: string
  icon: IconName
  url: string
}[] = [
  {
    key: 'timeline',
    label: '时间线',
    hint: '按时间回看',
    icon: 'timeline',
    url: '/pages/timeline/index',
  },
  {
    key: 'calendar',
    label: '日历',
    hint: '按月翻阅',
    icon: 'calendar',
    url: '/pages/calendar/index',
  },
  {
    key: 'topics',
    label: '主题',
    hint: '按线索整理',
    icon: 'topics',
    url: '/pages/topics/index',
  },
  {
    key: 'mine',
    label: '我的',
    hint: '设置与数据',
    icon: 'settings',
    url: '/pages/mine/index',
  },
]

function go(url: string): void {
  uni.switchTab({ url })
}

function createRecord(): void {
  uni.navigateTo({ url: '/pages/record/edit' })
}

function goBack(): void {
  uni.navigateBack({ delta: 1 })
}
</script>

<template>
  <view class="app-shell">
    <aside class="sidebar" aria-label="主导航">
      <button class="brand" aria-label="回到时间线" @click="go('/pages/timeline/index')">
        <view class="brand__mark" aria-hidden="true">
          <view class="brand__line" />
          <view class="brand__dot brand__dot--one" />
          <view class="brand__dot brand__dot--two" />
          <view class="brand__dot brand__dot--three" />
        </view>
        <view class="brand__copy">
          <text class="brand__name">生活记录</text>
          <text class="brand__sub">把日子慢慢摊开</text>
        </view>
      </button>

      <button class="compose-button" @click="createRecord">
        <AppIcon name="plus" />
        <text>写一条记录</text>
      </button>

      <view class="nav-list">
        <button
          v-for="item in navItems"
          :key="item.key"
          class="nav-item"
          :class="{ 'nav-item--active': active === item.key }"
          :aria-label="item.label"
          :aria-current="active === item.key ? 'page' : undefined"
          @click="go(item.url)"
        >
          <AppIcon :name="item.icon" />
          <view class="nav-item__copy">
            <text class="nav-item__label">{{ item.label }}</text>
            <text class="nav-item__hint">{{ item.hint }}</text>
          </view>
        </button>
      </view>

      <view class="sidebar__footer">
        <view class="sidebar__status-dot" />
        <view>
          <text class="sidebar__status">本机数据</text>
          <text class="sidebar__version">v{{ manifest.versionName }}</text>
        </view>
      </view>
    </aside>

    <main class="workspace">
      <header class="workspace-header">
        <view class="workspace-heading">
          <button
            v-if="back"
            class="back-button"
            aria-label="返回上一页"
            @click="goBack"
          >
            <AppIcon name="arrow-left" />
          </button>
          <view class="workspace-heading__copy">
            <text class="workspace-heading__eyebrow">{{ eyebrow }}</text>
            <text class="workspace-heading__title">{{ title }}</text>
            <text v-if="description" class="workspace-heading__description">
              {{ description }}
            </text>
          </view>
        </view>
        <view v-if="$slots.actions" class="workspace-actions">
          <slot name="actions" />
        </view>
      </header>

      <section class="workspace-content">
        <slot />
      </section>
    </main>
  </view>
</template>

<style scoped>
.app-shell {
  display: flex;
  width: 100%;
  height: 100vh;
  overflow: hidden;
  background: var(--color-bg);
}

.sidebar {
  position: relative;
  z-index: 2;
  display: flex;
  width: 236px;
  height: 100vh;
  flex: none;
  flex-direction: column;
  padding: 28px 18px 22px;
  border-right: 1px solid var(--color-border);
  background: var(--color-sidebar);
}

.brand {
  display: flex;
  min-height: 58px;
  align-items: center;
  gap: 13px;
  margin: 0;
  padding: 0 8px;
  border: 0;
  background: transparent;
  color: var(--color-ink);
  text-align: left;
}

.brand__mark {
  position: relative;
  width: 36px;
  height: 42px;
  flex: none;
  border: 1px solid var(--color-border-strong);
  border-radius: 11px;
  background: var(--color-surface);
}

.brand__line {
  position: absolute;
  top: 9px;
  bottom: 9px;
  left: 10px;
  width: 1px;
  background: var(--color-accent);
}

.brand__dot {
  position: absolute;
  left: 7px;
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: var(--color-accent);
}

.brand__dot--one { top: 9px; }
.brand__dot--two { top: 18px; }
.brand__dot--three { top: 27px; }

.brand__copy,
.nav-item__copy {
  min-width: 0;
}

.brand__name {
  display: block;
  font-family: var(--font-display);
  font-size: 19px;
  font-weight: 700;
  letter-spacing: 0.06em;
}

.brand__sub {
  display: block;
  margin-top: 3px;
  color: var(--color-muted);
  font-size: 11px;
  letter-spacing: 0.04em;
}

.compose-button {
  display: flex;
  min-height: 46px;
  align-items: center;
  justify-content: center;
  gap: 9px;
  margin: 28px 4px 24px;
  padding: 0 16px;
  border: 0;
  border-radius: 13px;
  background: var(--color-accent);
  box-shadow: 0 10px 24px rgba(154, 52, 18, 0.2);
  color: var(--color-on-accent);
  font-size: 14px;
  font-weight: 600;
  letter-spacing: 0.03em;
}

.compose-button:hover {
  background: var(--color-accent-hover);
  transform: translateY(-1px);
}

.nav-list {
  display: flex;
  flex: 1;
  flex-direction: column;
  gap: 7px;
}

.nav-item {
  display: flex;
  min-height: 58px;
  align-items: center;
  gap: 13px;
  margin: 0;
  padding: 8px 12px;
  border: 1px solid transparent;
  border-radius: 13px;
  background: transparent;
  color: var(--color-muted-strong);
  text-align: left;
}

.nav-item:hover {
  background: var(--color-surface-muted);
  color: var(--color-ink);
}

.nav-item--active {
  border-color: var(--color-border);
  background: var(--color-surface);
  box-shadow: 0 6px 22px rgba(61, 47, 35, 0.05);
  color: var(--color-accent);
}

.nav-item__label {
  display: block;
  font-size: 14px;
  font-weight: 600;
}

.nav-item__hint {
  display: block;
  margin-top: 3px;
  color: var(--color-muted);
  font-size: 11px;
}

.sidebar__footer {
  display: flex;
  align-items: center;
  gap: 9px;
  padding: 16px 10px 2px;
  border-top: 1px solid var(--color-border);
  color: var(--color-muted);
}

.sidebar__status-dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: var(--color-success);
  box-shadow: 0 0 0 4px var(--color-success-soft);
}

.sidebar__status {
  display: block;
  color: var(--color-muted-strong);
  font-size: 11px;
}

.sidebar__version {
  display: block;
  margin-top: 2px;
  font-size: 10px;
}

.workspace {
  display: flex;
  min-width: 0;
  height: 100vh;
  flex: 1;
  flex-direction: column;
}

.workspace-header {
  display: flex;
  min-height: 126px;
  flex: none;
  align-items: flex-end;
  justify-content: space-between;
  gap: 24px;
  padding: 28px 42px 24px;
  border-bottom: 1px solid var(--color-border);
  background: color-mix(in srgb, var(--color-bg) 88%, transparent);
}

.workspace-heading {
  display: flex;
  min-width: 0;
  align-items: center;
  gap: 16px;
}

.workspace-heading__copy {
  min-width: 0;
}

.workspace-heading__eyebrow {
  display: block;
  margin-bottom: 7px;
  color: var(--color-accent);
  font-family: var(--font-display);
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.18em;
  text-transform: uppercase;
}

.workspace-heading__title {
  display: block;
  color: var(--color-ink);
  font-family: var(--font-display);
  font-size: clamp(28px, 3.1vw, 42px);
  font-weight: 700;
  line-height: 1.1;
  letter-spacing: 0.02em;
}

.workspace-heading__description {
  display: block;
  max-width: 620px;
  margin-top: 8px;
  color: var(--color-muted);
  font-size: 13px;
  line-height: 1.6;
}

.workspace-actions {
  display: flex;
  flex: none;
  align-items: center;
  gap: 10px;
  padding-bottom: 2px;
}

.back-button {
  display: flex;
  width: 44px;
  height: 44px;
  flex: none;
  align-items: center;
  justify-content: center;
  margin: 0;
  padding: 0;
  border: 1px solid var(--color-border);
  border-radius: 50%;
  background: var(--color-surface);
  color: var(--color-ink);
}

.back-button:hover {
  border-color: var(--color-border-strong);
  background: var(--color-surface-muted);
}

.workspace-content {
  min-height: 0;
  flex: 1;
  overflow: hidden;
}

@media (max-width: 980px) {
  .sidebar {
    width: 82px;
    align-items: center;
    padding-right: 12px;
    padding-left: 12px;
  }

  .brand {
    width: 54px;
    justify-content: center;
    padding: 0;
  }

  .brand__copy,
  .nav-item__copy,
  .sidebar__footer > view:last-child {
    display: none;
  }

  .compose-button {
    width: 48px;
    min-height: 48px;
    margin-right: 0;
    margin-left: 0;
    padding: 0;
    border-radius: 14px;
  }

  .compose-button text {
    display: none;
  }

  .nav-list {
    width: 100%;
  }

  .nav-item {
    width: 100%;
    justify-content: center;
    padding: 8px;
  }

  .sidebar__footer {
    justify-content: center;
    padding-right: 0;
    padding-left: 0;
  }

  .workspace-header {
    padding-right: 28px;
    padding-left: 28px;
  }
}

@media (max-width: 699px) {
  .app-shell {
    height: calc(100vh - var(--tab-bar-height));
  }

  .sidebar {
    display: none;
  }

  .workspace {
    height: 100%;
  }

  .workspace-header {
    min-height: 104px;
    align-items: flex-end;
    padding: 18px 20px 16px;
  }

  .workspace-heading__title {
    font-size: 28px;
  }

  .workspace-heading__description {
    display: none;
  }

  .workspace-actions {
    gap: 8px;
  }
}
</style>
