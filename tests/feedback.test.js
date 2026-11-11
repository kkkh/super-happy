/* ==========================================================================
   feedback · copyText 隐私与剪贴板契约
   - 空内容 / 拒绝授权不写剪贴板
   - 授权通过才写入，并返回 boolean
   ========================================================================== */
const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')
const { registerHooks } = require('node:module')

const ROOT = path.resolve(__dirname, '..')

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier.startsWith('.') && !path.extname(specifier)) {
      return nextResolve(`${specifier}.ts`, context)
    }
    return nextResolve(specifier, context)
  },
})

async function loadFeedback() {
  return import(`${require('node:url').pathToFileURL(ROOT).href}/core/services/feedback.ts`)
}

function installWx({ authorized = true, clipboardOk = true } = {}) {
  const calls = { clipboard: [], hideToast: 0, vibrate: 0 }
  global.wx = {
    requirePrivacyAuthorize(options) {
      if (authorized) {
        options.success()
      } else {
        options.fail({ errMsg: 'privacy denied' })
      }
    },
    setClipboardData(options) {
      calls.clipboard.push(options.data)
      if (clipboardOk) {
        options.success()
      } else {
        options.fail()
      }
    },
    hideToast() {
      calls.hideToast += 1
    },
    vibrateShort() {
      calls.vibrate += 1
    },
  }
  return calls
}

test('copyText：空内容不触发剪贴板', async () => {
  const calls = installWx()
  const { copyText } = await loadFeedback()
  assert.equal(await copyText(''), false)
  assert.equal(calls.clipboard.length, 0)
})

test('copyText：拒绝隐私授权时不写剪贴板', async () => {
  const calls = installWx({ authorized: false })
  const { copyText } = await loadFeedback()
  assert.equal(await copyText('敏感结果'), false)
  assert.equal(calls.clipboard.length, 0)
})

test('copyText：授权通过后写入并返回 true', async () => {
  const calls = installWx()
  const { copyText } = await loadFeedback()
  assert.equal(await copyText('结果 A'), true)
  assert.deepEqual(calls.clipboard, ['结果 A'])
  assert.equal(calls.hideToast, 1)
  assert.equal(calls.vibrate, 1)
})

test('copyText：剪贴板写入失败返回 false', async () => {
  const calls = installWx({ clipboardOk: false })
  const { copyText } = await loadFeedback()
  assert.equal(await copyText('结果 B'), false)
  assert.deepEqual(calls.clipboard, ['结果 B'])
})
