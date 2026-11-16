<script lang="ts">
import { useAuthStore } from './stores/auth'

export default {
  onLaunch() {
    void useAuthStore().ensureSession()
  },
}
</script>

<style>
page {
  --color-primary: #07c160;
  --color-muted: #8a8a8a;
  --color-border: #eeeeee;
  --color-star: #f0a020;
  --color-text: #202020;
  --color-bg: #f7f7f7;
  --color-timeline-axis: #d0021b;
  --color-timeline-line: #e6e6e6;
  background: var(--color-bg);
  color: var(--color-text);
  font-family: -apple-system, BlinkMacSystemFont, "PingFang SC", "Microsoft YaHei", sans-serif;
  font-size: 28rpx;
  box-sizing: border-box;
}

view,
text,
button,
input,
textarea,
scroll-view {
  box-sizing: border-box;
}

button::after {
  border: 0;
}
</style>
