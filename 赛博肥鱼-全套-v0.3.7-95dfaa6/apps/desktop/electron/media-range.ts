/** A single HTTP byte range for Chromium's audio loader. Multiple ranges are not needed. */
export function audioByteRange(header: string | null, size: number): { start: number; end: number; status: 200 | 206 } | undefined {
  if (!header) return { start: 0, end: size - 1, status: 200 }
  const match = /^bytes=(\d*)-(\d*)$/.exec(header)
  if (!match || (!match[1] && !match[2]) || size < 1) return
  if (!match[1]) {
    const suffix = Number(match[2])
    if (!Number.isSafeInteger(suffix) || suffix < 1) return
    return { start: Math.max(0, size - suffix), end: size - 1, status: 206 }
  }
  const start = Number(match[1]), requestedEnd = match[2] ? Number(match[2]) : size - 1
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(requestedEnd) || start >= size || start > requestedEnd) return
  return { start, end: Math.min(size - 1, requestedEnd), status: 206 }
}
