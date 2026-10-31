import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, writeFile, appendFile, rename, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createModObserver, parseModLog } from '../src/mod-observer.mjs'

const keys = ['energy', 'minerals', 'food', 'consumer_goods', 'alloys', 'influence', 'unity']
function frame({ date = '2200.01.01', name = '大肥鱼帝国', stock = '100.5', income = '-1.25', prefix = '', newline = true } = {}) {
 const lines = [`FISH_OBS|1|BEGIN|${date}|${name}`, ...keys.map(key => `FISH_OBS|1|RESOURCE|${key}|${stock}|${income}`), `FISH_OBS|1|END|${date}|${name}`]
 return lines.map(line => prefix + line).join('\n') + (newline ? '\n' : '')
}
async function temporary(t) {
 const directory = await mkdtemp(join(tmpdir(), 'fish-mod-log-'))
 t.after(() => rm(directory, { recursive: true, force: true }))
 return join(directory, 'game.log')
}

test('严格完整资源帧保留有限数字与月度警告，并选择最新完整帧', () => {
 const result = parseModLog(frame({ stock: '0' }) + frame({ date: '2200.02.01', stock: '1e3', income: '+2.75' }))
 assert.equal(result.source, 'mod-log'); assert.equal(result.gameDate, '2200.02.01')
 assert.equal(result.player.name, '大肥鱼帝国')
 assert.deepEqual(Object.keys(result.player.resources.stockpiles), keys)
 assert.equal(result.player.resources.stockpiles.energy, 1000)
 assert.equal(result.player.resources.monthlyIncome.unity, 2.75)
 assert.match(result.warnings.join(' '), /月度.*并非逐帧/)
 assert.equal(parseModLog(frame({ stock: '0' })).player.resources.stockpiles.energy, 0)
 assert.equal(parseModLog(frame()).player.resources.monthlyIncome.energy, -1.25)
})

test('接受标准game.log前缀、BOM和CRLF，但不接受文本中嵌入的伪标记', () => {
 for (const prefix of ['', '[12:00:00][effect_impl.cpp:123]: ', '[2026-10-26 12:00:00][effect_impl.cpp:123]: ']) assert.equal(parseModLog(frame({ prefix })).player.name, '大肥鱼帝国')
 assert.equal(parseModLog('\uFEFF' + frame().replaceAll('\n', '\r\n')).gameDate, '2200.01.01')
 for (const prefix of ['观众说：', 'some other log: ', '[12:00:00][chat.cpp:1]: 玩家说 ', '"', 'FAKE_']) assert.equal(parseModLog(frame({ prefix })), null)
 assert.equal(parseModLog(frame().replaceAll('FISH_OBS|1|', 'FISH_OBS|10|')), null)
 const interleaved = frame().replace('\n', '\n[12:00:00][other.cpp:1]: ordinary game log\n')
 assert.ok(parseModLog(interleaved))
})

test('断帧、begin/end错配、未知资源、重复资源与多余分隔符均拒绝', () => {
 const original = frame()
 const invalid = [
  original.split('\n').slice(1).join('\n'), original.replace(/FISH_OBS\|1\|END[^\n]*\n/, ''),
  original.replace('END|2200.01.01', 'END|2200.02.01'), original.replace('END|2200.01.01|大肥鱼帝国', 'END|2200.01.01|其他帝国'),
  original.replace('RESOURCE|food|100.5|-1.25\n', ''), original.replace('RESOURCE|food|', 'RESOURCE|energy|'),
  original.replace('RESOURCE|food|', 'RESOURCE|dark_matter|'), original.replace('BEGIN|2200.01.01|大肥鱼帝国', 'BEGIN|2200.01.01|大肥|鱼帝国'),
  original.replace('END|2200.01.01|大肥鱼帝国', 'END|2200.01.01|大肥鱼帝国|额外字段'),
 ]
 for (const text of invalid) assert.equal(parseModLog(text), null)
})

test('不把未展开变量、空串、NaN或无穷数字转换成0', () => {
 for (const value of ['[This.fish_energy]', '\\[This.fish_energy]', 'NaN', 'Infinity', '-Infinity', '1e9999', '', ' ', '0x10', '1,000', '100|200']) {
  assert.equal(parseModLog(frame({ stock: value })), null, `stock=${value}`)
  assert.equal(parseModLog(frame({ income: value })), null, `income=${value}`)
 }
 assert.equal(parseModLog(frame({ date: '[GetDate]' })), null)
 assert.equal(parseModLog(frame({ name: '[This.GetName]' })), null)
})

test('minOffset只允许其后开始的完整帧；截到旧帧内部不能拼接', () => {
 const first = frame({ name: '甲帝国' }), second = frame({ name: '甲帝国', date: '2200.02.01' }), text = first + second
 assert.equal(parseModLog(text, { minOffset: first.length }).gameDate, '2200.02.01')
 assert.equal(parseModLog(text, { minOffset: first.length + 1 }), null)
 assert.equal(parseModLog(first, { minOffset: first.indexOf('RESOURCE') }), null)
 assert.equal(parseModLog(text, { minOffset: text.length + 1 }), null)
})

test('多个不同帝国名必须显式指定playerName，不能猜最新帧就是玩家', () => {
 const text = frame({ name: '甲帝国' }) + frame({ name: '乙帝国', date: '2200.02.01' })
 assert.equal(parseModLog(text), null)
 assert.equal(parseModLog(text, { playerName: '甲帝国' }).player.name, '甲帝国')
 assert.equal(parseModLog(text, { playerName: '乙帝国' }).gameDate, '2200.02.01')
 assert.equal(parseModLog(text, { playerName: '不存在' }), null)
 assert.equal(parseModLog(text, { playerName: '甲|帝国' }), null)
})

