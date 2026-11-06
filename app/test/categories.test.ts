import { beforeEach, describe, expect, it, vi } from 'vitest'
import { request } from '../src/api/client'
import {
  createCategory,
  deleteCategory,
  listCategories,
  updateCategory,
} from '../src/api/categories'

vi.mock('../src/api/client', () => ({
  request: vi.fn(),
}))

const category = { id: 'category-1', name: '生活', sortOrder: 1 }

describe('categories api', () => {
  beforeEach(() => {
    vi.mocked(request).mockReset()
  })

  it('lists categories through the documented endpoint', async () => {
    vi.mocked(request).mockResolvedValueOnce({ items: [category] })

    await expect(listCategories()).resolves.toEqual({ items: [category] })
    expect(request).toHaveBeenCalledWith('/categories')
  })

  it('creates a category with only its name', async () => {
    vi.mocked(request).mockResolvedValueOnce(category)

    await expect(createCategory('生活')).resolves.toEqual(category)
    expect(request).toHaveBeenCalledWith('/categories', {
      method: 'POST',
      body: { name: '生活' },
    })
  })

  it('updates a category through its encoded endpoint', async () => {
    vi.mocked(request).mockResolvedValueOnce({ ...category, name: '日常' })

    await updateCategory('category/1', { name: '日常', sortOrder: 3 })
    expect(request).toHaveBeenCalledWith('/categories/category%2F1', {
      method: 'PATCH',
      body: { name: '日常', sortOrder: 3 },
    })
  })

  it('deletes a category through its encoded endpoint', async () => {
    vi.mocked(request).mockResolvedValueOnce(undefined)

    await deleteCategory('category-1')
    expect(request).toHaveBeenCalledWith('/categories/category-1', {
      method: 'DELETE',
    })
  })
})