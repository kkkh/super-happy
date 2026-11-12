/* ==========================================================================
   check-budget · 上传口径包体门禁
   - 排除 node_modules / package.json / package-lock.json / .DS_Store
   - 主包正确遍历真实页面目录（pages/index/index → pages/index）
   - 单页预算只校验 manifest 中的新增页，避免误伤既有大页面
   ========================================================================== */
const fs = require('node:fs')
const path = require('node:path')

const ROOT = path.resolve(__dirname, '..')
const APP = JSON.parse(fs.readFileSync(path.join(ROOT, 'app.json'), 'utf8'))

/** 批 1 起每新增一页，把页面目录相对路径加入此清单 */
const NEW_PAGES = [
  'subpackages/tools-core/pages/radix',
  'subpackages/tools-core/pages/date-format',
  'subpackages/tools-core/pages/date-add',
  'subpackages/tools-core/pages/color',
  'subpackages/tools-core/pages/json-csv',
  'subpackages/tools-core/pages/timezone',
  'subpackages/tools-core/pages/schedule',
  'subpackages/tools-core/pages/text-convert',
  'subpackages/tools-core/pages/template',
  'subpackages/tools-core/pages/regex',
  'subpackages/tools-media/pages/photo-edit',
  'subpackages/tools-media/pages/vcard',
  'subpackages/tools-daily/pages/ledger',
  'subpackages/tools-daily/pages/worktime',
  'subpackages/tools-daily/pages/wellness',
  'subpackages/tools-daily/pages/random-pick',
  'subpackages/tools-daily/pages/fuel',
  'subpackages/tools-daily/pages/power',
  'subpackages/tools-daily/pages/resolution',
  'subpackages/tools-daily/pages/carloan',
  'subpackages/tools-daily/pages/quote',
  'subpackages/tools-daily/pages/meeting-timer',
  'subpackages/tools-daily/pages/bodyfat',
  'subpackages/tools-daily/pages/fx-manual',
  'subpackages/tools-daily/pages/salary-inverse',
  'subpackages/tools-daily/pages/percent',
  'subpackages/tools-daily/pages/size-convert',
  'subpackages/tools-daily/pages/severance',
  'subpackages/tools-daily/pages/id-validate',
  'subpackages/tools-media/pages/avatar',
  'subpackages/tools-media/pages/collage',
  'subpackages/tools-media/pages/id-photo',
  'subpackages/tools-media/pages/image-pdf',
  'subpackages/tools-media/pages/barcode',
  'subpackages/tools-media/pages/exif',
  'subpackages/tools-media/pages/qr-decode',
  'subpackages/tools-dict/pages/lunar',
  'subpackages/tools-dict/pages/zh-convert',
  'subpackages/tools-dict/pages/pinyin',
  'subpackages/grow/pages/help',
  'subpackages/tools-core/pages/web-search',
  'subpackages/weather/pages/home',
]

for (const page of NEW_PAGES) {
  if (!fs.existsSync(path.join(ROOT, page))) {
    console.error(`✖ 新增页目录不存在：${page}`)
    process.exit(1)
  }
}

const LIMITS = {
  main: 1900,
  'subpackages/tools-core': 1600,
  'subpackages/tools-media': 800,
  'subpackages/grow': 1500,
  'subpackages/tools-daily': 600,
  'subpackages/tools-dict': 1536,
  'subpackages/weather': 1400,
  defaultSubpackage: 2048,
  page: 24,
}

function walk(dir, out = []) {
  if (!fs.existsSync(dir)) {
    return out
  }
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === '.DS_Store' || entry.name === 'node_modules') {
      continue
    }
    if (entry.name === 'package.json' || entry.name === 'package-lock.json') {
      continue
    }
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      walk(full, out)
    } else {
      out.push(full)
    }
  }
  return out
}

function bytesOf(files) {
  let total = 0
  for (const file of files) {
    try {
      total += fs.statSync(file).size
    } catch {
      /* 并发删除忽略 */
    }
  }
  return total / 1024
}

function pageFolder(route) {
  return path.join(ROOT, path.dirname(route))
}

function mainFiles() {
  return [
    'app.ts',
    'app.json',
    'app.wxss',
    'theme.json',
    'sitemap.json',
  ]
    .map((file) => path.join(ROOT, file))
    .concat(
      ['components', 'core', 'store', 'styles', 'assets', 'workers', 'custom-tab-bar', 'miniprogram_npm']
        .flatMap((dir) => walk(path.join(ROOT, dir))),
    )
    .concat(APP.pages.flatMap((page) => walk(pageFolder(page))))
}

function checkBudgets() {
  const failures = []
  const mainKb = bytesOf(mainFiles())
  if (mainKb > LIMITS.main) {
    failures.push(`主包 ${mainKb.toFixed(0)} KB 超过 ${LIMITS.main} KB`)
  }

  const packages = {}
  for (const subpackage of APP.subpackages) {
    const kb = bytesOf(walk(path.join(ROOT, subpackage.root)))
    packages[subpackage.root] = kb
    const limit = LIMITS[subpackage.root] ?? LIMITS.defaultSubpackage
    if (kb > limit) {
      failures.push(`${subpackage.root} ${kb.toFixed(0)} KB 超过 ${limit} KB`)
    }
  }

  const pages = {}
  for (const page of NEW_PAGES) {
    const kb = bytesOf(walk(path.join(ROOT, page)))
    pages[page] = kb
    if (kb > LIMITS.page) {
      failures.push(`页面 ${page} ${kb.toFixed(1)} KB 超过 ${LIMITS.page} KB`)
    }
  }

  return { ok: failures.length === 0, mainKb, packages, pages, failures }
}

if (require.main === module) {
  const result = checkBudgets()
  console.log(`主包：${result.mainKb.toFixed(1)} KB / ${LIMITS.main} KB`)
  for (const [root, kb] of Object.entries(result.packages)) {
    console.log(`${root}：${kb.toFixed(1)} KB`)
  }
  if (!result.ok) {
    for (const failure of result.failures) {
      console.error(`✖ ${failure}`)
    }
    process.exitCode = 1
  } else {
    console.log('✔ 包体预算通过')
  }
}

module.exports = { checkBudgets, LIMITS, NEW_PAGES }
