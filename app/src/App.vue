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
  --color-bg: #f3efe8;
  --color-sidebar: #ece6dc;
  --color-surface: #fffcf7;
  --color-surface-muted: #f8f3ec;
  --color-ink: #262119;
  --color-text: #2d2822;
  --color-muted: #756b60;
  --color-muted-strong: #5b5147;
  --color-border: #e4dcd1;
  --color-border-strong: #cfc3b5;
  --color-accent: #9a3412;
  --color-accent-hover: #7c2d12;
  --color-on-accent: #ffffff;
  --color-accent-soft: #f5e2d5;
  --color-star: #b45309;
  --color-star-soft: #fff4e2;
  --color-success: #3f6b54;
  --color-success-soft: #e1eee6;
  --color-danger: #b42318;
  --color-danger-soft: #fce8e5;
  --color-focus: #c2410c;
  --color-primary: var(--color-accent);
  --color-star-old: var(--color-star);
  --font-ui: "Microsoft YaHei UI", "PingFang SC", "Noto Sans CJK SC", sans-serif;
  --font-display: "Songti SC", "STSong", "Source Han Serif SC", "Noto Serif CJK SC", serif;
  --shadow-card: 0 16px 44px rgba(61, 47, 35, 0.065);
  --shadow-soft: 0 8px 24px rgba(61, 47, 35, 0.055);
  --radius-card: 18px;
  --radius-control: 12px;
  background: var(--color-bg);
  color: var(--color-text);
  font-family: var(--font-ui);
  font-size: 15px;
  line-height: 1.6;
  box-sizing: border-box;
}

html,
body {
  background: var(--color-bg);
}

view,
text,
button,
input,
textarea,
scroll-view {
  box-sizing: border-box;
}

button {
  cursor: pointer;
  font-family: inherit;
  transition:
    background-color 180ms ease,
    border-color 180ms ease,
    color 180ms ease,
    box-shadow 180ms ease,
    transform 180ms ease,
    opacity 180ms ease;
}

button::after {
  border: 0;
}

button[disabled] {
  cursor: not-allowed;
}

input,
textarea {
  font-family: inherit;
}

image {
  display: block;
}

button:focus-visible,
input:focus-visible,
textarea:focus-visible,
[role="button"]:focus-visible {
  outline: 2px solid var(--color-focus);
  outline-offset: 3px;
}

.app-button {
  display: inline-flex;
  min-height: 44px;
  align-items: center;
  justify-content: center;
  gap: 8px;
  margin: 0;
  padding: 0 18px;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-control);
  background: var(--color-surface);
  color: var(--color-text);
  font-size: 13px;
  font-weight: 600;
  line-height: 1;
  letter-spacing: 0.02em;
}

.app-button:hover {
  border-color: var(--color-border-strong);
  background: var(--color-surface-muted);
}

.app-button--primary {
  border-color: var(--color-accent);
  background: var(--color-accent);
  box-shadow: 0 8px 20px rgba(154, 52, 18, 0.17);
  color: var(--color-on-accent);
}

.app-button--primary:hover {
  border-color: var(--color-accent-hover);
  background: var(--color-accent-hover);
  transform: translateY(-1px);
}

.app-button--ghost {
  border-color: transparent;
  background: transparent;
  color: var(--color-muted-strong);
}

.app-button--ghost:hover {
  background: var(--color-surface-muted);
  color: var(--color-ink);
}

.app-button--danger {
  border-color: color-mix(in srgb, var(--color-danger) 28%, transparent);
  background: var(--color-surface);
  color: var(--color-danger);
}

.app-button--danger:hover {
  background: var(--color-danger-soft);
}

.app-button--small {
  min-height: 44px;
  padding: 0 14px;
  font-size: 12px;
}

.app-button[disabled] {
  opacity: 0.45;
}

.icon-button {
  display: inline-flex;
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
  color: var(--color-muted-strong);
}

.icon-button:hover {
  border-color: var(--color-border-strong);
  background: var(--color-surface-muted);
  color: var(--color-ink);
}

.page-scroll {
  width: 100%;
  height: 100%;
}

.page-state {
  display: flex;
  min-height: 360px;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 14px;
  padding: 48px;
  color: var(--color-muted);
  text-align: center;
}

.page-state__title {
  color: var(--color-ink);
  font-family: var(--font-display);
  font-size: 24px;
  font-weight: 700;
}

.page-state__message {
  max-width: 520px;
  color: var(--color-muted);
  font-size: 13px;
  line-height: 1.7;
}

.page-state__error {
  max-width: 620px;
  color: var(--color-danger);
  font-size: 13px;
  line-height: 1.7;
}

.loading-more,
.list-end {
  padding: 26px 18px;
  color: var(--color-muted);
  font-size: 12px;
  letter-spacing: 0.05em;
  text-align: center;
}

@keyframes surface-rise {
  from {
    opacity: 0;
    transform: translateY(8px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

@media (min-width: 700px) {
  uni-page-head,
  .uni-page-head,
  .uni-tabbar-bottom,
  .uni-tabbar {
    display: none !important;
  }

  .uni-app--showtabbar uni-page-wrapper {
    height: 100% !important;
  }

  .uni-app--showtabbar uni-page-wrapper::after {
    display: none !important;
  }
}

@media (prefers-reduced-motion: reduce) {
  *,
  *::before,
  *::after {
    scroll-behavior: auto !important;
    animation-duration: 0.01ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 0.01ms !important;
  }
}
</style>
