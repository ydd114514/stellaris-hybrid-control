// Read-only OCR geometry for vanilla Stellaris 4.5.2 technology_view.gui.
// Input labels use src/ocr.mjs's 0..1000 coordinate system. Returned boxes are
// image pixels; click points use the driver's 0..1000 coordinate system.
// This module never captures a screen, sends input, or calls a model.
const AREAS = [
  { id: 'physics', pattern: /^(?:物理学|Physics)$/iu, selection: /^(?:物理学(?:研究|科研)|PhysicsResearch)$/iu },
  { id: 'society', pattern: /^(?:社会学|Society)$/iu, selection: /^(?:社会学(?:研究|科研)|SocietyResearch)$/iu },
  { id: 'engineering', pattern: /^(?:工程学|Engineering)$/iu, selection: /^(?:工程学(?:研究|科研)|EngineeringResearch)$/iu },
]
const compact = value => value.replace(/[\s\u200b-\u200f\ufeff]/gu, '')
const round = value => Math.round(value * 100) / 100
const median = values => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)]
const finite = value => typeof value === 'number' && Number.isFinite(value)
const headerText = text => /^(?:科技|Technology)$/iu.test(text)
const chooseText = text => /^(?:选择科技|选择研究|SelectResearch)$/iu.test(text)
const descriptorText = text => /选择研究一项科技|Selectatechnologytoresearch/iu.test(text)
const reservedText = text => headerText(text) || chooseText(text) || descriptorText(text) || AREAS.some(area => area.pattern.test(text) || area.selection.test(text))
const titleText = text => /[\p{L}\p{Script=Han}]/u.test(text) && !reservedText(text) && !/^(?:无科技|NoTechnology)$/iu.test(text)

function statedCost(labels) {
  for (const label of labels) {
    const match = compact(label.text).match(/^(?:(?:花费|成本|Cost)[:：]?)?(\d[\d,]*(?:\.\d+)?)(物理学研究|社会学研究|工程学研究|研究点|科研点|PhysicsResearch|SocietyResearch|EngineeringResearch|ResearchPoints?)$/iu)
    if (!match) continue
    const value = Number(match[1].replaceAll(',', ''))
    if (Number.isFinite(value)) return { value, unit: match[2], text: label.text }
  }
  return null
}

function toPixels(labels, width, height) {
  const result = [], seen = new Set()
  for (const label of labels.slice(0, 1000)) {
    if (!label || typeof label.text !== 'string' || !label.text.trim() || label.text.length > 300 || ![label.x, label.y, label.width, label.height].every(finite)) continue
    if (label.x < 0 || label.y < 0 || label.width <= 0 || label.height <= 0 || label.x + label.width > 1000.05 || label.y + label.height > 1000.05) continue
    const text = label.text.trim(), key = `${text}:${label.x}:${label.y}:${label.width}:${label.height}`
    if (seen.has(key)) continue
    seen.add(key)
    result.push({ text, compact: compact(text), x: label.x * width / 1000, y: label.y * height / 1000, width: label.width * width / 1000, height: label.height * height / 1000 })
  }
  return result
}

function box(x, y, width, height) { return { x: round(x), y: round(y), width: round(width), height: round(height) } }
const center = label => ({ x: label.x + label.width / 2, y: label.y + label.height / 2 })
const contains = (rectangle, point) => point.x >= rectangle.x && point.y >= rectangle.y && point.x < rectangle.x + rectangle.width && point.y < rectangle.y + rectangle.height
const fitsImage = (rectangle, width, height) => rectangle.x >= 0 && rectangle.y >= 0 && rectangle.x + rectangle.width <= width && rectangle.y + rectangle.height <= height
const normalizedPoint = (point, width, height) => ({ x: round(point.x * 1000 / width), y: round(point.y * 1000 / height) })

