import type { AppConfig, StageState } from '../../packages/shared/src/index'

import { getAudioBus } from './music-audio'

export interface SpeechCallbacks {
  progress(characters: number): void
  amplitude(value: number): void
  ended(): void
  status(message: string): void
  error(message: string): void
}

/** Settle a cancelled playback immediately even while native routing/play() is still pending. */
function whilePlaying<T>(pending: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise((resolve, reject) => {
    const cancelled = () => { signal.removeEventListener('abort', cancelled); reject(new DOMException('配音播放已取消。', 'AbortError')) }
    signal.addEventListener('abort', cancelled, { once: true })
    pending.then(value => { signal.removeEventListener('abort', cancelled); if (signal.aborted) cancelled(); else resolve(value) }, error => { signal.removeEventListener('abort', cancelled); reject(error) })
    if (signal.aborted) cancelled()
  })
}

/** One player belongs to the capture window. Console previews never produce sound. */
export class StageAudio {
  private generation = 0
  private readonly bus = getAudioBus()
  private mediaSource?: MediaElementAudioSourceNode
  private callbacks?: SpeechCallbacks
  private playbackAbort?: AbortController
  async configure(config: AppConfig['audio']) {
    await this.bus.configure(config)
    if (this.utterance && (config.mode === 'live' || !config.monitorEnabled)) { const ended = this.callbacks?.ended; this.stop(); ended?.() }
  }
  dispose() { this.stop(); this.bus.dispose() }
  private element?: HTMLAudioElement
  private source?: AudioBufferSourceNode
  private analyser?: AnalyserNode
  private frame = 0
  private timer = 0
  private utterance?: SpeechSynthesisUtterance
  private boundarySeen = false
  private finishing = false

  stop() {
    this.generation++
    this.playbackAbort?.abort(); this.playbackAbort = undefined
    this.releaseUtterance(true)
    cancelAnimationFrame(this.frame)
    this.frame = 0; window.clearTimeout(this.timer); this.timer = 0
    this.releaseConnections()
    this.callbacks = undefined
    this.bus.setSpeaking(false)
  }

  private releaseUtterance(cancel = false) {
    if (this.utterance) {
      this.utterance.onboundary = null; this.utterance.onstart = null; this.utterance.onend = null; this.utterance.onerror = null
      if (cancel) window.speechSynthesis?.cancel()
    }
    this.utterance = undefined
  }

  private releaseConnections() {
    window.clearTimeout(this.timer); this.timer = 0
    if (this.source) { this.source.onended = null; try { this.source.stop() } catch { /* Already ended. */ }; this.source.disconnect(); try { this.source.buffer = null } catch { /* A released native source may already be immutable. */ } }
    this.analyser?.disconnect(); this.analyser = undefined; this.source = undefined
    if (this.mediaSource) this.bus.disconnect(this.mediaSource)
    this.mediaSource = undefined
    // Remote URLs are service-owned, not local cache files. Drop the source and
    // load() to release the browser's decoder/network buffer; no file is deleted.
    if (this.element) { this.element.onended = null; this.element.onerror = null; this.element.onplaying = null; this.element.pause(); this.element.removeAttribute('src'); this.element.load() }; this.element = undefined
  }

