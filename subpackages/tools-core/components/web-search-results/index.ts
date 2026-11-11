/* 元宝搜索结果区：结果卡 + 详情抽屉；图片/图标仅复制地址，避免任意域名下载限制 */
import { copyText } from '../../lib/ui'

interface ResultPicture {
  caption: string
  originUrl: string
}

interface ResultDeeplink {
  title: string
  url: string
}

interface ResultView {
  index: number
  title: string
  site: string
  date: string
  passage: string
  content: string
  url: string
  meta: string
  scoreText: string
  authorityText: string
  favicon: string
  pics: ResultPicture[]
  deeplinks: ResultDeeplink[]
}

Component({
  options: {
    styleIsolation: 'isolated',
  },

  properties: {
    results: {
      type: Array,
      value: [] as ResultView[],
    },
    query: { type: String, value: '' },
    summary: { type: String, value: '' },
    versionLabel: { type: String, value: '' },
    versionHint: { type: String, value: '' },
    message: { type: String, value: '' },
    requestId: { type: String, value: '' },
  },

  data: {
    detailShow: false,
    detailTitle: '',
    detailMeta: '',
    detailPassage: '',
    detailContent: '',
    detailUrl: '',
    detailScore: '',
    detailAuthority: '',
    detailFavicon: '',
    detailPics: [] as ResultPicture[],
    detailDeeplinks: [] as ResultDeeplink[],
  },

  methods: {
    onCopy(event: WechatMiniprogram.TouchEvent) {
      const value = String(event.currentTarget.dataset.value || '')
      if (!value) {
        return
      }
      void copyText(value, '已复制')
    },

    onCopySummary() {
      const summary = String(this.data.summary || '')
      if (!summary) {
        return
      }
      void copyText(summary, '搜索摘要已复制')
    },

    onOpenDetail(event: WechatMiniprogram.TouchEvent) {
      const index = Number(event.currentTarget.dataset.index)
      const result = (this.data.results as ResultView[])[index]
      if (!result) {
        return
      }
      this.setData({
        detailShow: true,
        detailTitle: result.title,
        detailMeta: result.meta,
        detailPassage: result.passage,
        detailContent: result.content,
        detailUrl: result.url,
        detailScore: result.scoreText,
        detailAuthority: result.authorityText,
        detailFavicon: result.favicon,
        detailPics: result.pics,
        detailDeeplinks: result.deeplinks,
      })
    },

    onDetailClose() {
      this.setData({ detailShow: false })
    },
  },
})
