/* ==========================================================================
   Cyber Space OS · 极限单元测试
   - Cron：解析 / 下一次触发 / DOM-DOW OR 语义 / 同分钟防重入
   - 分片传输：乱序 / 缺片 / 污染 / 重复 / 串会话 / 超限
   - AES：标准向量 / 往返 / 错口令 / 密文篡改
   - 时间旅行：去重 / 环形上限 / Store 回滚
   - 备份：验签 / FIFO 5 / 热备 3
   - 事件流：Storage Hook / 50 条环形
   - 星系：物理位移 / 弹性碰撞 / 命中 / 缩放 / 降级
   - 运行：npm test
   ========================================================================== */
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const nodeCrypto = require('node:crypto')
const { pathToFileURL } = require('node:url')
const { registerHooks } = require('node:module')

const ROOT = path.resolve(__dirname, '..')

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier.startsWith('.') && !path.extname(specifier)) {
      try {
        return nextResolve(`${specifier}.ts`, context)
      } catch {
        /* 不是 TS 模块时回退原始路径 */
      }
    }
    return nextResolve(specifier, context)
  },
})

function moduleUrl(relative) {
  return pathToFileURL(path.join(ROOT, relative)).href
}

function installWxMock() {
  const storage = new Map()
  globalThis.wx = {
    env: { USER_DATA_PATH: '/tmp' },
    getAppBaseInfo() {
      return { theme: 'dark' }
    },
    getDeviceInfo() {
      return { platform: 'node' }
    },
    getSystemInfoSync() {
      return { platform: 'node' }
    },
    getWindowInfo() {
      return { pixelRatio: 2, windowWidth: 375, windowHeight: 667 }
    },
    getLaunchOptionsSync() {
      return { scene: 1001, path: 'pages/index/index' }
    },
    getStorageSync(key) {
      return storage.has(key) ? storage.get(key) : ''
    },
    setStorageSync(key, value) {
      storage.set(key, value)
    },
    removeStorageSync(key) {
      storage.delete(key)
    },
    nextTick(callback) {
      callback()
    },
    vibrateShort() {},
  }
  return storage
}

async function load(relative) {
  return import(moduleUrl(relative))
}

/* ---- 1. Cron 解析 ---- */
test('Cron：合法 / 非法表达式与 7=周日归一化', async () => {
  const cron = await load('subpackages/grow/utils/cronParser.ts')
  assert.deepEqual(cron.parseCron('0 3 * * 1'), cron.parseCron('0 3 * * 1'))
  assert.ok(cron.parseCron('*/5 * * * *'))
  assert.ok(cron.parseCron('0 0 1,15 * *'))
  assert.equal(cron.parseCron('0 3 * *'), null)
  assert.equal(cron.parseCron('60 3 * * *'), null)
  assert.equal(cron.parseCron('0 24 * * *'), null)
  assert.equal(cron.parseCron('0 3 0 * *'), null)
  assert.equal(cron.parseCron('0 3 * 13 *'), null)
  assert.equal(cron.parseCron('0 3 * * 8'), null)
  assert.equal(cron.parseCron('nope'), null)

  const sundaySeven = cron.parseCron('0 3 * * 7')
  assert.deepEqual(sundaySeven.dayOfWeek.values, [0])
  const sundayZero = cron.parseCron('0 3 * * 0')
  assert.deepEqual(sundayZero.dayOfWeek.values, [0])
})

/* ---- 2. 下一次触发 ---- */
test('Cron：每周一 03:00 的下一次触发与 7 号周日', async () => {
  const cron = await load('subpackages/grow/utils/cronParser.ts')
  const weekly = cron.parseCron('0 3 * * 1')
  const from = new Date(2026, 10, 7, 12, 0, 0)
  const next = cron.nextCronRun(weekly, from)
  assert.ok(next)
  assert.equal(next.getDay(), 1)
  assert.equal(next.getHours(), 3)
  assert.equal(next.getMinutes(), 0)
  assert.ok(next.getTime() > from.getTime())

  const sunday = cron.parseCron('0 3 * * 7')
  const nextSunday = cron.nextCronRun(sunday, from)
  assert.ok(nextSunday)
  assert.equal(nextSunday.getDay(), 0)
  assert.equal(nextSunday.getHours(), 3)
})

