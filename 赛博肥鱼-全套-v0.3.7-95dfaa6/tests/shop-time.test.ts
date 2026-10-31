import { describe, expect, it } from 'vitest'
import { getShopDisplayTitle, getShopSceneLabel, getShopTime } from '../packages/shared/src/shop-time'

describe('按真实本地时间变化的小店时段', () => {
  it.each([
    ['2026-10-25T21:59:59.999Z', 'night', '05:59'],
    ['2026-10-25T22:00:00.000Z', 'morning', '06:00'],
    ['2026-10-26T01:59:59.999Z', 'morning', '09:59'],
    ['2026-10-26T02:00:00.000Z', 'day', '10:00'],
    ['2026-10-26T08:59:59.999Z', 'day', '16:59'],
    ['2026-10-26T09:00:00.000Z', 'dusk', '17:00'],
    ['2026-10-26T11:59:59.999Z', 'dusk', '19:59'],
    ['2026-10-26T12:00:00.000Z', 'night', '20:00'],
    ['2026-10-26T16:00:00.000Z', 'night', '00:00'],
  ])('%s 对应 %s，显示实际时钟 %s', (instant, phase, timeLabel) => {
    const time = getShopTime(new Date(instant), 'Asia/Shanghai')
    expect(time).toMatchObject({ phase, actualPhase: phase, manual: false, timeLabel })
  })

  it('明确时区只改变本地时段，不改变传入的时刻', () => {
    const instant = new Date('2026-10-26T02:00:00Z')
    expect(getShopTime(instant, 'Asia/Shanghai')).toMatchObject({ phase: 'day', timeLabel: '10:00' })
    expect(getShopTime(instant, 'UTC')).toMatchObject({ phase: 'night', timeLabel: '02:00' })
    expect(instant.toISOString()).toBe('2026-10-26T02:00:00.000Z')
  })

  it('手动夜景不伪造真实白天、日期或时钟，切回自动立即回到白天', () => {
    const instant = Date.parse('2026-10-26T05:30:00Z')
    expect(getShopTime(instant, 'Asia/Shanghai', 'night')).toMatchObject({ phase: 'night', actualPhase: 'day', manual: true, title: '肥鱼深夜小店', timeLabel: '13:30' })
    expect(getShopTime(instant, 'Asia/Shanghai', 'auto')).toMatchObject({ phase: 'day', actualPhase: 'day', manual: false, title: '肥鱼日间小店', timeLabel: '13:30' })
  })

  it('四段文案与标题各自适配，默认店名自动变化，店长自定义店名保留', () => {
    const morning = getShopTime(Date.parse('2026-10-25T23:00:00Z'), 'Asia/Shanghai')
    expect(morning.title).toBe('肥鱼晨光小店'); expect(morning.greeting).toContain('早上好'); expect(morning.menuLabel).toBe('晨光菜单')
    expect(getShopDisplayTitle('肥鱼深夜小店', morning)).toBe('肥鱼晨光小店')
    expect(getShopDisplayTitle('肥鱼小店', morning)).toBe('肥鱼晨光小店')
    expect(getShopDisplayTitle('阿暖的咖啡屋', morning)).toBe('阿暖的咖啡屋')
    expect(getShopDisplayTitle('', morning)).toBe('肥鱼晨光小店')
  })

  it('无效日期以中文说明，防止悄悄显示错误时段', () => {
    expect(() => getShopTime(new Date('invalid'))).toThrow('小店时间无效')
  })

  it('相同天气编号在昼夜有相应名称，不把白天称作雨夜或星空', () => {
    expect(getShopSceneLabel('rain', 'day')).toBe('雨天')
    expect(getShopSceneLabel('rain', 'night')).toBe('雨夜')
    expect(getShopSceneLabel('stars', 'morning')).toBe('晴空')
    expect(getShopSceneLabel('stars', 'dusk')).toBe('晚霞')
    expect(getShopSceneLabel('stars', 'night')).toBe('星空')
    expect(getShopSceneLabel('fireflies', 'day')).toBe('夏日草地')
  })
})
