/* ==========================================================================
   check-plan · 方案自检
   - 校验章节编号连续、能力矩阵 81 项、卡片 63 张
   - 校验 §4 路由与 §3.11 分包分配一致
   - 校验 §30 批 1 / 批 2 / 批 3 / M5 施工清单完整
   - 校验 §3.11 的 M5 分包分配
   - 校验 §23.5 的 39 卡原型归类不重不漏
   - 校验 §31.3 silent 执行器、§31.4 注入契约、§30.6 字标、§5.3.7 M5 元数据覆盖
   - 纯文本解析，不依赖第三方
   ========================================================================== */
const fs = require('node:fs')
const path = require('node:path')

const ROOT = path.resolve(__dirname, '..')
const PLAN = path.join(ROOT, '工具矩阵扩展与体验补全方案.md')

/* 方案契约常量：新增 / 删除能力或卡片时，必须同步修改这里与 §20 矩阵 */
const EXPECT = {
  capabilities: 81,
  cards: 63,
  categories: [
    { title: '计算换算', rows: 18 },
    { title: '日期时间', rows: 13 },
    { title: '文本效率', rows: 18 },
    { title: '图片处理', rows: 16 },
    { title: '生活健康', rows: 10 },
    { title: '职场辅助', rows: 6 },
  ],
  /* 批 1 交付清单：完成一项后，§14 标记“完成”即可豁免 §30 检查 */
  batch1: [
    'radix',
    'ledger',
    'date-format',
    'text-convert',
    'regex',
    'photo-edit',
    'worktime',
    'wellness',
    'random-pick',
    'vcard',
  ],
  /* 批 2 / 批 3 / M5：必须在 §30 有施工行，防止“只有规格、没有落地清单” */
  batch2: [
    'timezone',
    'lunar',
    'schedule',
    'carloan',
    'fuel',
    'power',
    'resolution',
    'avatar',
    'collage',
    'qr-decode',
    'quote',
    'meeting-timer',
    'bodyfat',
    'template',
  ],
  batch3: ['fx-manual', 'zh-convert', 'pinyin', 'id-photo', 'salary-inverse'],
  m5: [
    'percent',
    'date-add',
    'color',
    'size-convert',
    'severance',
    'json-csv',
    'id-validate',
    'image-pdf',
    'barcode',
    'exif',
  ],
  m5Allocation: {
    'tools-core': ['date-add', 'color', 'json-csv'],
    'tools-daily': ['percent', 'size-convert', 'severance', 'id-validate'],
    'tools-media': ['image-pdf', 'barcode', 'exif'],
  },
  batch2Allocation: {
    'tools-core': ['timezone', 'schedule', 'template'],
    'tools-daily': ['carloan', 'fuel', 'power', 'resolution', 'quote', 'meeting-timer', 'bodyfat'],
    'tools-media': ['avatar', 'collage', 'qr-decode'],
    'tools-dict': ['lunar'],
  },
  batch3Allocation: {
    'tools-daily': ['fx-manual', 'salary-inverse'],
    'tools-dict': ['zh-convert', 'pinyin'],
    'tools-media': ['id-photo'],
  },
  /* 面板内 silent 执行器：§31.3 必须逐个写明 */
  silentNew: [
    'radix',
    'date-format',
    'text-convert',
    'random-pick',
    'resolution',
    'template',
    'percent',
    'date-add',
    'color',
    'json-csv',
  ],
  /* 纯产出卡：accepts 为空数组，§31.4 不得写成 jump 注入 */
  noInject: [
    'worktime',
    'wellness',
    'vcard',
    'meeting-timer',
    'bodyfat',
    'size-convert',
    'severance',
  ],
}

function readPlan() {
  return fs.readFileSync(PLAN, 'utf8')
}