/* ---- 3. DOM / DOW OR 语义 ---- */
test('Cron：DOM 与 DOW 同时受限时满足任一即可', async () => {
  const cron = await load('subpackages/grow/utils/cronParser.ts')
  const parsed = cron.parseCron('0 0 1 * 1')
  assert.ok(parsed)
  /* 2026-12-01 是周二，但它是 1 号，DOM 命中 */
  assert.equal(cron.cronMatches(parsed, new Date(2026, 11, 1, 0, 0, 0)), true)
  /* 2026-12-07 是周一，DOW 命中 */
  assert.equal(cron.cronMatches(parsed, new Date(2026, 11, 7, 0, 0, 0)), true)
  /* 2026-12-08 是周二且不是 1 号，两个都不命中 */
  assert.equal(cron.cronMatches(parsed, new Date(2026, 11, 8, 0, 0, 0)), false)
})

/* ---- 4. 调度器同分钟防重入 ---- */
test('CronScheduler：同一分钟只触发一次，完成后下一分钟再触发', async () => {
  const cron = await load('subpackages/grow/utils/cronParser.ts')
  let resolveRun = null
  let runs = 0
  const scheduler = new cron.CronScheduler({
    now: () => new Date(2026, 10, 7, 12, 0, 0).getTime(),
    tickMs: 60000,
    onRun: () => {
      runs += 1
      return new Promise((resolve) => {
        resolveRun = resolve
      })
    },
  })

  try {
    assert.equal(scheduler.start('* * * * *'), true)
    const at = new Date(2026, 10, 7, 12, 0, 0).getTime()
    scheduler.tick(at)
    assert.equal(runs, 1)
    assert.equal(scheduler.state().status, 'running')
    scheduler.tick(at)
    assert.equal(runs, 1, '同一分钟不得重复触发')
    resolveRun()
    await new Promise((resolve) => setImmediate(resolve))
    scheduler.tick(at + 60000)
    assert.equal(runs, 2, '下一分钟应再次触发')
    resolveRun()
  } finally {
    scheduler.destroy()
  }
})

/* ---- 5. 分片：乱序重组 ---- */
test('SlicedTransfer：乱序追加后自动验签重组', async () => {
  const transfer = await load('subpackages/grow/utils/slicedTransfer.ts')
  const payload = '超欢CyberSpaceOS备份码'.repeat(180)
  const pkg = transfer.createTransfer(payload, { chunkSize: 120, sessionId: 'order_test' })
  assert.ok(pkg)
  assert.ok(pkg.total > 1)

  let state = null
  for (let index = pkg.parts.length - 1; index >= 0; index -= 1) {
    const appended = transfer.appendTransferPart(state, pkg.parts[index])
    state = appended.state
    assert.notEqual(appended.result.status, 'error')
  }
  assert.ok(state)
  assert.equal(state.completed, true)
  const result = transfer.appendTransferPart(state, pkg.parts[0])
  assert.equal(result.result.status, 'complete')
})

/* ---- 6. 分片：缺片 ---- */
test('SlicedTransfer：缺片时明确报告缺失序号', async () => {
  const transfer = await load('subpackages/grow/utils/slicedTransfer.ts')
  const payload = 'x'.repeat(900)
  const pkg = transfer.createTransfer(payload, { chunkSize: 120, sessionId: 'missing' })
  assert.ok(pkg)
  let state = null
  for (let index = 0; index < pkg.total; index += 1) {
    if (index === 2) {
      continue
    }
    state = transfer.appendTransferPart(state, pkg.parts[index]).state
  }
  assert.ok(state)
  const duplicate = transfer.appendTransferPart(state, pkg.parts[0])
  assert.equal(duplicate.result.status, 'duplicate')
  assert.equal(duplicate.result.missing.length, 1)
  assert.deepEqual(duplicate.result.missing, [3])
})

