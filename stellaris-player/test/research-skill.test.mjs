import test from 'node:test'
import assert from 'node:assert/strict'
import { createResearchSkill } from '../src/research-skill.mjs'

const idleArea = () => ({ area: 'physics', idle: true, state: 'idle', currentTechnology: null, researchButton: { text: '选择科技', box: { x: 50, y: 235, width: 411, height: 85 }, click: { x: 105, y: 190 } } })
const idleUi = () => ({ ok: true, areas: [idleArea()], choices: [], warnings: [] })
const candidateUi = () => ({
  ...idleUi(), selection: { area: 'physics' },
  choices: [
    { text: '量子理论', click: { x: 296, y: 170 }, box: { x: 520, y: 184, width: 470, height: 120 }, actualCost: null, knownEffects: ['物理学研究产出提升'] },
    { text: '蓝激光器', click: { x: 296, y: 253 }, box: { x: 520, y: 304, width: 470, height: 120 }, actualCost: { value: 3500, unit: '物理学研究' }, knownEffects: [] },
  ],
})
const researchingUi = (technology = '量子理论') => ({ ok: true, areas: [{ area: 'physics', idle: false, state: 'researching', currentTechnology: technology }], choices: [], warnings: [] })
const unknownUi = () => ({ ok: false, areas: [], choices: [], warnings: ['没有科技面板锚点'] })
const decision = candidates => ({ ok: true, elapsedMs: 7, usage: { total_tokens: 100 }, httpStatus: 200, choice: { technologyId: candidates[0].id, briefPublicExplanation: '先提高研究效率。' } })

/** Entirely fake UI/driver: importing and running these tests cannot enumerate
 * windows, take screenshots, press keys, load credentials or contact a model.
 */
function harness(frames, { planner: plan } = {}) {
  const calls = { observations: [], actions: [], ocr: [], plans: [], evidence: [], events: [], trace: [] }
  let frame = 0, latestObservation
  const driver = {
    async observe() {
      assert.ok(frame < frames.length, 'unexpected extra observation')
      const image = { id: `fake-observation-${frame}`, width: 2560, height: 1440, mimeType: 'image/png', imageBase64: 'FAKE_NOT_A_SCREENSHOT', frame }
      calls.observations.push(image.id); calls.trace.push('observe')
      latestObservation = image.id; frame++
      return image
    },
    async execute(action, options) {
      assert.equal(options.observationId, latestObservation, 'only a fresh observation can be consumed')
      latestObservation = undefined
      calls.actions.push({ ...action }); calls.trace.push('execute')
      return { ok: true, message: 'fake input receipt' }
    },
  }
  const skill = createResearchSkill({
    driver,
    apiKey: 'offline-placeholder',
    recognize: async (image, options) => {
      calls.ocr.push({ observationId: image.id, options })
      return { ok: true, labels: [{ text: 'offline frame marker', frame: image.frame }] }
    },
    parse: ({ labels }) => structuredClone(frames[labels[0].frame]),
    planner: async options => {
      calls.plans.push(options); calls.trace.push('planner')
      return plan ? plan(options) : decision(options.candidates)
    },
    onEvidence: async item => calls.evidence.push(item.stage),
    onEvent: item => calls.events.push(item),
    settle: async () => {},
  })
  return { skill, calls }
}

test('a complete research selection uses one model call and verifies the main area afterwards', async () => {
  const { skill, calls } = harness([idleUi(), candidateUi(), researchingUi()])
  const report = await skill.run({ area: 'physics', context: { goal: '改善研究效率' } })
  assert.equal(report.status, 'complete')
  assert.equal(report.verified, true)
  assert.equal(report.currentTechnology, '量子理论')
  assert.equal(report.modelRequests, 1)
  assert.equal(calls.plans.length, 1)
  assert.equal(report.actions, 2)
  assert.equal(report.observations, 3)
  assert.deepEqual(calls.actions.map(action => action.type), ['click', 'click'])
  assert.deepEqual(calls.evidence, ['initial', 'candidates', 'verified'])
  assert.equal(calls.events.filter(event => event.type === 'completed').length, 1)
  assert.equal(skill.info().running, false)
})

