import { afterEach, describe, expect, it, vi } from 'vitest'
import { createLiveScreenInput } from '../apps/desktop/electron/live-screen-input'

describe('Windows selected-window OCR lifecycle', () => {
  let reader: ReturnType<typeof createLiveScreenInput> | undefined
  afterEach(() => { reader?.dispose(); vi.useRealTimers() })
  it('supports Windows and confirms comments across consecutive frames', async () => {
    vi.useFakeTimers()
    const onCandidates = vi.fn()
    const recognize = vi.fn(async (_request: { windowId: number }) => ({ version: 1, observations: [{ text: '小周：你好呀', region: 'comment' as const, confidence: .5, bounds: { x: .81, y: .5, width: .15, height: .03 } }] }))
    reader = createLiveScreenInput({ platform: 'win32', listSources: async () => [{ id: 'window:104:0', name: '抖音直播伴侣' }, { id: 'window:105:0', name: '私人文档' }], recognize, onCandidates })
    expect(await reader.listWindows()).toEqual([{ id: 'window:104:0', name: '抖音直播伴侣' }])
    await reader.start({ windowId: 'window:104:0' })
    expect(onCandidates).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1600)
    expect(reader.status().state).toBe('reading')
    expect(onCandidates).toHaveBeenCalledOnce()
    expect(recognize.mock.calls.every(call => call[0].windowId === 104)).toBe(true)
    reader.stop()
    await vi.advanceTimersByTimeAsync(5000)
    expect(recognize).toHaveBeenCalledTimes(2)
  })
  it('reports missing Chinese OCR instead of creating candidates', async () => {
    const onCandidates = vi.fn()
    reader = createLiveScreenInput({ platform: 'win32', listSources: async () => [{ id: 'window:104:0', name: '抖音直播伴侣' }], recognize: async () => ({ version: 1, observations: [], error: 'ocr-language' }), onCandidates })
    await reader.start({ windowId: 'window:104:0' })
    expect(reader.status().message).toContain('中文 OCR')
    expect(onCandidates).not.toHaveBeenCalled()
  })
})
