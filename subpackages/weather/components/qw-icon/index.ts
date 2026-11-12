/* ==========================================================================
   qw-icon · 和风天气官方 SVG 图标
   - 文件名与 API icon 字段一致；破图自动回退 9999
   - 支持线框 / 填充 / 夜间 / 预警 / 月相
   ========================================================================== */

import {
  fallbackIconPath,
  iconPath,
  moonIconPath,
  warningIconPath,
} from '../../lib/qweather/icons'

Component({
  options: {
    virtualHost: true,
    styleIsolation: 'isolated',
  },

  properties: {
    code: { type: String, value: '9999' },
    size: { type: Number, value: 48 },
    fill: { type: Boolean, value: false },
    night: { type: Boolean, value: false },
    warning: { type: Boolean, value: false },
    moon: { type: Boolean, value: false },
    alt: { type: String, value: '天气图标' },
  },

  data: {
    src: '',
    failed: false,
    retried: false,
  },

  observers: {
    'code, fill, night, warning, moon'() {
      this.refresh()
    },
  },

  lifetimes: {
    attached() {
      this.refresh()
    },
  },

  methods: {
    refresh(): void {
      const code = String(this.data.code || '9999')
      let src = ''
      if (this.data.warning) {
        src = warningIconPath(code)
      } else if (this.data.moon) {
        src = moonIconPath(code)
      } else {
        src = iconPath(code, { fill: this.data.fill, night: this.data.night })
      }
      this.setData({ src, failed: false, retried: false })
    },

    onError(): void {
      if (this.data.failed) {
        return
      }
      /* 官方图标并非全部提供 -fill 变体：先退回线框版，再退回 9999 */
      if (this.data.fill && !this.data.retried) {
        const code = String(this.data.code || '9999')
        this.setData({
          retried: true,
          src: iconPath(code, { fill: false, night: this.data.night }),
        })
        return
      }
      this.setData({
        failed: true,
        src: fallbackIconPath(false),
      })
    },
  },
})