// Area headings share x=36, y=169+160*row relative to the panel. The main
// heading is x=35,y=10. Infer scale and translation from live text, never from
// resolution alone. Missing one heading is allowed only if the remaining two
// also agree with the main heading; field order is not assumed.
function calibrations(labels, width, height) {
  const found = []
  for (const header of labels.filter(label => headerText(label.compact) && label.x < Math.min(width * 0.25, 400) && label.y < height * 0.25)) {
    const fields = labels.flatMap(label => {
      const area = AREAS.find(area => area.pattern.test(label.compact.replace(/^[^\p{L}\p{Script=Han}]+/u,'')))
      // OCR sometimes joins the left resource icon (e.g. "0 工程学")
      // to a heading. Keep only the exact heading's proportion of that box;
      // the shared panel geometry must still independently agree.
      const prefix=label.compact.match(/^[^\p{L}\p{Script=Han}]+/u)?.[0]||''
      const chineseHeading=/^(物理学|社会学|工程学)$/.test(label.compact.slice(prefix.length))
      const offset=chineseHeading&&prefix?Math.max(0,label.width-label.height*3*0.88):prefix.length*label.width/label.compact.length
      const field=prefix?{...label,x:label.x+offset,width:label.width-offset}:label
      return area && label.y > header.y + 35 && Math.abs(field.x - header.x) < 64 ? [{ ...field, area: area.id }] : []
    }).sort((a, b) => a.y - b.y).slice(0, 24)
    for (let a = 0; a < fields.length; a++) for (let b = a + 1; b < fields.length; b++) {
      if (fields[a].area === fields[b].area) continue
      for (const separation of [1, 2]) {
        const scale = (fields[b].y - fields[a].y) / (160 * separation)
        if (scale < 0.5 || scale > 3 || Math.abs(fields[a].x - fields[b].x) > 12 * scale) continue
        for (let firstRow = 0; firstRow + separation < 3; firstRow++) {
          const x = median([header.x - 35 * scale, fields[a].x - 36 * scale, fields[b].x - 36 * scale])
          const y = (fields[a].y - (169 + 160 * firstRow) * scale + fields[b].y - (169 + 160 * (firstRow + separation)) * scale) / 2
          const headerError = Math.abs(header.x - x - 35 * scale) + Math.abs(header.y - y - 10 * scale)
          // The vanilla technology panel is fixed to the upper left. In
          // particular, tutorial prose on the right is never a substitute.
          if (headerError > 18 * scale || x < 0 || y < 0 || x > Math.max(48, Math.min(width * 0.12, 160)) || y > Math.max(96, height * 0.14) || x + 480 * scale > width || y + 640 * scale > height) continue
          const matches = fields.flatMap(field => {
            const row = Math.round(((field.y - y) / scale - 169) / 160)
            return row >= 0 && row < 3 && Math.abs(field.x - x - 36 * scale) < 12 * scale && Math.abs(field.y - y - (169 + row * 160) * scale) < 10 * scale ? [{ ...field, row }] : []
          })
          if (new Set(matches.map(field => field.area)).size !== matches.length || new Set(matches.map(field => field.row)).size !== matches.length) continue
          found.push({ x, y, scale, header, fields: matches, score: matches.length * 100 - headerError / scale })
        }
      }
    }
  }
  return found.sort((a, b) => b.score - a.score)
}

/** Parse a live OCR frame into conservative research click targets.
 * `visibleIndex` describes only returned screen cards, never a save-file order.
 * Geometry does not prove affordability/enabled state or game acceptance;
 * callers still observe after selecting and check the selected research name.
 */
