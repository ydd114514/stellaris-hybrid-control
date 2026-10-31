import { describe, expect, it } from 'vitest'
import { parseScreenCandidates, validNormalizedRect, type OCRObservation } from '../apps/desktop/electron/live-screen-parser'
const row = (text: string, x: number, y: number, width: number, height: number): OCRObservation => ({ text, region: 'gift', confidence: .5, bounds: { x, y, width, height } })
describe('礼物卡分行与小数量文字框', () => {
  it('现场布局：完整header与下行小x1均左对齐、约22px间隔，两张同名卡各得到1', () => {
    const rows = [row('小周 送出 小心心', .812, .35, .17, .012), row('x1', .812, .371, .008, .009), row('小周 送出 小心心', .812, .42, .17, .012), row('x1', .812, .441, .008, .009)]
    const gifts = parseScreenCandidates(rows)
    expect(gifts).toHaveLength(2); expect(gifts.map(gift => gift.count)).toEqual([1, 1]); expect(gifts.every(gift => gift.userName === '小周' && gift.giftName === '小心心')).toBe(true)
    expect(gifts[0]!.bounds!.y).not.toBe(gifts[1]!.bounds!.y)
  })
  it('下行数量可在卡片水平范围内，不能越过下一张卡借用左对齐数量', () => {
    const a = row('用户1234567890123 送出 小心心', .812, .35, .17, .012), b = row('用户1234567890123 送出 小心心', .812, .395, .17, .012)
    expect(parseScreenCandidates([a, row('x1', .85, .371, .008, .009)])[0]?.count).toBe(1)
    const gifts = parseScreenCandidates([a, b, row('x1', .812, .416, .008, .009)])
    expect(gifts).toHaveLength(1); expect(gifts[0]!.bounds!.y).toBe(.395)
    expect(parseScreenCandidates([a, row('送出 玫瑰', .812, .367, .10, .012), row('x1', .812, .383, .008, .009)])).toEqual([])
  })
  it('昵称、送出行、x1拆成三行时，两张同名卡保持两个独立候选', () => {
    const rows = [row('小周', .812, .345, .035, .016), row('送出 小心心', .812, .367, .10, .015), row('x1', .962, .367, .008, .009), row('小周', .812, .410, .035, .016), row('送出 小心心', .812, .432, .10, .015), row('x1', .962, .432, .008, .009)]
    const gifts = parseScreenCandidates(rows)
    expect(gifts).toHaveLength(2); expect(gifts.map(gift => gift.count)).toEqual([1, 1]); expect(gifts.map(gift => gift.userName)).toEqual(['小周', '小周'])
  })
  it('同水平的tiny x1可以使用，ROI设置仍需至少1%且边界严格不超过1', () => {
    const tiny = row('x1', .962, .354, .008, .009)
    expect(validNormalizedRect(tiny.bounds)).toBe(false)
    expect(parseScreenCandidates([row('小周送出小心心', .812, .35, .12, .017), tiny])[0]?.count).toBe(1)
    expect(validNormalizedRect({ x: .9, y: .2, width: .1000001, height: .1 })).toBe(false)
    for (const bounds of [{ x: .99, y: .35, width: .011, height: .01 }, { x: .8, y: .99, width: .01, height: .011 }, { x: .8, y: .3, width: 0, height: .01 }, { x: -.001, y: .3, width: .01, height: .01 }, { x: .8, y: .3, width: Number.NaN, height: .01 }]) expect(parseScreenCandidates([{ ...tiny, bounds }])).toEqual([])
  })
  it('没有可见数量、低置信数量或音浪总数时不默认猜1', () => {
    const header = row('小周送出小心心', .812, .35, .12, .017)
    expect(parseScreenCandidates([header])).toEqual([])
    expect(parseScreenCandidates([header, { ...row('x1', .962, .375, .008, .009), confidence: .29 }])).toEqual([])
    expect(parseScreenCandidates([header, row('音浪 2', .962, .375, .03, .009)])).toEqual([])
    for (const value of ['x0', 'x100001', 'x1.2', '1']) expect(parseScreenCandidates([header, row(value, .962, .375, .008, .009)])).toEqual([])
  })
  it('数量位于两个卡片中间或同一卡有两个数量时，保守拒绝', () => {
    const a = row('小周送出小心心', .812, .35, .12, .017), b = row('小猫送出小心心', .812, .39, .12, .017)
    expect(parseScreenCandidates([a, b, row('x1', .962, .370, .008, .017)])).toEqual([])
    expect(parseScreenCandidates([a, row('x1', .95, .375, .008, .009), row('x2', .975, .375, .008, .009)])).toEqual([])
  })
  it('下一张卡的数量不借给前一张缺数卡，已完整卡的数量也不重复使用', () => {
    const a = row('小周送出小心心', .812, .35, .12, .017), b = row('小猫送出小心心', .812, .42, .12, .017)
    expect(parseScreenCandidates([a, b, row('x1', .962, .445, .008, .009)]).map(gift => gift.userName)).toEqual(['小猫'])
    const complete = [row('小周送出小心心', .812, .35, .12, .017), row('小猫送出小心心', .812, .375, .12, .017), row('x1', .962, .375, .008, .017)]
    const result = parseScreenCandidates(complete)
    expect(result).toHaveLength(1); expect(result[0]).toMatchObject({ userName: '小猫', count: 1 })
  })
  it('不从被截断或多个可能昵称中猜送礼人，评论假送仍只是chat', () => {
    expect(parseScreenCandidates([row('小…', .812, .345, .035, .016), row('送出小心心', .812, .367, .10, .015), row('x1', .962, .367, .008, .009)])).toEqual([])
    expect(parseScreenCandidates([row('小周', .812, .345, .035, .016), row('小猫', .818, .346, .035, .016), row('送出小心心', .812, .367, .10, .015), row('x1', .962, .367, .008, .009)])).toEqual([])
    expect(parseScreenCandidates([{ ...row('小周：送出了小心心x1', .812, .35, .16, .017), region: 'comment' }]).map(event => event.kind)).toEqual(['chat'])
  })
})
