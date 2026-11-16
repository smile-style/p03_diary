import { randomBytes } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

const SECRET_PATTERN = /^[0-9a-f]{64}$/

type SecretFile = {
  jwt: string
  fileUrl: string
}

export type LocalSecrets = {
  jwtSecret: string
  fileUrlSecret: string
}

function createSecrets(): LocalSecrets {
  return {
    jwtSecret: randomBytes(32).toString('hex'),
    fileUrlSecret: randomBytes(32).toString('hex'),
  }
}

function parseSecretFile(raw: string): LocalSecrets | null {
  const parsed = JSON.parse(raw) as Partial<SecretFile>
  if (
    typeof parsed.jwt !== 'string' ||
    !SECRET_PATTERN.test(parsed.jwt) ||
    typeof parsed.fileUrl !== 'string' ||
    !SECRET_PATTERN.test(parsed.fileUrl)
  ) {
    return null
  }
  return { jwtSecret: parsed.jwt, fileUrlSecret: parsed.fileUrl }
}

export async function loadOrCreateSecrets(dataDir: string): Promise<LocalSecrets> {
  const file = join(dataDir, 'secret.key')
  try {
    const existing = parseSecretFile(await readFile(file, 'utf8'))
    if (existing) {
      return existing
    }
  } catch {
    // A missing, unreadable, or malformed key file is replaced below.
  }

  const secrets = createSecrets()
  await mkdir(dataDir, { recursive: true })
  await writeFile(
    file,
    JSON.stringify({ jwt: secrets.jwtSecret, fileUrl: secrets.fileUrlSecret }, null, 2),
    'utf8',
  )
  return secrets
}