function sectionNumbers(markdown) {
  return [...markdown.matchAll(/^## (\d+)\./gm)].map((match) => Number(match[1]))
}

function tableRows(section) {
  return section.split('\n').filter((line) => {
    if (!/^\|/.test(line)) {
      return false
    }
    const first = line.split('|')[1].trim()
    return first !== '#' && first !== '能力' && first !== '' && !/^-+$/.test(first)
  })
}

/** §30 施工行：必须是以 `| \`id\` |` 开头的表格行，不能只是正文提及 */
function hasConstructionRow(section, id) {
  const escaped = id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return new RegExp(`^\\|\\s*\`${escaped}\`\\s*\\|`, 'm').test(section)
}

/** §14 完成行：首列必须精确匹配，且状态列必须整格为“完成” */
function isBatch1Done(section, id) {
  const escaped = id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const line = section
    .split('\n')
    .find((row) => new RegExp(`^\\|\\s*M1 批 1 · ${escaped}\\s*\\|`).test(row))
  if (!line) {
    return false
  }
  return line.split('|')[2]?.trim() === '完成'
}

function section20Blocks(markdown) {
  const blocks = markdown.split(/^### 20\.\d /m).slice(1)
  return blocks.map((block) => ({
    title: block.split('\n')[0],
    rows: tableRows(block.split(/^## 21\./m)[0]),
  }))
}

function allocationMap(markdown) {
  const section = markdown.split('### 3.11 分包容量分配')[1]
  const chunk = section.split('### 3.12')[0]
  const map = {}
  for (const line of chunk.split('\n')) {
    if (!/^\|\s*tools-/.test(line)) {
      continue
    }
    const cells = line.split('|').map((cell) => cell.trim())
    const pkg = cells[1]
    if (!pkg || pkg === '---') {
      continue
    }
    const ids = new Set()
    for (const cell of cells.slice(2)) {
      for (const token of cell.split(/[、,，/\s]+/)) {
        const id = token.replace(/`/g, '').trim()
        if (/^[a-z][a-z0-9-]*$/.test(id)) {
          ids.add(id)
        }
      }
    }
    map[pkg] = ids
  }
  return map
}

function routeEntries(markdown) {
  const section = markdown.split('## 4. ')[1].split('## 5. ')[0]
  const entries = []
  for (const match of section.matchAll(
    /路由 `\/subpackages\/([a-z-]+)\/pages\/([a-z0-9-]+)\/index`/g,
  )) {
    entries.push({ pkg: match[1], id: match[2] })
  }
  return entries
}

function headingLabels(markdown) {
  const labels = new Set()
  for (const line of markdown.split('\n')) {
    const match = /^#{2,4} (\d+(?:\.\d+)*)[. ]/.exec(line)
    if (match) {
      labels.add(match[1])
    }
  }
  return labels
}

/** 所有 §x.y 引用必须指向真实标题；§7 这种整章引用允许 */
function referenceFailures(markdown) {
  const labels = headingLabels(markdown)
  const failures = []
  const seen = new Set()
  for (const match of markdown.matchAll(/§(\d+(?:\.\d+)*)/g)) {
    const ref = match[1]
    if (seen.has(ref)) {
      continue
    }
    seen.add(ref)
    if (!labels.has(ref)) {
      failures.push(`失效引用：§${ref}`)
    }
  }
  return failures
}

function checkPlan(markdown = readPlan()) {
  const failures = []

  /* 1. 章节编号连续 */
  const numbers = sectionNumbers(markdown)
  if (numbers.length < 40) {
    failures.push(`章节数不足：${numbers.length}`)
  }
  for (let index = 0; index < numbers.length; index += 1) {
    if (numbers[index] !== index) {
      failures.push(`章节编号不连续：第 ${index} 个是 ${numbers[index]}`)
      break
    }
  }

  /* 2. 能力矩阵 81 项 */
  const blocks = section20Blocks(markdown)
  if (blocks.length !== EXPECT.categories.length) {
    failures.push(`矩阵分类数应为 ${EXPECT.categories.length}，实际 ${blocks.length}`)
  }
  let total = 0
  blocks.forEach((block, index) => {
    total += block.rows.length
    const expect = EXPECT.categories[index]
    if (expect && block.rows.length !== expect.rows) {
      failures.push(`${block.title} 行数 ${block.rows.length}，应为 ${expect.rows}`)
    }
  })
  if (total !== EXPECT.capabilities) {
    failures.push(`能力总数 ${total}，应为 ${EXPECT.capabilities}`)
  }

  /* 3. 卡片 63 张：现有 24 + 批 1 10 + 批 2 14 + 批 3 5 + M5 新增 10 */
  const batch1 = (markdown.match(/^### 4\.(?:[1-9]|10) /gm) || []).length
  const batch2 = (markdown.match(/^#### 5\.1\.\d+ /gm) || []).length
  const batch3 = (markdown.match(/^#### 5\.2\.\d+ /gm) || []).length
  const m5Section = markdown.split('#### 5.3.1 新增 10 张卡')[1].split('#### 5.3.2')[0]
  const m5New = tableRows(m5Section).length
  const cards = 24 + batch1 + batch2 + batch3 + m5New
  if (batch1 !== 10) {
    failures.push(`批 1 卡数 ${batch1}，应为 10`)
  }
  if (batch2 !== 14) {
    failures.push(`批 2 卡数 ${batch2}，应为 14`)
  }
  if (batch3 !== 5) {
    failures.push(`批 3 卡数 ${batch3}，应为 5`)
  }
  if (m5New !== 10) {
    failures.push(`M5 新卡 ${m5New}，应为 10`)
  }
  if (cards !== EXPECT.cards) {
    failures.push(`卡片总数 ${cards}，应为 ${EXPECT.cards}`)
  }

  /* 4. §4 路由必须落在 §3.11 对应分包 */
  const allocation = allocationMap(markdown)
  const routes = routeEntries(markdown)
  if (routes.length !== 10) {
    failures.push(`§4 路由数 ${routes.length}，应为 10`)
  }
  for (const route of routes) {
    const ids = allocation[route.pkg]
    if (!ids || !ids.has(route.id)) {
      failures.push(`路由 ${route.id} 不在 §3.11 的 ${route.pkg} 分配中`)
    }
  }

  /* 5. 批 1 卡：§30.1–§30.5 有施工行，或 §14 已标记完成 */
  const section30 = markdown.split('## 30. ')[1].split('### 30.6 ')[0]
  const section14 = markdown.split('## 14. ')[1].split('## 15. ')[0]
  for (const id of EXPECT.batch1) {
    const done = isBatch1Done(section14, id)
    if (!done && !hasConstructionRow(section30, id)) {
      failures.push(`§30 施工清单缺少 ${id}，且 §14 未标记完成`)
    }
  }

  /* 6. 批 2 / 批 3 / M5 必须在 §30 有施工行 */
  for (const id of [...EXPECT.batch2, ...EXPECT.batch3, ...EXPECT.m5]) {
    if (!hasConstructionRow(section30, id)) {
      failures.push(`§30 施工清单缺少 ${id}`)
    }
  }

  /* 7. M5 / 批 2 / 批 3 新卡必须落在 §3.11 声明的分包 */
  for (const expected of [
    EXPECT.m5Allocation,
    EXPECT.batch2Allocation,
    EXPECT.batch3Allocation,
  ]) {
    for (const [pkg, ids] of Object.entries(expected)) {
      const allocated = allocation[pkg] ?? new Set()
      for (const id of ids) {
        if (!allocated.has(id)) {
          failures.push(`卡片 ${id} 未分配到 ${pkg}`)
        }
      }
    }
  }

  /* 7.1 批 2 / 批 3 / M5 的每张卡都必须出现在 §3.11 分包分配表 */
  const allocatedIds = new Set()
  const allocationOwner = new Map()
  for (const [pkg, ids] of Object.entries(allocation)) {
    for (const id of ids) {
      allocatedIds.add(id)
      if (allocationOwner.has(id) && allocationOwner.get(id) !== pkg) {
        failures.push(`§3.11 卡 ${id} 同时分配给 ${allocationOwner.get(id)} 与 ${pkg}`)
      } else {
        allocationOwner.set(id, pkg)
      }
    }
  }
  for (const id of [...EXPECT.batch2, ...EXPECT.batch3, ...EXPECT.m5]) {
    if (!allocatedIds.has(id)) {
      failures.push(`§3.11 未分配卡片：${id}`)
    }
  }

  /* 8. 39 张新卡必须且只能归入 §23.5 四类原型之一 */
  const archetypeSection = markdown.split('### 23.5')[1].split(/\n---\s*\n/)[0]
  const archetypeCount = new Map()
  for (const row of tableRows(archetypeSection)) {
    const cell = row.split('|')[2] ?? ''
    for (const token of cell.split(/[、,，/\s]+/)) {
      const id = token.trim()
      if (/^[a-z][a-z0-9-]*$/.test(id)) {
        archetypeCount.set(id, (archetypeCount.get(id) ?? 0) + 1)
      }
    }
  }
  for (const id of [...EXPECT.batch1, ...EXPECT.batch2, ...EXPECT.batch3, ...EXPECT.m5]) {
    if (archetypeCount.get(id) !== 1) {
      failures.push(`§23.5 原型归类中 ${id} 出现 ${archetypeCount.get(id) ?? 0} 次，应为 1 次`)
    }
  }

  /* 9. silent 执行器清单必须覆盖全部 silent 新卡 */
  const silentSection = markdown.split('### 31.3')[1].split(/\n---\s*\n/)[0]
  for (const id of EXPECT.silentNew) {
    if (!silentSection.includes(`\`${id}\``)) {
      failures.push(`§31.3 silent 执行器缺少 ${id}`)
    }
  }

  /* 10. §30.6 字标与权重必须覆盖 29 张新卡 */
  const metadataSection = markdown.split('### 30.6')[1].split(/\n---\s*\n/)[0]
  const metadataCount = new Map()
  for (const row of tableRows(metadataSection)) {
    const cells = row.split('|')
    for (const cell of [cells[1] ?? '', cells[4] ?? '']) {
      const id = cell.replace(/`/g, '').trim()
      if (/^[a-z][a-z0-9-]*$/.test(id)) {
        metadataCount.set(id, (metadataCount.get(id) ?? 0) + 1)
      }
    }
  }
  for (const id of [...EXPECT.batch2, ...EXPECT.batch3, ...EXPECT.m5]) {
    if (metadataCount.get(id) !== 1) {
      failures.push(`§30.6 字标登记中 ${id} 出现 ${metadataCount.get(id) ?? 0} 次，应为 1 次`)
    }
  }

  /* 11. §5.3.7 必须覆盖 M5 十卡元数据 */
  const m5MetaSection = markdown.split('#### 5.3.7')[1].split(/\n---\s*\n/)[0]
  const m5MetaCount = new Map()
  for (const row of tableRows(m5MetaSection)) {
    const id = (row.split('|')[1] ?? '').replace(/`/g, '').trim()
    if (/^[a-z][a-z0-9-]*$/.test(id)) {
      m5MetaCount.set(id, (m5MetaCount.get(id) ?? 0) + 1)
    }
  }
  for (const id of EXPECT.m5) {
    if (m5MetaCount.get(id) !== 1) {
      failures.push(`§5.3.7 元数据中 ${id} 出现 ${m5MetaCount.get(id) ?? 0} 次，应为 1 次`)
    }
  }

  /* 12. legal 披露必须覆盖 M5 新增存储与导出目录 */
  const legalSection = markdown.split('### 16.4')[1].split(/\n---\s*\n/)[0]
  for (const token of [
    'tbx:draft.<id>',
    'tbx:recent',
    'app:backup.at',
    'app:prefs.v1',
    'app:privacy.version',
    'USER_DATA_PATH/backups/',
    'USER_DATA_PATH/exports/',
    'diag:errors.v1',
  ]) {
    if (!legalSection.includes(token)) {
      failures.push(`§16.4 legal 披露缺少 ${token}`)
    }
  }

  /* 13. 关键口径必须存在且不得出现旧说法 */
  for (const phrase of ['81 项能力', '63 张卡']) {
    if (!markdown.includes(phrase)) {
      failures.push(`缺少口径：${phrase}`)
    }
  }
  if (markdown.includes('61 张卡')) {
    failures.push('出现旧口径：61 张卡')
  }
  failures.push(...referenceFailures(markdown))

  /* 14. §31.4 不得把 silent / accepts: [] 卡写成 jump 注入 */
  const injectSection = markdown.split('### 31.4')[1].split(/\n---\s*\n/)[0]
  const noInject = new Set([...EXPECT.silentNew, ...EXPECT.noInject])
  for (const row of tableRows(injectSection)) {
    const cells = row.split('|').map((cell) => cell.trim())
    const method = cells[2] ?? ''
    if (!method.includes('onReceiveWorkflow') && !method.includes('适配器')) {
      continue
    }
    for (const id of cells[1].match(/[a-z][a-z0-9-]*/g) ?? []) {
      if (noInject.has(id)) {
        failures.push(`§31.4 把不可注入卡 ${id} 写成了 jump 注入`)
      }
    }
  }

  return { ok: failures.length === 0, failures, totals: { cards, capabilities: total } }
}

if (require.main === module) {
  const result = checkPlan()
  console.log(`能力 ${result.totals.capabilities} 项 / 卡片 ${result.totals.cards} 张`)
  if (!result.ok) {
    for (const failure of result.failures) {
      console.error(`✖ ${failure}`)
    }
    process.exitCode = 1
  } else {
    console.log('✔ 方案自检通过')
  }
}

module.exports = { checkPlan }