export function parseResearchUi({ labels, width, height } = {}) {
  const result = { ok: false, coordinateSystem: 'pixels', clickCoordinateSystem: 'normalized-1000', areas: [], choices: [], warnings: [] }
  if (!Array.isArray(labels) || !Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width < 320 || height < 240 || width > 8192 || height > 8192 || width * height > 16777216) {
    result.warnings.push('需要有效图片尺寸和归一化 OCR 标签。')
    return result
  }
  const text = toPixels(labels, width, height), candidates = calibrations(text, width, height)
  if (!candidates.length) {
    result.warnings.push('未同时确认科技标题和至少两个学科位置，不提供点击目标。')
    return result
  }
  const best = candidates[0]
  if (candidates.some(candidate => candidate.score >= best.score - 1 && (Math.abs(candidate.x - best.x) > 20 * best.scale || Math.abs(candidate.y - best.y) > 20 * best.scale || Math.abs(candidate.scale - best.scale) > 0.05 * best.scale))) {
    result.warnings.push('科技面板锚点存在歧义，不提供点击目标。')
    return result
  }
  const { x, y, scale } = best
  result.ok = true
  result.panel = { box: box(x, y, 480 * scale, 640 * scale), scale: round(scale), heading: best.header.text }
  for (const field of [...best.fields].sort((a, b) => a.row - b.row)) {
    const target = { area: field.area, text: field.text, row: field.row, idle: false, state: 'unknown', currentTechnology: null, labelBox: box(field.x, field.y, field.width, field.height) }
    const button = box(x + 20 * scale, y + (200 + 160 * field.row) * scale, 411 * scale, 85 * scale)
    const anchors = text.filter(label => chooseText(label.compact) && contains(button, center(label)))
    if (anchors.length === 1 && fitsImage(button, width, height)) {
      target.idle = true; target.state = 'idle'
      target.researchButton = target.select = { text: anchors[0].text, box: button, click: normalizedPoint(center(anchors[0]), width, height) }
    }
    else if (anchors.length > 1) result.warnings.push(`${field.text}的选择按钮文字有多个位置，已跳过。`)
    const current = text.filter(label => label.x >= x + 8 * scale && label.x <= x + 45 * scale && Math.abs(label.y - y - (197 + 160 * field.row) * scale) <= 10 * scale && label.height <= 30 * scale && label.x + label.width < x + 335 * scale && titleText(label.compact))
    if (!target.idle && current.length === 1) { target.currentTechnology = current[0].text; target.state = 'researching' }
    const progress=text.find(label=>/^\d+(?:\.\d+)?\/\d+(?:\.\d+)?$/.test(label.compact)&&label.x>x+330*scale&&label.x<x+465*scale&&Math.abs(label.y-y-(197+160*field.row)*scale)<18*scale)
    const remaining=text.find(label=>/剩余\d+个?月|\d+MonthsRemaining/i.test(label.compact)&&label.x>x+200*scale&&label.x<x+440*scale&&Math.abs(label.y-y-(288+160*field.row)*scale)<18*scale)
    if(!target.idle&&progress&&remaining){
      target.state='researching';target.progressText=progress.text;target.remainingText=remaining.text
    }
    result.areas.push(target)
  }

  const selectionHeading = text.filter(label => AREAS.some(area => area.selection.test(label.compact)) && Math.abs(label.x - x - 508 * scale) < 22 * scale && Math.abs(label.y - y - 19 * scale) < 18 * scale)
  if (selectionHeading.length !== 1) {
    result.warnings.push('未确认唯一学科研究候选侧栏，不提供候选卡片。')
    return result
  }
  const heading = selectionHeading[0], area = AREAS.find(area => area.selection.test(heading.compact)).id
  const list = box(x + 491 * scale, y + 149 * scale, 472 * scale, 490 * scale)
  result.selection = { area, text: heading.text, box: list }
  if (!text.some(label => descriptorText(label.compact) && label.x >= x + 489 * scale && label.x < x + 980 * scale && label.y > heading.y && label.y < y + 140 * scale)) result.warnings.push('候选侧栏说明文字未识别，已额外要求卡片标题符合列表结构。')
  // Only full cards at the vanilla list's top-aligned 120px rhythm are exposed.
  // A partly scrolled card must not acquire a guessed index or a blind click.
  for (let row = 0; row < 4; row++) {
    const top = list.y + row * 120 * scale
    const rectangle = box(list.x, top, 470 * scale, 120 * scale)
    if (!fitsImage(rectangle, width, height) || rectangle.y + rectangle.height > list.y + list.height) continue
    const titles = text.filter(label => label.x >= list.x + 8 * scale && label.x <= list.x + 54 * scale && Math.abs(label.y - top - 15 * scale) <= 10 * scale && label.height <= 30 * scale && titleText(label.compact))
    if (titles.length !== 1) continue
    const title = titles[0]
    const detailLabels = text.filter(label => label !== title && contains(rectangle, center(label))).sort((a, b) => a.y - b.y || a.x - b.x)
    const actualCost = statedCost(detailLabels)
    const details = detailLabels.map(label => label.text)
    const knownEffects = detailLabels.filter(label => /[\p{L}\p{Script=Han}]/u.test(label.compact) && label.text !== actualCost?.text && !reservedText(label.compact)).map(label => label.text)
    result.choices.push({ visibleIndex: result.choices.length, row, text: title.text, area, details, knownEffects, actualCost, box: rectangle, click: normalizedPoint({ x: rectangle.x + rectangle.width / 2, y: rectangle.y + rectangle.height / 2 }, width, height) })
  }
  if (!result.choices.length) result.warnings.push('没有完整且标题位置可核验的科技卡片；可能尚未打开、已滚动或 OCR 缺失。')
  return result
}
