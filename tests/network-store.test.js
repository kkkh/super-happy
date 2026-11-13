/* ==========================================================================
   网络状态 Store 契约
   - unknown fail-open；init 幂等；断网 / 恢复事件驱动
   - getNetworkType 的旧快照不得覆盖更新的网络事件
   ========================================================================== */
const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')
const { registerHooks } = require('node:module')

const ROOT = path.resolve(__dirname, '..')
const URL_ROOT = `${require('node:url').pathToFileURL(ROOT).href}/`

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier.startsWith('.') && !path.extname(specifier)) {
      return nextResolve(`${specifier}.ts`, context)
    }
    return nextResolve(specifier, context)
  },
})

const listeners = []
const pendingChecks = []

global.wx = {
  getNetworkType(options) {
    pendingChecks.push(options)
  },
  onNetworkStatusChange(handler) {
    listeners.push(handler)
  },
}

test('网络状态：fail-open、事件驱动、幂等与旧快照丢弃', async () => {
  const { networkStore } = await import(`${URL_ROOT}core/stores/network.ts`)

  assert.equal(networkStore.online, true, 'unknown 必须按在线处理')
  assert.equal(networkStore.offline, false)

  networkStore.init()
  assert.equal(listeners.length, 1, '监听器只能注册一次')
  assert.equal(pendingChecks.length, 1, 'init 应触发一次主动检查')

  pendingChecks.shift().success({ networkType: 'wifi' })
  assert.equal(networkStore.online, true)

  networkStore.init()
  assert.equal(listeners.length, 1, '重复 init 不得重复注册')
  assert.equal(pendingChecks.length, 0, '重复 init 不得重复检查')

  listeners[0]({ isConnected: false, networkType: 'none' })
  assert.equal(networkStore.offline, true)

  listeners[0]({ isConnected: true, networkType: 'wifi' })
  assert.equal(networkStore.online, true)

  /* 断网事件后立刻补检：旧检查结果必须被丢弃 */
  listeners[0]({ isConnected: false, networkType: 'none' })
  assert.equal(networkStore.offline, true)
  networkStore.lastCheckAt = 0
  networkStore.refresh()
  const stale = pendingChecks.shift()
  listeners[0]({ isConnected: true, networkType: 'wifi' })
  stale.success({ networkType: 'none' })
  assert.equal(networkStore.online, true, '旧 getNetworkType 结果不得覆盖新事件')
})