/* ---- 7. 分片：污染 / 重复 / 串会话 ---- */
test('SlicedTransfer：污染片拒绝、重复片忽略、串会话拒绝', async () => {
  const transfer = await load('subpackages/grow/utils/slicedTransfer.ts')
  const pkg = transfer.createTransfer('corruption-check'.repeat(20), {
    chunkSize: 100,
    sessionId: 'guard',
  })
  assert.ok(pkg)
  const parsed = transfer.parseTransferPart(pkg.parts[0])
  assert.ok(parsed)
  const tampered = pkg.parts[0].replace(parsed.chunk.slice(0, 3), 'XXX')
  assert.equal(transfer.parseTransferPart(tampered), null)
  assert.equal(transfer.appendTransferPart(null, tampered).result.status, 'error')

  let state = transfer.appendTransferPart(null, pkg.parts[0]).state
  const duplicate = transfer.appendTransferPart(state, pkg.parts[0])
  assert.equal(duplicate.result.status, 'duplicate')

  const other = transfer.createTransfer('other-session', {
    chunkSize: 100,
    sessionId: 'other',
  })
  assert.ok(other)
  if (pkg.total > 1) {
    state = transfer.appendTransferPart(null, pkg.parts[0]).state
    assert.equal(
      transfer.appendTransferPart(state, other.parts[0]).result.status,
      'error',
    )
  }
})

/* ---- 8. 分片：空 / 超限 / 非法格式 ---- */
test('SlicedTransfer：空载荷、超上限分片、非法格式全部拒绝', async () => {
  const transfer = await load('subpackages/grow/utils/slicedTransfer.ts')
  assert.equal(transfer.createTransfer(''), null)
  assert.equal(
    transfer.createTransfer('a'.repeat(10000), { chunkSize: 80, maxParts: 4 }),
    null,
  )
  assert.equal(transfer.parseTransferPart('not-a-part'), null)
  assert.equal(
    transfer.parseTransferPart('[Part 2/1] CSOS1|x|2|1|00000000|00000000|"x"'),
    null,
  )
})

/* ---- 9. AES：标准向量 ---- */
test('AES Vault：AES-256-CBC 与 Node crypto 标准向量一致', async () => {
  const vault = await load('subpackages/grow/utils/aesVault.ts')
  const passphrase = 'chaohuan-cyber-vault'
  const iv = '00112233445566778899aabbccddeeff'
  const plain = '超欢 Cyber Space OS · AES-256-CBC 冷备'
  const cipher = vault.encryptVault(plain, passphrase, iv)
  assert.ok(cipher)
  const parts = cipher.split('|')
  assert.equal(parts[0], 'CYBER-AES1')
  assert.equal(parts[1], iv)

  const key = nodeCrypto
    .createHash('sha256')
    .update(`chaohuan-cyber-vault|${passphrase}`)
    .digest()
  const nodeCipher = nodeCrypto.createCipheriv(
    'aes-256-cbc',
    key,
    Buffer.from(iv, 'hex'),
  )
  const expected = Buffer.concat([
    nodeCipher.update(plain, 'utf8'),
    nodeCipher.final(),
  ]).toString('hex')
  assert.equal(parts[2], expected)
  assert.equal(vault.decryptVault(cipher, passphrase), plain)
})

/* ---- 10. AES：错口令 / 篡改 ---- */
test('AES Vault：错口令与篡改密文不得还原原文', async () => {
  const vault = await load('subpackages/grow/utils/aesVault.ts')
  const cipher = vault.encryptVault('secret payload', 'correct-pass')
  assert.ok(cipher)
  /* CBC 无 MAC：错口令可能恰好通过 padding，只要求不得还原原文 */
  assert.notEqual(vault.decryptVault(cipher, 'wrong-pass'), 'secret payload')
  const tampered =
    cipher.slice(0, -2) + (cipher.endsWith('00') ? '01' : '00')
  assert.notEqual(
    vault.decryptVault(tampered, 'correct-pass'),
    'secret payload',
    '篡改密文不得还原出原文',
  )
  assert.equal(vault.encryptVault('secret', 'abc'), null)
  assert.equal(vault.decryptVault('plain text', 'correct-pass'), null)
})

