import { request } from './client'
import type { Category } from './types'

export async function listCategories(): Promise<{ items: Category[] }> {
  return request<{ items: Category[] }>('/categories')
}

export async function createCategory(name: string): Promise<Category> {
  return request<Category>('/categories', {
    method: 'POST',
    body: { name },
  })
}

export async function updateCategory(
  id: string,
  changes: { name?: string; sortOrder?: number },
): Promise<Category> {
  return request<Category>(`/categories/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    body: changes,
  })
}

export async function deleteCategory(id: string): Promise<void> {
  await request<void>(`/categories/${encodeURIComponent(id)}`, {
    method: 'DELETE',
  })
}