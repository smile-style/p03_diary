import { createHmac, timingSafeEqual } from 'node:crypto'

const SIGNATURE_PATTERN = /^[a-f0-9]{64}$/

function signatureFor(key: string, exp: number, secret: string): string {
  return createHmac('sha256', secret).update(`${key}${exp}`).digest('hex')
}

export function signFileUrl(
  key: string,
  secret: string,
  baseUrl: string,
  ttlSec = 3600,
): string {
  const exp = Math.floor(Date.now() / 1000) + Math.floor(ttlSec)
  const signature = signatureFor(key, exp, secret)
  const base = baseUrl.replace(/\/+$/, '')
  return `${base}/files/${key}?exp=${exp}&sig=${signature}`
}

export function verifyFileUrl(
  key: string,
  exp: string | number,
  sig: string,
  secret: string,
  now = Date.now(),
): boolean {
  const parsedExp =
    typeof exp === 'number'
      ? exp
      : typeof exp === 'string' && /^\d+$/.test(exp)
        ? Number(exp)
        : Number.NaN

  if (
    !Number.isSafeInteger(parsedExp) ||
    parsedExp < 0 ||
    typeof sig !== 'string' ||
    !SIGNATURE_PATTERN.test(sig) ||
    parsedExp < Math.floor(now / 1000)
  ) {
    return false
  }

  const expected = Buffer.from(signatureFor(key, parsedExp, secret), 'hex')
  const actual = Buffer.from(sig, 'hex')
  return expected.length === actual.length && timingSafeEqual(expected, actual)
}
