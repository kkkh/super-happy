/* ==========================================================================
   check-version · 版本四源一致性门禁
   - package.json / package-lock.json 根版本
   - core/constants/index.ts 的 APP_VERSION
   - 设置页 CHANGELOG 最新条目的 version
   任一不一致直接退出 1，供 CI 阶段一调用。
   ========================================================================== */
const fs = require('node:fs')
const path = require('node:path')

const ROOT = path.resolve(__dirname, '..')

function normalize(raw) {
  return String(raw || '').trim().replace(/^v/i, '')
}

function readPackageVersions() {
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'))
  const lock = JSON.parse(fs.readFileSync(path.join(ROOT, 'package-lock.json'), 'utf8'))
  return {
    package: normalize(pkg.version),
    lockRoot: normalize(lock.version),
    lockPackage: normalize(lock.packages && lock.packages[''] ? lock.packages[''].version : ''),
  }
}

function readAppVersion() {
  const source = fs.readFileSync(path.join(ROOT, 'core/constants/index.ts'), 'utf8')
  const match = source.match(/APP_VERSION\s*=\s*'([^']+)'/)
  return match ? normalize(match[1]) : ''
}

function readChangelogVersion() {
  const source = fs.readFileSync(
    path.join(ROOT, 'subpackages/grow/pages/settings/index.ts'),
    'utf8',
  )
  const start = source.indexOf('const CHANGELOG')
  if (start < 0) {
    return ''
  }
  const block = source.slice(start)
  const match = block.match(/version:\s*'([^']+)'/)
  return match ? normalize(match[1]) : ''
}

function main() {
  const pkg = readPackageVersions()
  const app = readAppVersion()
  const changelog = readChangelogVersion()
  const entries = [
    ['package.json', pkg.package],
    ['package-lock.json version', pkg.lockRoot],
    ['package-lock.json packages[""]', pkg.lockPackage],
    ['core/constants APP_VERSION', app],
    ['settings CHANGELOG[0]', changelog],
  ]

  const missing = entries.filter(([, value]) => !value)
  if (missing.length > 0) {
    for (const [name] of missing) {
      console.error(`✖ 无法读取版本：${name}`)
    }
    process.exit(1)
  }

  const versions = new Set(entries.map(([, value]) => value))
  if (versions.size === 1) {
    console.log(`✔ 版本四源一致：${app}`)
    return
  }

  console.error('✖ 版本不一致：')
  for (const [name, value] of entries) {
    console.error(`  ${name}: ${value}`)
  }
  console.error('请同步 package.json、package-lock.json、APP_VERSION 与设置页 CHANGELOG 最新条目。')
  process.exit(1)
}

main()
