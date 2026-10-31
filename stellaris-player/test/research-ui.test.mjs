import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseResearchUi } from '../src/research-ui.mjs'

const names = ['物理学', '社会学', '工程学']
function frame({ scale = 1, x = 30, y = 35, width = 1920, height = 1080, selection = true, offset = 0 } = {}) {
  const labels = []
  const add = (text, left, top, w = 100, h = 16) => labels.push({ text, x: (x + left * scale) / width * 1000, y: (y + top * scale) / height * 1000, width: w * scale / width * 1000, height: h * scale / height * 1000 })
  add('科技', 35, 10, 48, 24)
  names.forEach((name, row) => {
    add(name, 36, 169 + row * 160, 48)
    add('选择科技', 190, 231 + row * 160, 64)
  })
  if (selection) {
    add('物理学研究', 508, 19, 120, 24)
    add('选择研究一项科技', 533, 58, 200)
    for (const [row, name] of ['量子理论', '蓝激光器', '物理实验室'].entries()) {
      add(name, 511, 164 + row * 120 + offset, 120)
      add('3500', 846, 164 + row * 120 + offset, 65)
      add('建筑：研究实验室', 569, 194 + row * 120 + offset, 200)
    }
  }
  return { labels, width, height }
}

test('live headings and button text locate fields and complete research cards', () => {
  const result = parseResearchUi(frame())
  assert.equal(result.ok, true)
  assert.deepEqual(result.areas.map(area => area.area), ['physics', 'society', 'engineering'])
  assert.equal(result.areas.filter(area => area.select).length, 3)
  assert.deepEqual(result.choices.map(choice => choice.text), ['量子理论', '蓝激光器', '物理实验室'])
  assert.deepEqual(result.choices[0].box, { x: 521, y: 184, width: 470, height: 120 })
  assert.deepEqual(result.choices[0].click, { x: 393.75, y: 225.93 })
  assert.equal(result.choices[0].details.includes('3500'), true)
  assert.equal(result.choices[0].actualCost, null)
  assert.deepEqual(result.choices[0].knownEffects, ['建筑：研究实验室'])
  assert.equal(result.areas[0].idle, true)
  assert.deepEqual(result.areas[0].researchButton, result.areas[0].select)
  assert.equal(result.selection.area, 'physics')
})

test('calibration follows screenshot translation and UI scaling instead of resolution', () => {
  const result = parseResearchUi(frame({ scale: 1.5, x: 57, y: 70, width: 2560, height: 1600 }))
  assert.equal(result.ok, true)
  assert.equal(result.panel.scale, 1.5)
  assert.deepEqual(result.choices[0].box, { x: 793.5, y: 293.5, width: 705, height: 180 })
  assert.deepEqual(result.choices[0].click, { x: 447.66, y: 239.69 })
})

test('missing a middle field is recovered only through spacing and the main header', () => {
  const input = frame()
  input.labels = input.labels.filter(label => label.text !== '社会学')
  const result = parseResearchUi(input)
  assert.equal(result.ok, true)
  assert.equal(result.panel.scale, 1)
  assert.deepEqual(result.areas.map(area => area.row), [0, 2])
})

test('a menu label, tooltip prose, or candidate text alone never authorizes a click', () => {
  const input = frame()
  input.labels = input.labels.filter(label => !names.includes(label.text))
  const result = parseResearchUi(input)
  assert.equal(result.ok, false)
  assert.deepEqual(result.choices, [])
  assert.deepEqual(result.areas, [])
  assert.equal(parseResearchUi({ ...input, labels: input.labels.map(label => ({ ...label, text: `提示：${label.text}` })) }).ok, false)
})

test('field buttons require their own live text and candidate cards require the side header', () => {
  const input = frame()
  input.labels = input.labels.filter(label => label.text !== '选择科技' && label.text !== '物理学研究')
  const result = parseResearchUi(input)
  assert.equal(result.ok, true)
  assert.equal(result.areas.some(area => area.select), false)
  assert.deepEqual(result.choices, [])
})

test('unlock prose and costs cannot be promoted to candidate names', () => {
  const input = frame()
  input.labels = input.labels.filter(label => !['量子理论', '蓝激光器', '物理实验室'].includes(label.text))
  const result = parseResearchUi(input)
  assert.equal(result.ok, true)
  assert.deepEqual(result.choices, [])
})

test('partly scrolled cards and clipped cards are not given guessed clicks', () => {
  assert.equal(parseResearchUi(frame({ offset: -30 })).choices.length, 0)
  const input = frame({ width: 960 })
  const result = parseResearchUi(input)
  assert.equal(result.ok, true)
  assert.equal(result.choices.length, 0)
})

