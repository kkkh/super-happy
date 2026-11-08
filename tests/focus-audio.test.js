/* ==========================================================================
   focus-audio · 三轨 / 淡入淡出 / suspend / dispose / BGM 保活
   - 依赖全部注入，不触碰真实 WebAudio / wx
   - 运行：npm test
   ========================================================================== */
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { pathToFileURL } = require('node:url')
const { registerHooks } = require('node:module')

const ROOT = path.resolve(__dirname, '..')

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier.startsWith('.') && !path.extname(specifier)) {
      try {
        return nextResolve(`${specifier}.ts`, context)
      } catch {
        /* 非 TS 模块回退原始路径 */
      }
    }
    return nextResolve(specifier, context)
  },
})

async function loadAudio() {
  return import(pathToFileURL(path.join(ROOT, 'subpackages/life/lib/focus-audio.ts')).href)
}

function mockContext() {
  const state = {
    sources: [],
    gains: [],
    suspended: false,
    resumed: false,
    closed: false,
  }
  const context = {
    destination: {},
    currentTime: 0,
    state: 'running',
    createBuffer(channels, length, sampleRate) {
      const data = new Float32Array(length)
      return {
        length,
        sampleRate,
        getChannelData() {
          return data
        },
      }
    },
    createBufferSource() {
      const source = {
        buffer: null,
        loop: false,
        started: false,
        stopped: false,
        connect() {},
        start() {
          this.started = true
        },
        stop() {
          this.stopped = true
        },
        disconnect() {},
      }
      state.sources.push(source)
      return source
    },
    createGain() {
      const gain = {
        gain: {
          value: 0,
          linearRampToValueAtTime(value) {
            this.value = value
          },
          setTargetAtTime(value) {
            this.value = value
          },
        },
        connect() {},
        disconnect() {},
      }
      state.gains.push(gain)
      return gain
    },
    suspend() {
      state.suspended = true
    },
    resume() {
      state.resumed = true
    },
    close() {
      state.closed = true
    },
  }
  return { context, state }
}

test('环境音：3 轨上限、去重、主音量与每轨音量', async () => {
  const audio = await loadAudio()
  const { context, state } = mockContext()
  const engine = new audio.FocusAudioEngine({
    createContext: () => context,
    fadeMs: 0,
  })
  engine.setTracks(['fire', 'rain', 'keyboard', 'rain'], {
    volumes: { rain: 0.6, fire: 0.2, keyboard: 0.9 },
    masterVolume: 0.4,
  })
  assert.deepEqual(engine.activeTracks, ['rain', 'fire', 'keyboard'])
  assert.equal(state.sources.length, 3)
  assert.equal(state.gains[0].gain.value, 0.4, '主 Gain 使用 masterVolume')
  assert.equal(state.gains[1].gain.value, 0.6)
  assert.equal(state.gains[2].gain.value, 0.2)
  assert.equal(state.gains[3].gain.value, 0.9)
  assert.ok(state.sources.every((source) => source.started))
})

test('环境音：关闭轨道立即停止；全部关闭不创建上下文', async () => {
  const audio = await loadAudio()
  const { context, state } = mockContext()
  const engine = new audio.FocusAudioEngine({
    createContext: () => context,
    fadeMs: 0,
  })
  engine.setTracks(['rain', 'fire'])
  const rainSource = state.sources[0]
  const fireSource = state.sources[1]
  engine.setTracks(['rain'])
  assert.deepEqual(engine.activeTracks, ['rain'])
  assert.equal(fireSource.stopped, true)
  assert.equal(rainSource.stopped, false)

  engine.setTracks([])
  assert.deepEqual(engine.activeTracks, [])
  assert.equal(rainSource.stopped, true)

  const { context: freshContext, state: freshState } = mockContext()
  let created = 0
  const idle = new audio.FocusAudioEngine({
    fadeMs: 0,
    createContext: () => {
      created += 1
      return freshContext
    },
  })
  idle.setTracks([])
  assert.equal(created, 0)
  assert.equal(freshState.gains.length, 0)
})

test('环境音：suspend / resume / dispose 幂等', async () => {
  const audio = await loadAudio()
  const { context, state } = mockContext()
  const engine = new audio.FocusAudioEngine({
    createContext: () => context,
    fadeMs: 0,
  })
  engine.setTracks(['rain'])
  engine.suspend()
  assert.equal(state.suspended, true)
  assert.equal(engine.isSuspended, true)
  engine.suspend()
  assert.equal(state.suspended, true)
  engine.resume()
  assert.equal(state.resumed, true)
  assert.equal(engine.isSuspended, false)

  const source = state.sources[0]
  engine.dispose()
  assert.equal(source.stopped, true)
  assert.equal(state.closed, true)
  assert.equal(engine.disabled, true)
  assert.deepEqual(engine.activeTracks, [])
  assert.doesNotThrow(() => engine.dispose())
})

test('环境音：上下文创建失败 → disabled，不再重试、不抛错', async () => {
  const audio = await loadAudio()
  let attempts = 0
  const engine = new audio.FocusAudioEngine({
    fadeMs: 0,
    createContext: () => {
      attempts += 1
      throw new Error('WebAudio unavailable')
    },
  })
  assert.doesNotThrow(() => engine.setTracks(['rain']))
  assert.equal(engine.disabled, true)
  assert.deepEqual(engine.activeTracks, [])
  engine.setTracks(['fire'])
  assert.equal(attempts, 1)

  const nullEngine = new audio.FocusAudioEngine({
    fadeMs: 0,
    createContext: () => null,
  })
  nullEngine.setTracks(['rain'])
  assert.equal(nullEngine.disabled, true)
})

