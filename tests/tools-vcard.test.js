/* ==========================================================================
   批 1 · 二维码名片（vcard）
   - 引擎黄金值：转义、折行、字节预算、空字段、中文
   - 契约：页面 / 注册 / 帮助 / 纯产出工作流
   ========================================================================== */
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { registerHooks } = require('node:module')

const ROOT = path.resolve(__dirname, '..')
const URL_ROOT = `${require('node:url').pathToFileURL(ROOT).href}/`
const read = (file) => fs.readFileSync(path.join(ROOT, file), 'utf8')

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier.startsWith('.') && !path.extname(specifier)) {
      return nextResolve(`${specifier}.ts`, context)
    }
    return nextResolve(specifier, context)
  },
})

async function loadEngine() {
  return import(`${URL_ROOT}subpackages/tools-media/lib/vcard.ts`)
}

test('vCard：特殊字符转义', async () => {
  const vcard = await loadEngine()
  assert.equal(vcard.escapeVCard('A;B,C\nD\\E'), 'A\\;B\\,C\\nD\\\\E')
  const built = vcard.buildVCard({
    name: '张三;研发,一部',
    company: '超欢\\工作室',
    title: '',
    phone: '',
    email: '',
    address: '',
    website: '',
    note: '第一行\n第二行',
  })
  assert.equal(built.ok, true)
  assert.match(built.text, /FN:张三\\;研发\\,一部/)
  assert.match(built.text, /NOTE:第一行\\n第二行/)
})

test('vCard：每行 ≤75 字节且续行以空格开头', async () => {
  const vcard = await loadEngine()
  const folded = vcard.foldVCard(`NOTE:${'X'.repeat(200)}`)
  const lines = folded.split('\r\n')
  assert.ok(lines.length > 1)
  for (const line of lines) {
    assert.ok(vcard.utf8ByteLength(line) <= 75, `行超过 75 字节：${vcard.utf8ByteLength(line)}`)
  }
  for (const line of lines.slice(1)) {
    assert.equal(line.startsWith(' '), true)
  }
  assert.equal(folded.replace(/\r\n /g, ''), `NOTE:${'X'.repeat(200)}`)

  /* 中文按字符切分，不产生半个 UTF-8 字符 */
  const chinese = vcard.foldVCard(`NOTE:${'超'.repeat(80)}`)
  for (const line of chinese.split('\r\n')) {
    assert.ok(vcard.utf8ByteLength(line) <= 75)
    assert.equal(line.includes('\uFFFD'), false)
  }
})

test('vCard：整段 1000 字节预算', async () => {
  const vcard = await loadEngine()
  const tooLarge = vcard.buildVCard({
    name: '张三',
    company: '超'.repeat(200),
    title: '超'.repeat(200),
    phone: '',
    email: '',
    address: '超'.repeat(200),
    website: '',
    note: '超'.repeat(200),
  })
  assert.equal(tooLarge.ok, false)
  assert.equal(tooLarge.code, 'size')
  assert.ok(tooLarge.bytes > 1000)

  const ok = vcard.buildVCard({
    name: '张三',
    company: '超欢',
    title: '开发者',
    phone: '13800000000',
    email: 'a@b.com',
    address: '杭州市西湖区',
    website: 'https://example.com',
    note: '备注',
  })
  assert.equal(ok.ok, true)
  assert.ok(ok.bytes <= 1000)
})

test('vCard：空字段省略与空姓名拒绝', async () => {
  const vcard = await loadEngine()
  const minimal = vcard.buildVCard({
    name: '秦超',
    company: '',
    title: '',
    phone: '',
    email: '',
    address: '',
    website: '',
    note: '',
  })
  assert.equal(minimal.ok, true)
  assert.match(minimal.text, /^BEGIN:VCARD\r\nVERSION:3\.0\r\nN:秦超;;;;\r\nFN:秦超\r\nEND:VCARD\r\n$/)
  assert.equal(minimal.text.includes('ORG:'), false)
  assert.equal(minimal.text.includes('TEL'), false)

  const empty = vcard.buildVCard({
    name: '   ',
    company: '',
    title: '',
    phone: '',
    email: '',
    address: '',
    website: '',
    note: '',
  })
  assert.equal(empty.code, 'name')

  const longField = vcard.buildVCard({
    name: 'A',
    company: '公'.repeat(201),
    title: '',
    phone: '',
    email: '',
    address: '',
    website: '',
    note: '',
  })
  assert.equal(longField.code, 'field')
})