test('duplicated OCR labels are deduplicated but conflicting titles are skipped', () => {
  const input = frame()
  input.labels.push({ ...input.labels.find(label => label.text === '量子理论') })
  assert.equal(parseResearchUi(input).choices.length, 3)
  input.labels.push({ ...input.labels.find(label => label.text === '量子理论'), text: '另一项理论' })
  assert.deepEqual(parseResearchUi(input).choices.map(choice => choice.row), [1, 2])
})

test('English UI and spaces introduced between Chinese characters are supported', () => {
  const input = frame()
  const translations = { 科技: 'Technology', 物理学: 'Physics', 社会学: 'Society', 工程学: 'Engineering', 选择科技: 'Select Research', 物理学研究: 'Physics Research', 选择研究一项科技: 'Select a technology to research' }
  input.labels = input.labels.map(label => ({ ...label, text: translations[label.text] || label.text }))
  assert.equal(parseResearchUi(input).choices.length, 3)
  input.labels = frame().labels.map(label => ({ ...label, text: [...label.text].join(' ') }))
  assert.equal(parseResearchUi(input).choices.length, 3)
})

test('invalid dimensions, non-finite labels and inconsistent panel geometry fail closed', () => {
  assert.equal(parseResearchUi().ok, false)
  assert.equal(parseResearchUi({ labels: [], width: 0, height: 1080 }).ok, false)
  const input = frame()
  input.labels = input.labels.map(label => names.includes(label.text) ? { ...label, y: label.y + 100 } : label)
  assert.equal(parseResearchUi(input).ok, false)
  assert.equal(parseResearchUi({ ...frame(), labels: [{ text: '科技', x: NaN, y: 0, width: 3, height: 3 }] }).ok, false)
})

test('right-side tutorial labels cannot calibrate a main technology panel', () => {
  assert.equal(parseResearchUi(frame({ x: 2300, width: 3840, height: 1440 })).ok, false)
  const input = frame()
  input.labels = input.labels.filter(label => !names.includes(label.text))
  input.labels.push(...frame({ x: 2300, width: 3840, height: 1440 }).labels.map(label => ({ ...label, x: label.x * 3840 / 1920, y: label.y * 1440 / 1080 })))
  assert.equal(parseResearchUi(input).ok, false)
})

test('current research is verified only by the main area title band', () => {
  const input = frame()
  input.labels = input.labels.filter(label => label.text !== '选择科技')
  let result = parseResearchUi(input)
  assert.equal(result.areas[0].currentTechnology, null)
  assert.equal(result.areas[0].state, 'unknown')
  input.labels.push({ text: '量子理论', x: 46 / 1920 * 1000, y: 232 / 1080 * 1000, width: 96 / 1920 * 1000, height: 16 / 1080 * 1000 })
  result = parseResearchUi(input)
  assert.equal(result.areas[0].idle, false)
  assert.equal(result.areas[0].currentTechnology, '量子理论')
  assert.equal(result.areas[0].state, 'researching')
  assert.equal(result.areas[1].currentTechnology, null)
})

test('a cost is reported only when the same OCR label states its unit', () => {
  const input = frame()
  input.labels = input.labels.map(label => label.text === '3500' ? { ...label, text: '3,500 物理学研究' } : label)
  assert.deepEqual(parseResearchUi(input).choices[0].actualCost, { value: 3500, unit: '物理学研究', text: '3,500 物理学研究' })
})

test('actual historical F4 ROI labels calibrate without inventing the missed society heading', () => {
  // Image 03-F4.png, 2560x1440; local OCR of its existing top-left 800x800
  // pixels at 2x. No screenshot, OCR runtime or desktop access is used here.
  const labels = [
    { text: '科技', x: 25.59, y: 33.33, width: 15.23, height: 13.89 },
    { text: '物理学', x: 25.78, y: 141.32, width: 16.41, height: 11.11 },
    { text: '工程学', x: 25.78, y: 363.89, width: 16.41, height: 10.76 },
    { text: '选择科技', x: 94.73, y: 184.72, width: 21.48, height: 10.76 },
    { text: '选择科技', x: 94.73, y: 295.83, width: 21.48, height: 10.76 },
    { text: '选择科技', x: 94.73, y: 406.94, width: 21.48, height: 10.76 },
  ]
  const result = parseResearchUi({ labels, width: 2560, height: 1440 })
  assert.equal(result.ok, true)
  assert.equal(result.panel.scale, 1)
  assert.deepEqual(result.areas.map(area => area.area), ['physics', 'engineering'])
  assert.deepEqual(result.areas[0].researchButton.click, { x: 105.47, y: 190.1 })
  assert.deepEqual(result.choices, [])
})