  async play(stage: StageState, callbacks: SpeechCallbacks) {
    this.stop()
    const controller = this.playbackAbort = new AbortController()
    this.callbacks = callbacks
    this.bus.reportWith(callbacks.status)
    this.bus.setMuted(stage.muted)
    this.bus.setSpeaking(stage.speaking && !stage.muted)
    const generation = this.generation
    const current = () => generation === this.generation
    const done = () => { if (!current() || this.finishing) return; this.finishing = true; this.generation++; controller.abort(); this.bus.setSpeaking(false); cancelAnimationFrame(this.frame); this.frame = 0; this.releaseConnections(); this.releaseUtterance(); this.callbacks = undefined; this.playbackAbort = undefined; callbacks.amplitude(0); callbacks.progress(stage.text.length); callbacks.ended() }
    this.finishing = false
    this.boundarySeen = false
    const source = stage.audio
    if (stage.muted || !stage.speaking) { this.callbacks = undefined; this.playbackAbort = undefined; return }
    const text = stage.text
    const rate = Math.max(.5, Math.min(2, source?.rate ?? 1))
    const estimatedSeconds = Math.max(1.5, Array.from(text).length / (4.6 * rate))
    const timedText = (started: number, duration: number, volume?: () => number) => {
      const tick = () => {
        if (!current() || this.finishing) return
        const elapsed = (performance.now() - started) / 1000
        if (source?.words?.length) {
          let characters = 0
          let searchedTo = 0
          for (const word of source.words) {
            if (elapsed < word.start) break
            const position = text.indexOf(word.text, searchedTo)
            const start = position >= 0 ? position : searchedTo
            const fraction = word.end > word.start ? Math.min(1, (elapsed - word.start) / (word.end - word.start)) : 1
            characters = start + Math.ceil(word.text.length * fraction)
            searchedTo = start + word.text.length
          }
          callbacks.progress(Math.min(text.length, characters))
        } else if (!this.boundarySeen) callbacks.progress(Math.min(text.length, Math.floor(text.length * elapsed / duration)))
        callbacks.amplitude(volume ? volume() : .28 + .55 * Math.abs(Math.sin(elapsed * 14.7)))
        this.frame = requestAnimationFrame(tick)
      }
      tick()
    }
    try {
      if (source?.kind === 'pcm' && source.data) {
        const bytes = Uint8Array.from(atob(source.data), c => c.charCodeAt(0))
        if (bytes.byteLength < 2) throw new Error('配音没有返回音频数据')
        const samples = new DataView(bytes.buffer)
        const context = await whilePlaying(this.bus.ready(), controller.signal)
        if (!current()) return
        const buffer = context.createBuffer(1, Math.floor(bytes.byteLength / 2), source.sampleRate ?? 24000)
        const channel = buffer.getChannelData(0)
        for (let i = 0; i < channel.length; i++) channel[i] = samples.getInt16(i * 2, true) / 32768
        const player = this.source = context.createBufferSource()
        player.buffer = buffer
        const analyser = this.analyser = context.createAnalyser()
        analyser.fftSize = 256
        player.connect(analyser); this.bus.connect(analyser, 'speech')
        const values = new Float32Array(analyser.fftSize)
        const rms = () => { analyser.getFloatTimeDomainData(values); return Math.min(1, Math.sqrt(values.reduce((sum, n) => sum + n * n, 0) / values.length) * 5) }
        player.onended = done
        player.start()
        callbacks.status('千问配音正在播放')
        timedText(performance.now(), buffer.duration, rms)
        return
      }
      if (source?.kind === 'url' && source.url) {
        const player = this.element = new Audio(source.url)
        player.crossOrigin = 'anonymous'
        const context = this.bus.audioContext
        this.mediaSource = context.createMediaElementSource(player)
        this.bus.connect(this.mediaSource, 'speech')
        await whilePlaying(this.bus.ready(), controller.signal)
        if (!current()) return
        player.onended = done
        player.onerror = () => { if (current()) { callbacks.error('音频播放失败，请检查配音服务和输出设备'); done() } }
        await whilePlaying(player.play(), controller.signal)
        if (!current()) return
        callbacks.status('千问配音正在播放')
        timedText(performance.now(), Number.isFinite(player.duration) ? player.duration : estimatedSeconds)
        return
      }
      const output = this.bus.settings
      if (source?.kind === 'system' && output.mode === 'live') callbacks.status('直播隔离模式不会使用系统朗读，请切换千问配音；本句保留文字。')
      if (source?.kind === 'system' && output.mode === 'test' && output.monitorEnabled) {
        if (!('speechSynthesis' in window)) throw new Error('当前环境不支持系统朗读')
        if (output.monitorDeviceId && output.monitorDeviceId !== 'default') throw new Error('系统朗读无法指定监听设备；请切换千问配音，或选择默认监听设备。')
        const utterance = this.utterance = new SpeechSynthesisUtterance(text)
        utterance.lang = 'zh-CN'
        utterance.rate = rate
        utterance.volume = Math.min(1, output.speechGain * output.monitorGain * output.streamGain)
        const voices = window.speechSynthesis.getVoices()
        utterance.voice = voices.find(v => /zh[-_]CN/i.test(v.lang)) ?? voices.find(v => /^zh/i.test(v.lang)) ?? null
        utterance.onboundary = event => { if (current()) { this.boundarySeen = true; callbacks.progress(Math.min(text.length, event.charIndex + Math.max(1, event.charLength || 1))) } }
        utterance.onstart = () => { if (current()) { callbacks.status('系统朗读正在播放'); timedText(performance.now(), estimatedSeconds) } }
        utterance.onend = done
        utterance.onerror = event => { if (current() && event.error !== 'interrupted' && event.error !== 'canceled') { callbacks.error('系统朗读暂不可用，已保留文字字幕'); done() } }
        window.speechSynthesis.speak(utterance)
        this.timer = window.setTimeout(done, (estimatedSeconds * 2 + 15) * 1000)
        return
      }
      callbacks.status('文字表演模式')
      timedText(performance.now(), estimatedSeconds)
      this.timer = window.setTimeout(done, estimatedSeconds * 1000)
    } catch (error) {
      if (!current()) return
      callbacks.error(error instanceof Error ? error.message : '配音播放失败')
      callbacks.status('配音不可用，继续文字表演')
      timedText(performance.now(), estimatedSeconds)
      this.timer = window.setTimeout(done, estimatedSeconds * 1000)
    }
  }

}