/* ---- 11. 时间旅行：去重与环形上限 ---- */
test('TimeTravel：相同状态去重，最多保留 20 帧', async () => {
  installWxMock()
  const engineModule = await load('subpackages/grow/utils/timeTravelEngine.ts')
  const store = await load('core/toolbox/store.ts')
  const engine = new engineModule.TimeTravelEngine(20)

  assert.ok(engine.capture('初始'))
  assert.equal(engine.capture('相同状态'), null)
  for (let index = 0; index < 30; index += 1) {
    store.toolboxStore.usageCount = index + 1
    engine.capture(`帧 ${index}`)
  }
  assert.equal(engine.size(), 20)
  const views = engine.views(0)
  assert.equal(views.length, 20)
  assert.equal(views[0].active, true)
})

/* ---- 11.1 时间旅行：跨页面持久化 ---- */
test('TimeTravel：帧持久化后跨页面恢复，坏帧自动丢弃', async () => {
  const storage = installWxMock()
  const engineModule = await load('subpackages/grow/utils/timeTravelEngine.ts')
  const store = await load('core/toolbox/store.ts')
  const engine = new engineModule.TimeTravelEngine(20)

  assert.ok(engine.capture('初始'))
  store.toolboxStore.usageCount = 3
  assert.ok(engine.capture('使用 3 次'))
  assert.equal(engine.persist(), true)

  const restored = new engineModule.TimeTravelEngine(20)
  assert.equal(restored.restorePersisted(), 2, '新引擎应恢复两帧')
  assert.deepEqual(
    restored.views(1).map((frame) => frame.label),
    ['初始', '使用 3 次'],
  )
  assert.equal(restored.preview(1).toolbox.usageCount, 3)

  for (let index = 0; index < 10; index += 1) {
    store.toolboxStore.usageCount = 10 + index
    engine.capture(`帧 ${index}`)
  }
  assert.equal(engine.persist(), true)
  const capped = new engineModule.TimeTravelEngine(20)
  assert.equal(capped.restorePersisted(), 8, '磁盘只保留最近 8 帧')
  assert.equal(capped.views().length, 8)

  storage.set('cyber:frames:v1', [{ id: 'broken' }, ...restored.getFrames()])
  const sanitized = new engineModule.TimeTravelEngine(20)
  assert.equal(sanitized.restorePersisted(), 2, '坏帧必须被过滤')
  assert.equal(sanitized.getFrames().every((frame) => frame.id !== 'broken'), true)

  storage.set('cyber:frames:v1', 'not-an-array')
  const empty = new engineModule.TimeTravelEngine(20)
  assert.equal(empty.restorePersisted(), 0)
})

/* ---- 12. 时间旅行：回滚 Store ---- */
test('TimeTravel：穿越可回滚偏好 / 收藏 / 历史', async () => {
  installWxMock()
  const engineModule = await load('subpackages/grow/utils/timeTravelEngine.ts')
  const preference = await load('core/stores/preference.ts')
  const toolbox = await load('core/toolbox/store.ts')
  const history = await load('core/stores/history.ts')
  const ui = await load('core/stores/ui.ts')
  const engine = new engineModule.TimeTravelEngine(10)

  preference.preferenceStore.init()
  preference.preferenceStore.setMotionIndex(2)
  preference.preferenceStore.setAutoCleanDays(7)
  toolbox.toolboxStore.favorites = ['unit', 'tax']
  toolbox.toolboxStore.recents = ['unit']
  toolbox.toolboxStore.usageCount = 2
  history.historyStore.records = [
    { id: 'h1', toolName: '单位换算', timestamp: Date.now() },
  ]
  ui.uiStore.setThemeMode('light')
  assert.ok(engine.capture('回滚点'))

  preference.preferenceStore.setMotionIndex(0)
  preference.preferenceStore.setAutoCleanDays(30)
  toolbox.toolboxStore.favorites = []
  toolbox.toolboxStore.recents = []
  toolbox.toolboxStore.usageCount = 9
  history.historyStore.records = []
  ui.uiStore.setThemeMode('dark')

  const result = engine.travel(0)
  assert.equal(result.ok, true)
  assert.equal(preference.preferenceStore.motion, 'saver')
  assert.equal(preference.preferenceStore.autoCleanDays, 7)
  assert.deepEqual(toolbox.toolboxStore.favorites, ['unit', 'tax'])
  assert.equal(toolbox.toolboxStore.usageCount, 2)
  assert.equal(history.historyStore.records.length, 1)
  assert.equal(ui.uiStore.themeMode, 'light')
})

