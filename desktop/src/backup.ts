import { mkdir, readdir, rm } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { DatabaseSync } from 'node:sqlite'

function backupName(now: Date): string {
  const iso = now.toISOString()
  const date = iso.slice(0, 10).replaceAll('-', '')
  const time = iso.slice(11, 19).replaceAll(':', '')
  return `app-${date}-${time}.db`
}

export async function backupDatabase(
  databaseFile: string,
  backupsDir: string,
  now = new Date(),
  keep = 30,
): Promise<string> {
  await mkdir(backupsDir, { recursive: true })
  const backupPath = resolve(backupsDir, backupName(now))
  const sqlitePath = backupPath.replaceAll('\\', '/').replaceAll("'", "''")
  const db = new DatabaseSync(databaseFile)

  try {
    db.exec(`vacuum into '${sqlitePath}'`)
  } finally {
    db.close()
  }

  const files = (await readdir(backupsDir))
    .filter((file) => file.startsWith('app-') && file.endsWith('.db'))
    .sort()
  for (const file of files.slice(0, Math.max(0, files.length - keep))) {
    await rm(join(backupsDir, file))
  }

  return backupPath
}
