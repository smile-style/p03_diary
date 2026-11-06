import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path'

export interface FileStorage {
  put(key: string, data: Buffer): Promise<void>
  get(key: string): Promise<Buffer | null>
  remove(key: string): Promise<void>
}

export class LocalFileStorage implements FileStorage {
  private readonly root: string

  constructor(dir: string) {
    this.root = resolve(dir)
  }

  async put(key: string, data: Buffer): Promise<void> {
    const target = this.resolveKey(key)
    await mkdir(dirname(target), { recursive: true })
    await writeFile(target, data)
  }

  async get(key: string): Promise<Buffer | null> {
    try {
      return await readFile(this.resolveKey(key))
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return null
      }
      throw error
    }
  }

  async remove(key: string): Promise<void> {
    await rm(this.resolveKey(key), { force: true })
  }

  private resolveKey(key: string): string {
    if (key.length === 0 || isAbsolute(key)) {
      throw new Error('Invalid storage key')
    }

    const target = resolve(this.root, key)
    const relativeTarget = relative(this.root, target)
    if (
      relativeTarget.length === 0 ||
      relativeTarget === '..' ||
      relativeTarget.startsWith(`..${sep}`) ||
      isAbsolute(relativeTarget)
    ) {
      throw new Error('Invalid storage key')
    }

    return target
  }
}