test('启动前完整帧和启动前开始的断帧不进入模型；仅接受之后新BEGIN', async t => {
 const logPath = await temporary(t), old = frame({ date: '2199.12.01', name: '旧局' }), partial = frame({ name: '跨启动旧局' }).split('\n')
 await writeFile(logPath, old + partial.slice(0, 4).join('\n') + '\n')
 const observer = await createModObserver({ logPath })
 assert.equal(await observer.read(), null)
 await appendFile(logPath, partial.slice(4).join('\n'))
 assert.equal(await observer.read(), null)
 await appendFile(logPath, frame({ date: '2200.03.01' }))
 const result = await observer.read()
 assert.equal(result.gameDate, '2200.03.01'); assert.equal(result.player.name, '大肥鱼帝国')
 assert.equal((await observer.read()).gameDate, '2200.03.01')
 result.player.resources.stockpiles.energy = -9999
 assert.equal((await observer.read()).player.resources.stockpiles.energy, 100.5)
})

test('允许初始化时日志不存在，文件出现后从0读取，END未换行不提前暴露', async t => {
 const logPath = await temporary(t), observer = await createModObserver({ logPath })
 assert.equal(await observer.read(), null)
 await writeFile(logPath, frame({ newline: false }))
 assert.equal(await observer.read(), null)
 await appendFile(logPath, '\n')
 assert.equal((await observer.read()).player.name, '大肥鱼帝国')
})

test('有界增量跨多次read和UTF8字节边界仍能拼成完整帧', async t => {
 const logPath = await temporary(t), observer = await createModObserver({ logPath, maxBytes: 13 })
 await writeFile(logPath, frame({ name: '大肥鱼🌏帝国' }))
 let result
 for (let i = 0; i < 100; i++) { result = await observer.read(); if (result) break }
 assert.equal(result.player.name, '大肥鱼🌏帝国')
 assert.equal(result.player.resources.stockpiles.food, 100.5)
})

test('rotate和truncate清除旧缓存，部分新帧不能回退旧局', async t => {
 const logPath = await temporary(t), observer = await createModObserver({ logPath })
 await writeFile(logPath, frame({ name: '先前帝国' })); assert.equal((await observer.read()).player.name, '先前帝国')
 await rename(logPath, logPath + '.old')
 const next = frame({ name: '新局帝国', date: '2201.01.01' }), cut = next.indexOf('RESOURCE|food')
 await writeFile(logPath, next.slice(0, cut))
 assert.equal(await observer.read(), null)
 await appendFile(logPath, next.slice(cut))
 assert.equal((await observer.read()).player.name, '新局帝国')
 await writeFile(logPath, '')
 assert.equal(await observer.read(), null)
 await appendFile(logPath, frame({ name: '截断后新局' }))
 assert.equal((await observer.read()).player.name, '截断后新局')
})

test('同文件被截断后立即写得更大，也通过边界探针清除旧缓存', async t => {
 const logPath = await temporary(t), observer = await createModObserver({ logPath })
 await writeFile(logPath, frame({ name: '旧局' })); assert.equal((await observer.read()).player.name, '旧局')
 await writeFile(logPath, 'x'.repeat(2048) + '\n' + frame({ name: '原位重写新局' }))
 const result = await observer.read()
 assert.equal(result.player.name, '原位重写新局')
 assert.match(result.warnings.join(' '), /旧缓存已清除/)
})

test('日志消失清除本运行缓存；重新出现的文件重新识别', async t => {
 const logPath = await temporary(t), observer = await createModObserver({ logPath })
 await writeFile(logPath, frame()); assert.ok(await observer.read())
 await rm(logPath); assert.equal(await observer.read(), null)
 await writeFile(logPath, frame({ name: '重新出现' })); assert.equal((await observer.read()).player.name, '重新出现')
})

test('跨read发现多个人类帝国后不猜测；显式名字可稳定过滤', async t => {
 const logPath = await temporary(t), automatic = await createModObserver({ logPath }), explicit = await createModObserver({ logPath, playerName: '甲帝国' })
 await writeFile(logPath, frame({ name: '甲帝国' }))
 assert.equal((await automatic.read()).player.name, '甲帝国'); assert.equal((await explicit.read()).player.name, '甲帝国')
 await appendFile(logPath, frame({ name: '乙帝国' }))
 assert.equal(await automatic.read(), null); assert.equal((await explicit.read()).player.name, '甲帝国')
})

test('超大新增日志每次仅读有限字节，不越过未读数据直接取尾帧', async t => {
 const logPath = await temporary(t), maxBytes = 8192
 await writeFile(logPath, 'old'.repeat(100_000) + '\n' + frame({ name: '启动前旧局' }))
 const observer = await createModObserver({ logPath, maxBytes })
 assert.equal(await observer.read(), null)
 await appendFile(logPath, 'x'.repeat(maxBytes * 2) + '\n' + frame({ name: '有限读取新局' }))
 assert.equal(await observer.read(), null)
 assert.equal(await observer.read(), null)
 const result = await observer.read()
 assert.equal(result.player.name, '有限读取新局')
 assert.equal(result.player.resources.stockpiles.energy, 100.5)
})

test('并发read序列化，不重复消费或损坏帧；最新无效帧保留有效缓存并警告', async t => {
 const logPath = await temporary(t), observer = await createModObserver({ logPath })
 await writeFile(logPath, frame())
 const results = await Promise.all([observer.read(), observer.read(), observer.read()])
 for (const result of results) assert.equal(result.player.name, '大肥鱼帝国')
 await appendFile(logPath, frame({ stock: '[This.not_expanded]' }))
 const result = await observer.read()
 assert.equal(result.player.resources.stockpiles.energy, 100.5)
 assert.match(result.warnings.join(' '), /上一次完整帧/)
})