/* ---- 13. 备份验签 / FIFO ---- */
test('Backup：CRC 验签、自动快照 FIFO 5、热备 3 槽', async () => {
  const wxStorage = installWxMock()
  const engineModule = await load('subpackages/grow/utils/timeTravelEngine.ts')
  const preference = await load('core/stores/preference.ts')
  const engine = new engineModule.TimeTravelEngine(5)
  preference.preferenceStore.init()
  assert.ok(engine.capture('备份源'))

  const snapshot = engine.getFrames()[0]
  const payload = engineModule.encodeBackup(snapshot, '测试备份')
  const decoded = engineModule.decodeBackup(payload)
  assert.equal(decoded.ok, true)
  assert.equal(decoded.envelope.snapshot.toolbox.usageCount, snapshot.toolbox.usageCount)
  assert.equal(engineModule.decodeBackup(payload.replace('"version":1', '"version":2')).ok, false)
  assert.equal(engineModule.decodeBackup('{}').ok, false)

  for (let index = 0; index < 8; index += 1) {
    engineModule.writeAutoSnapshot(payload, `自动 ${index}`)
  }
  assert.equal(engineModule.readAutoSnapshots().length, 5)
  for (let index = 0; index < 5; index += 1) {
    engineModule.writeHotSlot(payload, `热备 ${index}`)
  }
  assert.equal(engineModule.readHotSlots().length, 3)
  assert.ok(wxStorage.size > 0)
})

/* ---- 14. 事件流：Hook 与 50 条环形 ---- */
test('EventLog：Storage Hook 记录并恢复，超过 50 条自动淘汰', async () => {
  const engineModule = await load('subpackages/grow/utils/timeTravelEngine.ts')
  const log = new engineModule.EventLog(50)
  for (let index = 0; index < 60; index += 1) {
    log.push('action', `ev-${index}`, 'detail')
  }
  const list = log.list(50)
  assert.equal(list.length, 50)
  assert.equal(list[0].name, 'ev-59')

  const storage = {
    values: new Map(),
    getStorageSync(key) {
      return this.values.has(key) ? this.values.get(key) : ''
    },
    setStorageSync(key, value) {
      this.values.set(key, value)
    },
    removeStorageSync(key) {
      this.values.delete(key)
    },
  }
  const restore = log.installStorageHook(storage)
  storage.getStorageSync('k')
  storage.setStorageSync('k', { a: 1 })
  storage.removeStorageSync('k')
  const events = log.list(10)
  const names = events.map((item) => item.name)
  assert.ok(names.includes('getStorageSync'))
  assert.ok(names.includes('setStorageSync'))
  assert.ok(names.includes('removeStorageSync'))
  restore()
  const before = log.list(50).length
  storage.getStorageSync('k')
  assert.equal(log.list(50).length, before, 'restore 后不得继续记录')
})

