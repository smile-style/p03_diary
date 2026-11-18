<script setup lang="ts">
import { computed } from 'vue'
import type { RecordDayCount } from '../api/types'
import { dayChipParts, formatFullDateLabel } from '../utils/date'

const props = defineProps<{
  items: RecordDayCount[]
  selected: string | null
}>()

const emit = defineEmits<{
  select: [date: string]
}>()

type AxisNode =
  | { type: 'year'; year: string }
  | { type: 'day'; date: string; count: number }

const nodes = computed<AxisNode[]>(() => {
  const result: AxisNode[] = []
  let currentYear = ''

  for (const item of props.items) {
    const year = item.date.slice(0, 4)
    if (year !== currentYear) {
      result.push({ type: 'year', year })
      currentYear = year
    }
    result.push({ type: 'day', date: item.date, count: item.count })
  }

  return result
})

const activeAnchor = computed(() => (props.selected ? 'day-' + props.selected : ''))
</script>

<template>
  <scroll-view
    class="day-axis"
    scroll-x
    :scroll-into-view="activeAnchor"
    scroll-with-animation
  >
    <view class="day-axis__track">
      <template v-for="node in nodes" :key="node.type === 'year' ? `year-${node.year}` : node.date">
        <text v-if="node.type === 'year'" class="day-axis__year">{{ node.year }}</text>
        <button
          v-else
          :id="'day-' + node.date"
          class="day-chip"
          :class="{ 'day-chip--active': props.selected === node.date }"
          :aria-label="formatFullDateLabel(node.date) + '，共 ' + node.count + ' 条记录'"
          @click="emit('select', node.date)"
        >
          <text class="day-chip__day">{{ dayChipParts(node.date).day }}</text>
          <text class="day-chip__meta">
            {{ dayChipParts(node.date).month }} · {{ node.count }} 条
          </text>
        </button>
      </template>
    </view>
  </scroll-view>
</template>

<style scoped>
.day-axis {
  width: 100%;
  white-space: nowrap;
}

.day-axis__track {
  display: inline-flex;
  min-width: 100%;
  gap: 8px;
  padding: 2px 0 6px;
  border-bottom: 1px solid var(--color-border);
}

.day-chip {
  display: inline-flex;
  min-width: 72px;
  min-height: 54px;
  margin: 0;
  padding: 8px 10px;
  flex: none;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  border: 1px solid var(--color-border);
  border-radius: 13px;
  background: var(--color-surface);
  color: var(--color-muted-strong);
}

.day-chip--active {
  border-color: var(--color-ink);
  background: var(--color-ink);
  color: var(--color-surface);
}

.day-chip__day {
  font-family: var(--font-display);
  font-size: 17px;
  font-weight: 700;
  line-height: 1.1;
}

.day-chip__meta {
  margin-top: 4px;
  color: var(--color-muted);
  font-size: 10px;
  letter-spacing: 0.08em;
}

.day-chip--active .day-chip__meta {
  color: var(--color-surface);
}

.day-axis__year {
  padding: 0 2px;
  align-self: center;
  flex: none;
  color: var(--color-muted);
  font-family: var(--font-display);
  font-size: 11px;
  letter-spacing: 0.12em;
}
</style>