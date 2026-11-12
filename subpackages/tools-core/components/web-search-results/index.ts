/* 元宝搜索结果区：结果卡 + 详情抽屉；图片/图标仅复制地址，避免任意域名下载限制 */
import {
  canShareFile,
  cleanupExport,
  prepareExport,
  sharePrepared,
} from '../../../../core/services/export'
import { copyText, toast } from '../../lib/ui'
import { toArticleExport } from '../../lib/web-search-view'

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

interface ResultRuntime {
  /** 详情切换序号：准备完成的旧文章不覆盖新详情 */
  articleSeq: number
  /** 已预写的单篇文章路径，tap 时只做同步分享 */
  articlePath: string
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
    canShareArticle: false,
    articleReady: false,
    articleError: false,
  },

  lifetimes: {
    detached() {
      const runtime = this as unknown as ResultRuntime
      runtime.articleSeq = (runtime.articleSeq || 0) + 1
      cleanupExport(runtime.articlePath || '')
      runtime.articlePath = ''
    },
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
      const runtime = this as unknown as ResultRuntime
      runtime.articleSeq = (runtime.articleSeq || 0) + 1
      const seq = runtime.articleSeq
      cleanupExport(runtime.articlePath || '')
      runtime.articlePath = ''
      const shareable = canShareFile()
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
        canShareArticle: shareable,
        articleReady: false,
        articleError: false,
      })
      if (!shareable) {
        return
      }

      /* 分享必须由 tap 同步触发，因此在详情打开时预写文章 txt */
      const article = toArticleExport(result)
      prepareExport({ filename: article.filename, content: article.content, format: 'txt' }).then(
        (prepared) => {
          if (seq !== runtime.articleSeq) {
            return
          }
          if (prepared.ok) {
            runtime.articlePath = prepared.path
            this.setData({ articleReady: true })
            return
          }
          this.setData({ articleError: true })
        },
      )
    },

    onExportArticle() {
      const runtime = this as unknown as ResultRuntime
      if (!runtime.articlePath) {
        toast('文章正在准备，请稍后再试')
        return
      }
      void sharePrepared(runtime.articlePath).then((outcome) => {
        if (outcome === 'unsupported') {
          toast('当前版本不支持文件导出')
        } else if (outcome === 'failed') {
          toast('导出失败，可复制原文链接')
        }
      })
    },

    onDetailClose() {
      this.setData({ detailShow: false })
    },
  },
})