test('噪声：三轨各 16000 样本、非空、范围合法、可复现', async () => {
  const audio = await loadAudio()
  for (const track of ['rain', 'fire', 'keyboard']) {
    const first = audio.createNoiseSamples(track)
    const second = audio.createNoiseSamples(track)
    assert.equal(first.length, 16000)
    assert.equal(second.length, 16000)
    assert.deepEqual(Array.from(first.slice(0, 64)), Array.from(second.slice(0, 64)))
    assert.ok(first.some((value) => value !== 0), `${track} 应产生非空噪声`)
    for (const value of first) {
      assert.ok(value >= -1 && value <= 1, `${track} 样本越界：${value}`)
    }
  }
})

test('BGM WAV：RIFF/WAVE 头、16-bit mono、低振幅', async () => {
  const audio = await loadAudio()
  const bytes = audio.buildBgmWav()
  assert.equal(new TextDecoder().decode(bytes.slice(0, 4)), 'RIFF')
  assert.equal(new TextDecoder().decode(bytes.slice(8, 12)), 'WAVE')
  assert.equal(new TextDecoder().decode(bytes.slice(36, 40)), 'data')
  assert.equal(bytes.length, 44 + 8000 * 2)
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  assert.equal(view.getUint16(22, true), 1)
  assert.equal(view.getUint16(34, true), 16)
  const peak = Math.max(
    Math.abs(view.getInt16(44 + 500 * 2, true)),
    Math.abs(view.getInt16(44 + 1500 * 2, true)),
  )
  assert.ok(peak < 0x7fff * 0.1, `振幅应低于 10%：${peak}`)
  assert.ok(peak > 0, '应有低振幅载波')
})

test('BGM：写文件 / 播放 / onEnded 循环 / stop / dispose', async () => {
  const audio = await loadAudio()
  const manager = {
    title: '',
    src: '',
    volume: 0,
    paused: false,
    plays: 0,
    stops: 0,
    seeks: [],
    ended: null,
    error: null,
    play() {
      this.plays += 1
    },
    stop() {
      this.stops += 1
    },
    seek(time) {
      this.seeks.push(time)
    },
    onEnded(handler) {
      this.ended = handler
    },
    offEnded(handler) {
      if (this.ended === handler) {
        this.ended = null
      }
    },
    onError(handler) {
      this.error = handler
    },
    offError(handler) {
      if (this.error === handler) {
        this.error = null
      }
    },
  }
  let written = null
  const files = {
    writeFileSync(filePath, data) {
      written = { filePath, data }
    },
  }
  const controller = new audio.FocusBgmController({
    getManager: () => manager,
    getFileSystem: () => files,
    userDataPath: () => '/tmp/focus',
  })
  assert.equal(controller.start(), true)
  assert.equal(manager.title, audio.BGM_TITLE)
  assert.equal(manager.src, '/tmp/focus/focus-bgm-v1.wav')
  assert.equal(manager.volume, audio.BGM_VOLUME)
  assert.equal(manager.plays, 1)
  assert.equal(controller.isPlaying, true)
  assert.equal(controller.paused, false)
  assert.equal(written.filePath, '/tmp/focus/focus-bgm-v1.wav')
  assert.ok(written.data.length > 44)

  manager.ended()
  assert.deepEqual(manager.seeks, [0])
  assert.equal(manager.plays, 2)

  manager.paused = true
  assert.equal(controller.paused, true)

  controller.stop()
  assert.equal(manager.stops, 1)
  assert.equal(controller.isPlaying, false)
  controller.dispose()
  assert.equal(manager.ended, null)
  assert.doesNotThrow(() => controller.start())
  assert.equal(controller.disabled, true)
})

test('BGM：异步 onError → disabled + onWarn，dispose 解绑', async () => {
  const audio = await loadAudio()
  const warnings = []
  let errorHandler = null
  const manager = {
    title: '',
    src: '',
    play() {},
    stop() {},
    onEnded() {},
    offEnded() {},
    onError(handler) {
      errorHandler = handler
    },
    offError(handler) {
      if (errorHandler === handler) {
        errorHandler = null
      }
    },
  }
  const controller = new audio.FocusBgmController({
    getManager: () => manager,
    getFileSystem: () => ({ writeFileSync() {} }),
    userDataPath: () => '/tmp',
    onWarn: (message) => warnings.push(message),
  })
  assert.equal(controller.start(), true)
  assert.equal(typeof errorHandler, 'function')
  errorHandler(new Error('player aborted'))
  assert.equal(controller.disabled, true)
  assert.equal(controller.isPlaying, false)
  assert.ok(warnings.some((message) => message.includes('后台保活中断')))

  controller.dispose()
  assert.equal(errorHandler, null)
})

test('BGM：管理器 / 文件系统不可用 → 降级且不抛错', async () => {
  const audio = await loadAudio()
  const noManager = new audio.FocusBgmController({
    getManager: () => null,
    getFileSystem: () => ({ writeFileSync() {} }),
    userDataPath: () => '/tmp',
  })
  assert.equal(noManager.start(), false)
  assert.equal(noManager.disabled, true)

  const noFiles = new audio.FocusBgmController({
    getManager: () => ({ play() {}, stop() {} }),
    getFileSystem: () => null,
    userDataPath: () => '/tmp',
  })
  assert.equal(noFiles.start(), false)
  assert.equal(noFiles.disabled, true)
})
