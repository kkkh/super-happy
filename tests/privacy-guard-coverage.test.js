/* ==========================================================================
   隐私授权覆盖 · 页面契约
   - 直接调用剪贴板 / 相册 / 图片选择 / 方向传感器 / 模糊定位的页面
     必须挂载 privacy-guard，或使用内置 privacy-guard 的 glass-tool-shell
   - 直接挂载 privacy-guard 的页面必须在 usingComponents 中注册
   - app.ts 注册了全局 onNeedPrivacyAuthorization，缺弹窗会导致接口静默失败
   ========================================================================== */
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const ROOT = path.resolve(__dirname, '..')
const PRIVACY_API =
  /(copyText\(|ensurePrivacyAuthorized|wx\.setClipboardData|wx\.getClipboardData|wx\.saveImageToPhotosAlbum|wx\.chooseMedia|wx\.startDeviceMotionListening|wx\.getFuzzyLocation)/

const app = JSON.parse(fs.readFileSync(path.join(ROOT, 'app.json'), 'utf8'))
const pages = [
  ...app.pages,
  ...app.subpackages.flatMap((item) => item.pages.map((page) => `${item.root}/${page}`)),
]

function read(relative) {
  return fs.readFileSync(path.join(ROOT, relative), 'utf8')
}

test('调用隐私接口的页面都有授权弹窗', () => {
  const missing = []
  for (const page of pages) {
    const ts = path.join(ROOT, `${page}.ts`)
    if (!fs.existsSync(ts)) {
      continue
    }
    if (!PRIVACY_API.test(fs.readFileSync(ts, 'utf8'))) {
      continue
    }
    const wxml = read(`${page}.wxml`)
    const covered = wxml.includes('<privacy-guard') || wxml.includes('<glass-tool-shell')
    if (!covered) {
      missing.push(page)
    }
  }
  assert.deepEqual(missing, [])
})

test('直接挂载 privacy-guard 的页面已注册组件', () => {
  const missing = []
  for (const page of pages) {
    const wxmlPath = path.join(ROOT, `${page}.wxml`)
    if (!fs.existsSync(wxmlPath) || !fs.readFileSync(wxmlPath, 'utf8').includes('<privacy-guard')) {
      continue
    }
    const config = JSON.parse(read(`${page}.json`))
    if (!config.usingComponents || !config.usingComponents['privacy-guard']) {
      missing.push(page)
    }
  }
  assert.deepEqual(missing, [])
})

test('glass-tool-shell 自身挂载并注册 privacy-guard', () => {
  const wxml = read('components/glass-tool-shell/index.wxml')
  assert.ok(wxml.includes('<privacy-guard'))
  const config = JSON.parse(read('components/glass-tool-shell/index.json'))
  assert.ok(config.usingComponents['privacy-guard'])
})