/* ---- 15. 星系物理 / 命中 / 缩放 / 降级 ---- */
test('Galaxy：引力位移、弹性碰撞、命中、缩放与降级', async () => {
  const galaxy = await load('subpackages/grow/utils/canvasGalaxy.ts')
  const engine = new galaxy.GalaxyEngine({ width: 320, height: 240, maxNodes: 24 })
  engine.setNodes([
    { id: 'a', label: 'A', kind: 'favorite', value: '1' },
    { id: 'b', label: 'B', kind: 'history', value: '2' },
  ])
  const particles = engine.getParticles()
  const a = particles[0]
  const b = particles[1]
  /* 强制两球重叠，验证弹性碰撞把位置分离 */
  a.x = 0
  a.y = 0
  b.x = 1
  b.y = 0
  const beforeDistance = Math.abs(b.x - a.x)
  engine.step(16)
  assert.ok(Math.abs(b.x - a.x) > beforeDistance, '重叠星球必须被弹开')
  assert.ok(Number.isFinite(a.x) && Number.isFinite(a.y))

  /* 点中第一颗星球 */
  const view = engine.getView()
  const screenX = engine.getSize().width / 2 + view.x + a.x * view.zoom
  const screenY = engine.getSize().height / 2 + view.y + a.y * view.zoom
  const hit = engine.hitTest(screenX, screenY)
  assert.ok(hit)
  assert.equal(hit.id, 'a')

  engine.zoomBy(1.3)
  assert.ok(engine.getView().zoom > 1)
  engine.zoomBy(0.5)
  assert.ok(engine.getView().zoom >= 0.55)
  engine.resetView()
  assert.equal(engine.getView().zoom, 1)

  engine.setView(80, -40, 1.45)
  const focusView = engine.getView()
  assert.equal(focusView.x, 80)
  assert.equal(focusView.y, -40)
  assert.equal(focusView.zoom, 1.45)
  engine.resetView()

  engine.setDegraded(true)
  assert.equal(engine.isDegraded(), true)
  const ctx = {
    save() {},
    restore() {},
    clearRect() {},
    setTransform() {},
    translate() {},
    scale() {},
    beginPath() {},
    arc() {},
    fill() {},
    stroke() {},
    fillText() {},
    measureText(text) {
      return { width: text.length * 8 }
    },
    createRadialGradient() {
      return { addColorStop() {} }
    },
  }
  assert.doesNotThrow(() => engine.draw(ctx))

  const nodes = galaxy.buildGalaxyNodes({
    favorites: ['unit', 'tax'],
    history: [{ toolName: '单位换算' }],
    preferenceCount: 4,
    snapshotCount: 2,
  })
  assert.ok(nodes.length >= 4)
  assert.equal(nodes[0].kind, 'favorite')
})

/* ---- 16. 星系散开与双主题文字 ---- */
test('Galaxy：13 节点保持散开，文字颜色按主题切换并带细描边', async () => {
  const galaxy = await load('subpackages/grow/utils/canvasGalaxy.ts')
  const engine = new galaxy.GalaxyEngine({ width: 375, height: 220 })
  engine.setNodes(
    Array.from({ length: 13 }, (_, index) => ({
      id: `n-${index}`,
      label: `node-${index}`,
      kind: 'history',
      value: '',
      weight: 1,
    })),
  )
  for (let index = 0; index < 300; index += 1) {
    engine.step(16)
  }
  const particles = engine.getParticles()
  const radii = particles.map((particle) =>
    Math.sqrt(particle.x * particle.x + particle.y * particle.y),
  )
  const averageRadius =
    radii.reduce((sum, value) => sum + value, 0) / radii.length
  assert.ok(averageRadius > 55, `星球平均半径过小：${averageRadius}`)
  let minPair = Infinity
  for (let left = 0; left < particles.length; left += 1) {
    for (let right = left + 1; right < particles.length; right += 1) {
      const a = particles[left]
      const b = particles[right]
      minPair = Math.min(minPair, Math.hypot(a.x - b.x, a.y - b.y))
    }
  }
  assert.ok(minPair > 28, `星球仍然过度挤压：${minPair}`)

  const drawWithTheme = (theme) => {
    const records = []
    const ctx = {
      fillStyle: '',
      strokeStyle: '',
      shadowColor: '',
      shadowBlur: 0,
      lineWidth: 1,
      font: '',
      textAlign: '',
      textBaseline: '',
      globalAlpha: 1,
      save() {},
      restore() {},
      clearRect() {},
      setTransform() {},
      translate() {},
      scale() {},
      beginPath() {},
      arc() {},
      fill() {},
      stroke() {},
      fillText(text) {
        records.push({
          text,
          fill: this.fillStyle,
          shadow: this.shadowColor,
          blur: this.shadowBlur,
        })
      },
      measureText(text) {
        return { width: text.length * 8 }
      },
      createRadialGradient() {
        return { addColorStop() {} }
      },
    }
    const single = new galaxy.GalaxyEngine({ width: 375, height: 220, theme })
    single.setNodes([
      { id: 'one', label: 'rmb', kind: 'favorite', value: '收藏', weight: 1 },
    ])
    single.draw(ctx)
    return records
  }

  const light = drawWithTheme('light')
  assert.equal(light.length, 1, '单节点应绘制一次文字')
  assert.equal(light[0].fill, 'rgba(0,0,0,0.75)')
  assert.equal(light[0].shadow, 'rgba(255,255,255,0.8)')
  assert.equal(light[0].blur, 2)

  const dark = drawWithTheme('dark')
  assert.equal(dark.length, 1)
  assert.equal(dark[0].fill, 'rgba(255,255,255,0.9)')
  assert.equal(dark[0].shadow, 'rgba(0,0,0,0.65)')
  assert.equal(dark[0].blur, 2)
})

