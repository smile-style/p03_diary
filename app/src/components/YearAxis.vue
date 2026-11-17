<script setup lang="ts">
import { computed } from 'vue'

const props = defineProps<{
  items: { year: string; count: number }[]
  selected: string | null
}>()

const emit = defineEmits<{
  select: [year: string | null]
}>()

const activeAnchor = computed(() =>
  props.selected === null ? 'year-all' : 'year-' + props.selected,
)
</script>

<template>
  <scroll-view
    class="year-axis"
    scroll-x
    :scroll-into-view="activeAnchor"
    scroll-with-animation
  >
    <view class="year-axis__track">
      <button
        id="year-all"
        class="year-chip"
        :class="{ 'year-chip--active': props.selected === null }"
        aria-label="查看全部年份"
        @click="emit('select', null)"
      >
        <text class="year-chip__label">全部</text>
        <text class="year-chip__meta">年份</text>
      </button>

      <button
        v-for="item in items"
        :id="'year-' + item.year"
        :key="item.year"
        class="year-chip"
        :class="{ 'year-chip--active': props.selected === item.year }"
        :aria-label="`查看 ${item.year} 年，共 ${item.count} 条记录`"
        @click="emit('select', item.year)"
      >
        <text class="year-chip__label">{{ item.year }}</text>
        <text class="year-chip__meta">{{ item.count }} 条</text>
      </button>
    </view>
  </scroll-view>
</template>

<style scoped>
.year-axis {
  width: 100%;
  white-space: nowrap;
}

.year-axis__track {
  display: inline-flex;
  min-width: 100%;
  gap: 8px;
  padding: 2px 0 4px;
}

.year-chip {
  display: inline-flex;
  min-width: 82px;
  min-height: 54px;
  flex: none;
  flex-direction: column;
  align-items: flex-start;
  justify-content: center;
  margin: 0;
  padding: 8px 14px;
  border: 1px solid var(--color-border);
  border-radius: 13px;
  background: var(--color-surface);
  color: var(--color-muted-strong);
  text-align: left;
}

.year-chip:hover {
  border-color: var(--color-border-strong);
  background: var(--color-surface-muted);
}

.year-chip--active {
  border-color: var(--color-ink);
  background: var(--color-ink);
  color: var(--color-surface);
  box-shadow: 0 8px 22px rgba(38, 33, 25, 0.14);
}

.year-chip--active:hover {
  border-color: var(--color-ink);
  background: var(--color-ink);
}

.year-chip__label {
  font-family: var(--font-display);
  font-size: 17px;
  font-weight: 700;
  line-height: 1.1;
}

.year-chip__meta {
  margin-top: 4px;
  color: var(--color-muted);
  font-size: 10px;
  letter-spacing: 0.08em;
}

.year-chip--active .year-chip__meta {
  color: color-mix(in srgb, var(--color-surface) 72%, transparent);
}
</style>
