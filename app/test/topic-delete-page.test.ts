// @ts-expect-error 测试运行在 Node 环境，但 uni 的 tsconfig 不包含 Node 类型
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const pageUrl = new URL('../src/pages/topic/detail.vue', import.meta.url)

describe('topic delete page', () => {
  it('wires the delete flow through the existing topic API', () => {
    const source = readFileSync(pageUrl, 'utf8')

    expect(source).toContain('topicDeleteConfirmContent(')
    expect(source).toContain('deleteTopic(')
    expect(source).toContain("confirmColor: '#d94b4b'")
    expect(source).toContain("setTimeout(() => uni.navigateBack(), 350)")
  })

  it('guards duplicate deletion and handles success and failure', () => {
    const source = readFileSync(pageUrl, 'utf8')

    expect(source).toContain('if (deleting.value || !topic.value) return')
    expect(source).toContain("uni.showToast({ title: '已删除', icon: 'success' })")
    expect(source).toContain('showToast(messageOf(deleteError))')
  })

  it('places a guarded danger action before the create action', () => {
    const source = readFileSync(pageUrl, 'utf8')
    const actionsStart = source.indexOf('<template #actions>')
    const actionsEnd = source.indexOf('</template>', actionsStart)
    const deleteButton = source.indexOf('class="app-button app-button--danger"')
    const createAction = source.indexOf('在这个主题下记录', actionsStart)

    expect(actionsStart).toBeGreaterThan(-1)
    expect(actionsEnd).toBeGreaterThan(actionsStart)
    expect(source).toContain(':disabled="deleting"')
    expect(source).toContain("{{ deleting ? '删除中…' : '删除主题' }}")
    expect(deleteButton).toBeGreaterThan(actionsStart)
    expect(deleteButton).toBeLessThan(createAction)
    expect(createAction).toBeLessThan(actionsEnd)
  })
})