test('图片名片：字段行过滤与画布尺寸', async () => {
  const card = await import(`${URL_ROOT}subpackages/tools-media/lib/card.ts`)
  assert.equal(card.CARD_WIDTH, 1080)
  assert.equal(card.CARD_HEIGHT, 672)
  const rows = card.buildCardRows({
    name: '秦超',
    company: '超欢',
    title: '独立开发者',
    phone: '13800000000',
    email: '',
    address: '杭州市西湖区',
    website: 'https://example.com',
    note: '扫码保存联系人',
  })
  assert.deepEqual(
    rows.map((row) => row.label),
    ['TEL', 'WEB', 'ADDR'],
  )
  assert.deepEqual(
    rows.map((row) => row.value),
    ['13800000000', 'https://example.com', '杭州市西湖区'],
  )
  assert.equal(
    card.buildCardRows({
      name: '秦超',
      company: '',
      title: '',
      phone: '',
      email: '',
      address: '',
      website: '',
      note: '',
    }).length,
    0,
  )
})

test('vCard：中文名片与页面 / 工作流契约', async () => {
  const vcard = await loadEngine()
  const built = vcard.buildVCard({
    name: '秦超',
    company: '超欢',
    title: '独立开发者',
    phone: '13800000000',
    email: '56967916@qq.com',
    address: '杭州市西湖区',
    website: 'https://example.com',
    note: '扫码保存联系人',
  })
  assert.equal(built.ok, true)
  assert.match(built.text, /ORG:超欢/)
  assert.match(built.text, /ADR;TYPE=WORK:;;杭州市西湖区;;;;/)
  assert.ok(built.bytes <= 1000)

  const app = JSON.parse(read('app.json'))
  const media = app.subpackages.find((item) => item.root === 'subpackages/tools-media')
  assert.ok(media.pages.includes('pages/vcard/index'), 'app.json 未注册页面')

  for (const ext of ['.ts', '.json', '.wxml', '.wxss']) {
    assert.ok(
      fs.existsSync(path.join(ROOT, `subpackages/tools-media/pages/vcard/index${ext}`)),
      `缺少页面文件 ${ext}`,
    )
  }

  const wxml = read('subpackages/tools-media/pages/vcard/index.wxml')
  assert.match(wxml, /tool-id="vcard"/)
  assert.match(wxml, /bind:run="onRun"/)
  assert.match(wxml, /poster-data="\{\{posterData\}\}"/)
  assert.match(wxml, /id="vcard-canvas"/)
  assert.match(wxml, /bind:tap="onSaveCard"/)

  const ts = read('subpackages/tools-media/pages/vcard/index.ts')
  assert.match(ts, /onShareAppMessage\s*\(/)
  assert.match(ts, /onShareTimeline\s*\(/)
  assert.match(ts, /qrcode/)
  assert.match(ts, /writePngFile/)
  assert.match(ts, /drawVCardCard/)
  assert.match(ts, /exportCanvas/)
  assert.ok(
    fs.existsSync(path.join(ROOT, 'subpackages/tools-media/lib/card.ts')),
    '缺少图片名片渲染模块',
  )
  assert.equal(/onReceiveWorkflow/.test(ts), false, 'accepts: [] 不得声明注入接口')
  assert.equal(/wx\.request|uploadFile|downloadFile/.test(ts), false)

  const registry = read('core/toolbox/registry.ts')
  assert.match(registry, /id: 'vcard'/)
  assert.match(registry, /sensitive: 'personal'/)
  assert.match(registry, /weight: 66/)
  assert.match(registry, /privacyNote:/)
  assert.match(read('subpackages/grow/lib/help.ts'), /vcard: \{/)

  const config = await import(`${URL_ROOT}core/workflow/workflowConfig.ts`)
  assert.equal(config.WORKFLOW_ROUTING.vcard, 'jump')
  assert.deepEqual(config.WORKFLOW_ACCEPTS.vcard, [])

  const source = await import(`${URL_ROOT}core/workflow/workflowSource.ts`)
  assert.deepEqual(source.WORKFLOW_SOURCE_KEYS.vcard.text, ['vcardSummary'])
})
