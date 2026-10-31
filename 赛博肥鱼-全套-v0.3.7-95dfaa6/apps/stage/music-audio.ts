import type { AppConfig, MusicState } from '../../packages/shared/src/index'

type AudioConfig = AppConfig['audio']
const fallback: AudioConfig = { mode: 'test', streamDeviceId: '', monitorEnabled: false, monitorDeviceId: '', streamGain: 1, monitorGain: .7, speechGain: 1, musicGain: .18, ducking: .2 }
const clamp = (n: number, fallback: number, maximum = 2) => Number.isFinite(n) ? Math.max(0, Math.min(maximum, n)) : fallback

/** Persistent app-only mixer. Nothing here changes the macOS default input or output. */
export class LiveAudioBus {
  private context?: AudioContext
  private speech?: GainNode
  private music?: GainNode
  private mix?: DynamicsCompressorNode
  private stream?: GainNode
  private monitorGain?: GainNode
  private monitorDestination?: MediaStreamAudioDestinationNode
  private monitor?: HTMLAudioElement
  private streamConnected = false
  private connectedSink = ''
  private monitorSink = ''
  private revision = 0
  private config: AudioConfig = { ...fallback }
  private speaking = false
  private musicTarget?: number
  private muted = false
  private reporter?: (message: string) => void
  private configuration = Promise.resolve()
  private routeError = ''
  private signature = ''
  private listening = false
  private readonly deviceChanged = () => { void this.validateOutput() }
  private readonly sinkChanged = () => {
    const context = this.context as (AudioContext & { sinkId?: string | { type: string } }) | undefined
    // Chromium may fall back after a physical device disappears. Never let that
    // implicit route become a broadcast of the shop through the owner's speakers.
    if (this.config.mode === 'live' && this.streamConnected && context && typeof context.sinkId === 'string' && context.sinkId !== this.config.streamDeviceId) this.disconnectStream('直播声卡路由已改变，已停止送音；请重新选择专用声卡。')
  }
  constructor() { this.listen() }
  private listen() { if (!this.listening && typeof navigator !== 'undefined' && navigator.mediaDevices) { navigator.mediaDevices.addEventListener('devicechange', this.deviceChanged); this.listening = true } }
  private async validateOutput() {
    if (this.config.mode !== 'live' || !this.streamConnected || typeof navigator === 'undefined' || !navigator.mediaDevices) return
    try {
      const devices = await navigator.mediaDevices.enumerateDevices()
      if (!devices.some(d => d.kind === 'audiooutput' && d.deviceId === this.config.streamDeviceId)) this.disconnectStream('直播声卡已断开，已停止送音；不会改用电脑扬声器。')
    } catch { /* Keep the existing explicit route; never select a fallback. */ }
  }
  private disconnectStream(message: string) {
    if (this.context && this.streamConnected) this.stream?.disconnect(this.context.destination)
    this.streamConnected = false; this.connectedSink = ''; this.signature = ''
    this.routeError = message; this.reporter?.(message)
  }