test('an already researching main area completes without model requests or clicks', async () => {
  const { skill, calls } = harness([researchingUi('蓝激光器')])
  const report = await skill.run({ area: 'physics' })
  assert.equal(report.status, 'already_researching')
  assert.equal(report.verified, true)
  assert.equal(report.currentTechnology, '蓝激光器')
  assert.equal(report.modelRequests, 0)
  assert.deepEqual(calls.plans, [])
  assert.deepEqual(calls.actions, [])
})

test('unknown UI permits at most the source-confirmed F4 key and never a guessed click or model request', async () => {
  const { skill, calls } = harness([unknownUi(), unknownUi(), unknownUi()])
  const report = await skill.run({ area: 'physics' })
  assert.equal(report.status, 'error')
  assert.equal(report.verified, false)
  assert.equal(report.modelRequests, 0)
  assert.deepEqual(calls.plans, [])
  assert.deepEqual(calls.actions, [{ type: 'key', key: 'F4' }])
  assert.equal(calls.actions.some(action => action.type === 'click'), false)
  assert.equal(calls.events.some(event => event.type === 'completed'), false)
})

test('a model ID outside the live candidates never produces a selection click', async () => {
  const { skill, calls } = harness([candidateUi()], { planner: async () => ({ ok: true, elapsedMs: 1, choice: { technologyId: 'invented-id', briefPublicExplanation: '未知科技。' } }) })
  const report = await skill.run({ area: 'physics' })
  assert.equal(report.status, 'error')
  assert.equal(report.verified, false)
  assert.equal(report.modelRequests, 1)
  assert.equal(calls.plans.length, 1)
  assert.deepEqual(calls.actions, [])
  assert.equal(report.choice, null)
})

test('a successful input receipt without matching main-area research never claims completion', async () => {
  // Candidate-side text still says 量子理论, but the main area remains idle.
  const { skill, calls } = harness([candidateUi(), candidateUi()])
  const report = await skill.run({ area: 'physics' })
  assert.equal(report.status, 'error')
  assert.equal(report.verified, false)
  assert.equal(report.modelRequests, 1)
  assert.equal(calls.actions.length, 1)
  assert.equal(calls.events.some(event => event.type === 'completed'), false)
  assert.equal(report.currentTechnology, undefined)
})

test('a different main-area name is reported as started but never as a verified choice', async () => {
  const { skill, calls } = harness([candidateUi(), researchingUi('蓝激光器')])
  const report = await skill.run({ area: 'physics' })
  assert.equal(report.status, 'started_unconfirmed')
  assert.equal(report.verified, false)
  assert.equal(calls.actions.length, 1)
  assert.equal(calls.events.some(event => event.type === 'completed'), false)
})

test('stop during the model wait discards a late valid decision without clicking', async () => {
  let resolveDecision, modelStarted
  const ready = new Promise(resolve => { modelStarted = resolve })
  const { skill, calls } = harness([candidateUi()], { planner: options => {
    modelStarted()
    return new Promise(resolve => { resolveDecision = () => resolve(decision(options.candidates)) })
  } })
  const running = skill.run({ area: 'physics' })
  await ready
  skill.stop()
  resolveDecision()
  const report = await running
  assert.equal(report.status, 'stopped')
  assert.equal(report.verified, false)
  assert.equal(report.modelRequests, 1)
  assert.equal(report.choice, null)
  assert.deepEqual(calls.actions, [])
  assert.equal(calls.events.some(event => event.type === 'decision' || event.type === 'completed'), false)
  assert.deepEqual(skill.info(), { running: false, stopped: true })
})

test('planner receives candidate labels and known facts without UI boxes or coordinates', async () => {
  const { skill, calls } = harness([candidateUi(), researchingUi()])
  const report = await skill.run({ area: 'physics' })
  assert.equal(report.status, 'complete')
  const candidates = calls.plans[0].candidates
  assert.deepEqual(candidates.map(candidate => candidate.label), ['量子理论', '蓝激光器'])
  assert.equal(candidates[0].actualCost, null)
  assert.deepEqual(candidates[0].knownEffects, ['物理学研究产出提升'])
  assert.equal(candidates[1].actualCost.value, 3500)
  for (const candidate of candidates) {
    assert.deepEqual(Object.keys(candidate).sort(), ['actualCost', 'id', 'knownEffects', 'label'])
    assert.equal('click' in candidate, false)
    assert.equal('box' in candidate, false)
  }
  assert.equal(calls.plans[0].context.slot, '物理学')
})
