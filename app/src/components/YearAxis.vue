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
      <view
        id="year-all"
        class="year-node year-node--all"
        @click="emit('select', null)"
      >
        <text
          class="year-node__year"
          :class="{ 'year-node__year--active': props.selected === null }"
        >
          全部
        </text>
        <view
          class="year-node__dot"
          :class="{ 'year-node__dot--active': props.selected === null }"
        />
        <text class="year-node__count year-node__count--placeholder" />
      </view>

      <view
        v-for="item in items"
        :id="'year-' + item.year"
        :key="item.year"
        class="year-node"
        @click="emit('select', item.year)"
      >
        <text
          class="year-node__year"
          :class="{ 'year-node__year--active': props.selected === item.year }"
        >
          {{ item.year }}
        </text>
        <view
          class="year-node__dot"
          :class="{ 'year-node__dot--active': props.selected === item.year }"
        />
        <text class="year-node__count">{{ item.count }}</text>
      </view>
    </view>
  </scroll-view>
</template>

<style scoped>
.year-axis {
  width: 100%;
  background: #ffffff;
  border-bottom: 1rpx solid var(--color-timeline-line);
  white-space: nowrap;
}

.year-axis__track {
  display: inline-flex;
  align-items: flex-start;
  min-width: 100%;
  padding: 16rpx 36rpx 18rpx;
}

.year-node {
  position: relative;
  display: flex;
  flex: none;
  flex-direction: column;
  align-items: center;
  width: 112rpx;
}

.year-node__year {
  height: 40rpx;
  color: var(--color-muted);
  font-size: 26rpx;
  line-height: 40rpx;
  transition: color 0.2s ease;
}

.year-node__year--active {
  color: var(--color-timeline-axis);
  font-weight: 700;
}

.year-node__dot {
  position: relative;
  width: 36rpx;
  height: 36rpx;
  margin: 8rpx 0;
  border: 4rpx solid var(--color-timeline-axis);
  border-radius: 50%;
  background: #ffffff;
  transition: background 0.2s ease, transform 0.2s ease;
}

.year-node__dot--active {
  background: var(--color-timeline-axis);
  transform: scale(1.08);
}

.year-node__dot::before,
.year-node__dot::after {
  position: absolute;
  top: 50%;
  width: 76rpx;
  height: 4rpx;
  background: var(--color-timeline-axis);
  content: '';
  transform: translateY(-50%);
}

.year-node__dot::before {
  right: 100%;
}

.year-node__dot::after {
  left: 100%;
}

.year-node:first-child .year-node__dot::before {
  display: none;
}

.year-node:last-child .year-node__dot::after {
  display: none;
}

.year-node__count {
  min-height: 34rpx;
  color: var(--color-muted);
  font-size: 22rpx;
  line-height: 34rpx;
}

.year-node__count--placeholder {
  display: block;
}
</style>