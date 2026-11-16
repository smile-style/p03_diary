import { join, normalize, sep } from 'node:path'

const DATA_DIR_NAME = 'wx-daily'

export function resolveDataDir(opts: {
  documentsPath: string
  homePath: string
  oneDrivePath: string | null
  override?: string
}): string {
  if (opts.override?.trim()) {
    return normalize(opts.override)
  }

  const documents = normalize(opts.documentsPath)
  const oneDrive = opts.oneDrivePath ? normalize(opts.oneDrivePath) : null
  if (
    oneDrive !== null &&
    documents.toLowerCase().startsWith(`${oneDrive.toLowerCase()}${sep}`)
  ) {
    return join(opts.homePath, DATA_DIR_NAME)
  }

  return join(opts.documentsPath, DATA_DIR_NAME)
}