/* ---- 17. Geek Lab 折叠与 Canvas 初始化时机 ---- */
test('Geek Lab：默认收起，展开后才查询 Canvas，初始化失败自动重试', () => {
  const ts = fs.readFileSync(
    path.join(ROOT, 'subpackages/grow/pages/settings/index.ts'),
    'utf8',
  )
  const wxml = fs.readFileSync(
    path.join(ROOT, 'subpackages/grow/pages/settings/index.wxml'),
    'utf8',
  )
  const wxss = fs.readFileSync(
    path.join(ROOT, 'subpackages/grow/pages/settings/index.wxss'),
    'utf8',
  )

  assert.ok(ts.includes('geekLabOpen: false'), '极客实验室必须默认收起')
  assert.ok(ts.includes('geekGuideOpen: false'), '快速上手必须默认收起')
  assert.ok(ts.includes('onToggleGeekGuide()'), '缺少快速上手折叠开关')
  assert.ok(wxml.includes('class="geek-guide"'), '缺少快速上手折叠卡')
  assert.ok(
    wxml.includes('bindtap="onToggleGeekGuide"'),
    '快速上手标题必须可点击展开',
  )
  assert.ok(ts.includes('onToggleGeekLab()'), '缺少折叠面板开关')
  assert.ok(ts.includes('retryMountGalaxy(attempt'), 'Canvas 初始化必须带重试')
  assert.ok(
    ts.includes('.fields({ node: true, size: true })'),
    'Canvas 查询只请求 node/size，避免 rect 字段在 Skyline 下拿不到尺寸',
  )
  assert.equal(ts.includes('rect: true'), false, '不得在 Canvas 查询里请求 rect')
  assert.ok(ts.includes('isDevtools()'), '开发者工具必须走独立星系渲染分支')
  assert.ok(ts.includes('mountGalaxyDom'), '缺少开发者工具 DOM 星系兜底')
  assert.ok(ts.includes('galaxyDomMode'), '缺少 DOM 星系状态')
  assert.ok(ts.includes('CANVAS_QUERY_TIMEOUT'), 'Canvas 节点查询必须带看门狗')
  assert.ok(ts.includes('.boundingClientRect()'), 'DOM 兜底必须查询真实矩形')
  assert.ok(ts.includes('domTouchPoint'), 'DOM 兜底必须用 client 坐标换算')
  assert.ok(ts.includes('refreshGalaxyRect'), 'DOM 触摸必须刷新真实 rect')
  assert.ok(ts.includes('focusGalaxyParticle'), '缺少点击星球自动聚焦')
  assert.ok(ts.includes('tickGalaxyFocus'), '缺少相机聚焦动画帧')
  assert.ok(ts.includes('GALAXY_FOCUS_ZOOM'), '缺少聚焦目标缩放')
  assert.ok(wxml.includes('cyber-galaxy__dom'), '缺少 DOM 星系渲染层')
  assert.ok(wxml.includes('galaxyDots'), '缺少 DOM 粒子循环')
  assert.ok(wxml.includes('!galaxyDomMode'), 'DOM 模式必须移除 Canvas，避免拦截触摸')
  assert.ok(
    wxml.includes('bindtap="onToggleGeekLab"'),
    '实验室标题必须可点击展开',
  )
  assert.ok(
    wxml.includes('wx:if="{{geekLabOpen}}"'),
    '六个 Cyber OS 模块必须位于折叠体内',
  )
  assert.ok(wxml.includes('id="galaxyCanvas"'), 'Canvas 容器缺失')
  assert.ok(
    wxml.includes('env(safe-area-inset-top, 0px)'),
    '顶部内容必须叠加安全区',
  )
  assert.ok(wxml.includes('scroll-x'), '时间轴必须使用 scroll-view scroll-x')
  assert.ok(wxml.includes('enable-flex'), '时间轴 scroll-view 必须启用 flex 布局')
  assert.ok(
    ts.includes('restorePersisted()'),
    '时间旅行帧必须跨页面恢复，避免每次只剩系统启动',
  )
  assert.ok(ts.includes('.persist()'), '新增帧后必须持久化')
  assert.ok(
    wxml.includes('cyber-timeline__hint'),
    '只有 1 帧时必须解释时间轴为何不可拖动',
  )
  assert.ok(wxss.includes('.cyber-timeline__hint'), '缺少时间轴提示样式')
  const timelineBlock = wxss.match(/\.cyber-timeline\s*\{[^}]*\}/)
  assert.ok(timelineBlock, '缺少 .cyber-timeline 样式')
  assert.ok(
    timelineBlock[0].includes('height: 250rpx'),
    '时间轴 scroll-view 必须有显式高度，避免高度 0 导致预览区叠在卡片上',
  )
  assert.ok(
    wxss.includes('var(--glass-accent-glow)'),
    '紫色光晕必须走主题令牌',
  )
  assert.ok(
    wxss.includes('white-space: normal'),
    '时间轴长文本必须允许正常换行',
  )
  assert.ok(
    wxss.includes('word-break: break-all'),
    '时间轴长文本必须强制折行',
  )
})