  reportWith(callback: (message: string) => void) { this.reporter = callback }
  get settings() { return { ...this.config } }
  get failure() { return this.routeError }
  get audioContext() { return this.ensure() }
  private ensure() {
    this.listen()
    if (this.context && this.context.state !== 'closed') return this.context
    const context = this.context = new AudioContext({ latencyHint: 'interactive' })
    context.addEventListener?.('sinkchange', this.sinkChanged)
    this.speech = context.createGain(); this.music = context.createGain(); this.mix = context.createDynamicsCompressor()
    this.stream = context.createGain(); this.monitorGain = context.createGain()
    this.monitorDestination = context.createMediaStreamDestination()
    this.speech.connect(this.mix); this.music.connect(this.mix)
    this.mix.connect(this.stream); this.mix.connect(this.monitorGain); this.monitorGain.connect(this.monitorDestination)
    // The native destination remains disconnected until an explicit live sink has been validated.
    this.monitor = new Audio(); this.monitor.srcObject = this.monitorDestination.stream
    this.monitor.autoplay = false
    this.streamConnected = false; this.connectedSink = ''; this.monitorSink = ''
    this.musicTarget = undefined
    this.levels()
    return context
  }
  private levels() {
    if (!this.context) return
    const c = this.config, at = this.context.currentTime
    this.speech?.gain.setTargetAtTime(clamp(c.speechGain, 1), at, .03)
    const normalMusic = clamp(c.musicGain, .18, 1)
    // Speech remains in front even with a loud saved music setting. Attack reaches
    // 95% in ~75 ms; release takes ~500 ms instead of jumping up between phrases.
    const musicTarget = this.speaking ? Math.min(.035, normalMusic * clamp(c.ducking, .2, 1)) : normalMusic
    if (this.music && musicTarget !== this.musicTarget) {
      const gain = this.music.gain
      if (this.musicTarget === undefined) gain.value = musicTarget // Set before routing: no full-volume startup burst.
      else {
        if (typeof gain.cancelAndHoldAtTime === 'function') gain.cancelAndHoldAtTime(at)
        else gain.cancelScheduledValues?.(at)
        gain.setTargetAtTime(musicTarget, at, musicTarget < this.musicTarget ? .025 : .17)
      }
      this.musicTarget = musicTarget
    }
    this.stream?.gain.setTargetAtTime(this.muted ? 0 : clamp(c.streamGain, 1), at, .02)
    this.monitorGain?.gain.setTargetAtTime(this.muted || !c.monitorEnabled ? 0 : clamp(c.monitorGain, .7) * clamp(c.streamGain, 1), at, .02)
  }
  setSpeaking(value: boolean) { if (value === this.speaking) return; this.speaking = value; this.levels() }
  setMuted(value: boolean) { if (value === this.muted) return; this.muted = value; this.levels() }
  async configure(config?: AudioConfig) {
    const next = { ...fallback, ...config }
    const signature = JSON.stringify(next)
    if (signature === this.signature) { await this.configuration; return }
    this.signature = signature
    this.config = next
    const revision = ++this.revision
    this.levels()
    if (!this.config.monitorEnabled) this.monitor?.pause()
    this.configuration = this.configuration.catch(() => {}).then(() => this.route(revision))
    await this.configuration
  }
  private async route(revision: number) {
    if (revision !== this.revision) return
    const c = { ...this.config }, context = this.ensure()
    this.routeError = ''
    try {
      if (c.mode === 'live') {
        if (!c.streamDeviceId || ['default', 'communications'].includes(c.streamDeviceId)) throw new Error('直播模式需要指定专用虚拟声卡；Windows 请安装并选择 CABLE Input；Mac 请选择 BlackHole 2ch。')
        const target = context as AudioContext & { setSinkId?: (value: string) => Promise<void> }
        if (!target.setSinkId) throw new Error('当前环境不支持独立直播音频输出，请在桌面应用中使用。')
        if (this.connectedSink !== c.streamDeviceId) {
          if (this.streamConnected) { this.stream?.disconnect(context.destination); this.streamConnected = false }
          await target.setSinkId(c.streamDeviceId)
          if (revision !== this.revision) return
          this.connectedSink = c.streamDeviceId
        }
        if (!this.streamConnected) { this.stream?.connect(context.destination); this.streamConnected = true }
      } else if (this.streamConnected) { this.stream?.disconnect(context.destination); this.streamConnected = false }
    } catch (error) {
      if (this.streamConnected) { this.stream?.disconnect(context.destination); this.streamConnected = false }
      const message = error instanceof Error ? error.message : ''
      this.routeError = /[\u4e00-\u9fff]/.test(message) ? message : '无法连接所选直播声卡，已停止送音，请重新检测设备。'
      this.reporter?.(this.routeError)
    }
    if (revision !== this.revision) return
    if (!c.monitorEnabled) { this.monitor?.pause(); return }
    try {
      if (c.mode === 'live' && c.monitorDeviceId && c.monitorDeviceId === c.streamDeviceId) throw new Error('监听设备不能与直播虚拟声卡相同，请选择耳机或扬声器。')
      const monitor = this.monitor as HTMLAudioElement & { setSinkId?: (value: string) => Promise<void> }
      const sink = c.monitorDeviceId || 'default'
      if (sink !== this.monitorSink) {
        if (monitor.setSinkId) await monitor.setSinkId(sink)
        else if (sink !== 'default') throw new Error('当前环境无法切换监听设备。')
        if (revision !== this.revision) return
        this.monitorSink = sink
      }
      if (revision !== this.revision) return
      await context.resume()
      if (revision !== this.revision) return
      await monitor.play()
    } catch (error) {
      this.monitor?.pause()
      const message = error instanceof Error ? error.message : ''
      this.reporter?.(/[\u4e00-\u9fff]/.test(message) ? message : '本地监听无法连接所选设备，请检查设备或选择默认监听。')
    }
    this.levels()
  }
  async ready() { this.ensure(); await this.configuration; await this.context!.resume(); return this.context! }
  connect(source: AudioNode, channel: 'speech' | 'music') { source.connect(channel === 'speech' ? this.speech! : this.music!) }
  disconnect(source: AudioNode) { try { source.disconnect() } catch { /* Source already released. */ } }
  dispose() {
    this.revision++
    if (typeof navigator !== 'undefined') navigator.mediaDevices?.removeEventListener('devicechange', this.deviceChanged); this.listening = false
    this.monitor?.pause(); if (this.monitor) this.monitor.srcObject = null
    this.context?.removeEventListener?.('sinkchange', this.sinkChanged)
    void this.context?.close().catch(() => {})
    this.context = undefined; this.monitor = undefined; this.streamConnected = false; this.signature = ''; this.musicTarget = undefined; this.speaking = false; this.muted = false
  }
}
let sharedBus: LiveAudioBus | undefined
export const getAudioBus = () => sharedBus ||= new LiveAudioBus()

