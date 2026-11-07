import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const repoRoot = resolve(process.cwd(), '..')

function readRepoFile(relativePath: string): string {
  const absolutePath = resolve(repoRoot, relativePath)
  expect(existsSync(absolutePath), `${relativePath} must exist`).toBe(true)
  return readFileSync(absolutePath, 'utf8').replace(/\r\n/g, '\n')
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function withoutYamlComments(source: string): string {
  return source
    .split('\n')
    .map((line) => (line.trimStart().startsWith('#') ? '' : line.replace(/\s+#.*$/, '')))
    .join('\n')
}

function indentation(line: string): number {
  return line.length - line.trimStart().length
}

function childBlock(source: string, key: string, indent: number): string | undefined {
  const lines = source.split('\n')
  const start = lines.findIndex(
    (line) => indentation(line) === indent && line.trim() === `${key}:`,
  )
  if (start === -1) return undefined

  let end = lines.length
  for (let index = start + 1; index < lines.length; index += 1) {
    const line = lines[index]
    if (line.trim() !== '' && indentation(line) <= indent) {
      end = index
      break
    }
  }
  return lines.slice(start, end).join('\n')
}

function requiredChildBlock(source: string, key: string, indent: number): string {
  const block = childBlock(source, key, indent)
  if (!block) throw new Error(`Expected YAML block ${key} at indent ${indent}`)
  return block
}

function directChildKeys(block: string, indent: number): string[] {
  return block
    .split('\n')
    .filter((line) => indentation(line) === indent)
    .map((line) => line.trim().match(/^([A-Za-z0-9_-]+):$/)?.[1])
    .filter((key): key is string => Boolean(key))
}


function parseEnv(source: string): Map<string, string> {
  const values = new Map<string, string>()
  for (const rawLine of source.split('\n')) {
    const line = rawLine.trim()
    if (!line || line.startsWith('#')) continue
    const separator = line.indexOf('=')
    if (separator === -1) continue
    values.set(line.slice(0, separator), line.slice(separator + 1))
  }
  return values
}

describe('Task 8 deployment configuration', () => {
  it('runs the prebuilt API from a Node 22 Alpine image', () => {
    const dockerfile = readRepoFile('server/Dockerfile')
    const fromLines = dockerfile.split('\n').filter((line) => /^\s*FROM\s+/i.test(line))

    expect(fromLines).toHaveLength(1)
    expect(fromLines[0]).toMatch(/node:22-alpine/i)
    expect(dockerfile).toContain('COPY package.json package-lock.json ./')
    expect(dockerfile).toMatch(/npm ci[^\n]*--omit=dev[^\n]*--ignore-scripts[^\n]*--no-audit[^\n]*--no-fund/)
    expect(dockerfile).toContain('COPY dist ./dist')

    const cmdLines = dockerfile.split('\n').filter((line) => /^\s*CMD\s+/.test(line))
    expect(cmdLines).toHaveLength(1)
    const cmdJson = cmdLines[0].match(/^\s*CMD\s+(\[.*\])\s*$/)?.[1]
    expect(cmdJson).toBeDefined()
    expect(JSON.parse(cmdJson ?? 'null')).toEqual(['node', 'dist/server.js'])
  })

  it('defines db, api, and backup with persistent database and uploads volumes', () => {
    const compose = withoutYamlComments(readRepoFile('docker-compose.yml'))
    const services = requiredChildBlock(compose, 'services', 0)
    expect(directChildKeys(services, 2)).toEqual(['db', 'api', 'backup'])

    const db = requiredChildBlock(services, 'db', 2)
    expect(db).toContain('image: postgres:16')
    expect(db).toContain('env_file: ./server/.env')
    expect(db).toContain('pgdata:/var/lib/postgresql/data')
    expect(db).toContain('healthcheck:')
    expect(db).toContain('pg_isready')

    const api = requiredChildBlock(services, 'api', 2)
    expect(requiredChildBlock(api, 'build', 4)).toContain('context: ./server')
    expect(api).toContain('env_file: ./server/.env')
    expect(api).toContain('- uploads:/data/uploads')
    expect(requiredChildBlock(api, 'environment', 4)).toContain(
      'STORAGE_DIR: /data/uploads',
    )
    expect(requiredChildBlock(requiredChildBlock(api, 'depends_on', 4), 'db', 6)).toContain(
      'condition: service_healthy',
    )
    expect(api).toMatch(/^\s{6}-\s*["']?3000:3000["']?\s*$/m)

    const backup = requiredChildBlock(services, 'backup', 2)
    expect(backup).toContain('image: postgres:16')
    expect(backup).toContain('env_file: ./server/.env')
    expect(backup).toContain('- ./deploy/backup.sh:/deploy/backup.sh:ro')
    expect(backup).toContain('- ./backups:/backups')
    expect(backup).toContain('- uploads:/data/uploads')
    expect(backup).toMatch(/while\s+true/)
    expect(backup).toContain('/deploy/backup.sh')
    expect(backup).toMatch(/sleep\s+86400/)

    const volumes = requiredChildBlock(compose, 'volumes', 0)
    expect(directChildKeys(volumes, 2)).toEqual(['pgdata', 'uploads'])
  })

  it('creates timestamped PostgreSQL and uploads backups and expires old artifacts', () => {
    const script = readRepoFile('deploy/backup.sh')

    expect(script).toMatch(/^#!\/bin\/sh$/m)
    expect(script).toMatch(/^set -eu$/m)
    expect(script).toContain("date -u +'%Y%m%d-%H%M'")
    expect(script).toMatch(/pg_dump\s+-Fc/)
    expect(script).toMatch(/--host=db|PGHOST=["']?db/)
    expect(script).toContain('wxdaily-$timestamp.dump')
    expect(script).toContain('tar -czf')
    expect(script).toContain('wxdaily-$timestamp-uploads.tar.gz')
    expect(script).toContain("find /backups -maxdepth 1 -type f -name 'wxdaily-*'")
    expect(script).toMatch(/-mtime\s+\+14/)
    expect(script).toMatch(/-delete/)

    for (const variable of ['POSTGRES_USER', 'POSTGRES_PASSWORD', 'POSTGRES_DB']) {
      expect(script).toContain(`$${variable}`)
    }
    expect(script).not.toMatch(/PGPASSWORD=["']?[^"'\s$]/)
  })

  it('documents every config key with compose-consistent placeholder credentials', () => {
    const env = parseEnv(readRepoFile('server/.env.example'))
    const requiredKeys = [
      'PORT',
      'DATABASE_URL',
      'JWT_SECRET',
      'FILE_URL_SECRET',
      'WECHAT_APP_ID',
      'WECHAT_SECRET',
      'WECHAT_PUSH_TOKEN',
      'CONTENT_CHECK',
      'STORAGE_DIR',
      'PUBLIC_BASE_URL',
      'POSTGRES_DB',
      'POSTGRES_USER',
      'POSTGRES_PASSWORD',
    ]

    for (const key of requiredKeys) expect(env.has(key), `missing ${key}`).toBe(true)

    const databaseUrl = new URL(env.get('DATABASE_URL') ?? '')
    expect(databaseUrl.protocol).toBe('postgres:')
    expect(databaseUrl.hostname).toBe('db')
    expect(databaseUrl.port).toBe('5432')
    expect(decodeURIComponent(databaseUrl.username)).toBe(env.get('POSTGRES_USER'))
    expect(decodeURIComponent(databaseUrl.password)).toBe(env.get('POSTGRES_PASSWORD'))
    expect(databaseUrl.pathname).toBe(`/${env.get('POSTGRES_DB')}`)

    for (const key of [
      'JWT_SECRET',
      'FILE_URL_SECRET',
      'WECHAT_APP_ID',
      'WECHAT_SECRET',
      'WECHAT_PUSH_TOKEN',
      'POSTGRES_PASSWORD',
    ]) {
      expect(env.get(key)).toMatch(/^(replace-with-|change-me|your-|placeholder-)/i)
    }
    expect(new URL(env.get('PUBLIC_BASE_URL') ?? '').hostname).toBe('api.example.test')
  })

  it('documents server deployment, WeChat development access, backups, and restore order', () => {
    const readme = readRepoFile('deploy/README.md')

    expect(readme).toContain('cp server/.env.example server/.env')
    expect(readme).toContain('docker compose up -d --build')
    expect(readme).toContain('curl -fsS http://<服务器IP>:3000/health')
    expect(readme).toContain('{"ok":true}')
    expect(readme).toMatch(/微信开发者工具/)
    expect(readme).toMatch(/不校验合法域名|关闭[^\n]*校验合法域名/)
    expect(readme).toMatch(/\bIP\b/)
    expect(readme).toMatch(/hosts/)
    expect(readme).toMatch(/域名/)
    expect(readme).toMatch(/ICP/)
    expect(readme).toMatch(/HTTPS/)
    expect(readme).toContain('24 小时')
    expect(readme).toContain('./backups')
    expect(readme).toContain('tar -xzf')
    expect(readme).toContain('--strip-components=1')
    expect(readme).toContain('Docker CLI')
    expect(readme).toMatch(/未(?:在|能)[^\n]*执行|未执行/)

    const stopIndex = readme.indexOf('docker compose stop api')
    const restoreIndex = readme.indexOf('pg_restore')
    const startIndex = readme.indexOf('docker compose start api')
    expect(stopIndex).toBeGreaterThan(-1)
    expect(restoreIndex).toBeGreaterThan(stopIndex)
    expect(startIndex).toBeGreaterThan(restoreIndex)
  })
})