/* ---- 18. Event Stream 滚动容器 ---- */
test('Event Stream：必须使用原生 scroll-view，显式高度且详情正常换行', () => {
  const wxml = fs.readFileSync(
    path.join(ROOT, 'subpackages/grow/pages/settings/index.wxml'),
    'utf8',
  )
  const wxss = fs.readFileSync(
    path.join(ROOT, 'subpackages/grow/pages/settings/index.wxss'),
    'utf8',
  )

  const logBlock = wxml.match(
    /<scroll-view[^>]*class="cyber-log"[^>]*>[\s\S]*?<\/scroll-view>/,
  )
  assert.ok(logBlock, 'Event Stream 必须使用 scroll-view 承载日志')
  assert.ok(logBlock[0].includes('scroll-y'), 'Event Stream 必须开启纵向滚动')
  assert.ok(
    logBlock[0].includes('show-scrollbar="{{false}}"'),
    'Event Stream 必须隐藏滚动条',
  )
  assert.equal(
    /catchtouchmove/.test(logBlock[0]),
    false,
    '日志滚动区不得拦截触摸事件，避免与外层设置页手势冲突',
  )
  assert.ok(
    logBlock[0].includes('class="cyber-log__list"'),
    '日志列表必须包裹独立内容容器',
  )

  const containerBlock = wxss.match(/\.cyber-log\s*\{[^}]*\}/)
  assert.ok(containerBlock, '缺少 .cyber-log 样式')
  assert.ok(
    containerBlock[0].includes('height: 380rpx'),
    'scroll-view 必须有显式高度，max-height 不产生滚动',
  )
  assert.equal(
    /max-height/.test(containerBlock[0]),
    false,
    'scroll-view 不应继续使用 max-height',
  )

  const rowBlock = wxss.match(/\.cyber-log__row\s*\{[^}]*\}/)
  assert.ok(rowBlock, '缺少 .cyber-log__row 样式')
  assert.ok(rowBlock[0].includes('flex-wrap: wrap'), '日志行必须允许换行')

  const detailBlock = wxss.match(/\.cyber-log__detail\s*\{[^}]*\}/)
  assert.ok(detailBlock, '缺少 .cyber-log__detail 样式')
  assert.ok(
    detailBlock[0].includes('white-space: normal'),
    '日志详情不得使用单行省略',
  )
  assert.ok(
    detailBlock[0].includes('word-break: break-all'),
    '日志详情必须强制折行',
  )
  assert.equal(
    /text-overflow: ellipsis/.test(detailBlock[0]),
    false,
    '日志详情不得再截断为省略号',
  )
})