export type MusicPlaybackEvent = { type: 'music-started' | 'music-ended' | 'music-error'; generationId: string; message?: string }
/** Uses exactly the same app-only output bus as speech, with music ducking during dialogue. */
export class MusicAudio {
  private element?: HTMLAudioElement
  private source?: MediaElementAudioSourceNode
  private generationId = ''
  private revision = 0
  private desiredStatus = ''
  private desiredGenerationId = ''
  private desiredMuted = false
  private startedReported = false
  private lastReported = ''
  private readonly bus = getAudioBus()
  constructor(private onEvent: (event: MusicPlaybackEvent) => void) {}
  async configure(music: MusicState, audio: AudioConfig, speaking: boolean, muted: boolean) {
    const revision = ++this.revision
    // Update intent before awaiting routing: queued native events may fire while
    // that await is pending, after the owner has already paused or muted.
    this.desiredStatus = music.status; this.desiredGenerationId = music.current?.generationId || ''; this.desiredMuted = muted
    await this.bus.configure(audio)
    if (revision !== this.revision) return
    this.bus.setSpeaking(speaking); this.bus.setMuted(muted)
    const current = music.current
    if (!current || music.status === 'stopped') { this.stop(); return }
    const track = music.tracks.find(track => track.id === current.trackId)
    if (!track?.source) { this.stop(); this.generationId = current.generationId; this.error(current.generationId, '这首歌的音频文件不存在，请重新导入。'); return }
    if (this.generationId !== current.generationId) {
      this.stop()
      this.generationId = current.generationId
      this.desiredGenerationId = current.generationId
      const element = this.element = new Audio(track.source)
      element.crossOrigin = 'anonymous'; element.preload = 'auto'
      element.onplaying = () => {
        if (this.element !== element || this.generationId !== current.generationId || this.desiredGenerationId !== current.generationId || this.desiredStatus !== 'playing' || this.desiredMuted || this.startedReported) return
        this.startedReported = true
        this.onEvent({ type: 'music-started', generationId: current.generationId })
      }
      element.onended = () => { if (this.generationId === current.generationId && this.lastReported !== current.generationId) { this.lastReported = current.generationId; this.onEvent({ type: 'music-ended', generationId: current.generationId }) } }
      element.onerror = () => this.error(current.generationId, '歌曲播放失败，请检查本地文件或音频链接。')
      const context = this.bus.audioContext
      this.source = context.createMediaElementSource(element); this.bus.connect(this.source, 'music')
    }
    this.desiredStatus = music.status
    if (music.status === 'paused' || muted) { this.element?.pause(); return }
    try { await this.bus.ready(); if (revision !== this.revision) return; await this.element?.play() }
    catch {
      // pause(), stop(), and switching songs intentionally abort pending play().
      // An older play rejection must not skip the new/current song.
      if (revision === this.revision && this.desiredStatus === 'playing' && this.generationId === current.generationId) this.error(current.generationId, '歌曲暂时不能播放，请重新按播放或检查输出设备。')
    }
  }
  private error(generationId: string, message: string) {
    if (generationId !== this.generationId && this.generationId) return
    if (this.lastReported === generationId) return
    this.lastReported = generationId; this.onEvent({ type: 'music-error', generationId, message })
  }
  stop() {
    if (this.element) { this.element.onplaying = null; this.element.onended = null; this.element.onerror = null; this.element.pause(); this.element.removeAttribute('src'); this.element.load() }
    if (this.source) this.bus.disconnect(this.source)
    this.element = undefined; this.source = undefined; this.generationId = ''; this.desiredStatus = ''; this.desiredGenerationId = ''; this.startedReported = false
  }
  dispose() { this.revision++; this.stop() }
}
