/* ==========================================================================
   二维码生成 · 纯 JS 编码 + 1-bit PNG
   - 不使用 Canvas：开发者工具与真机一致可用
   - PNG 写入用户目录后以 image 展示，保存使用同一文件
   ========================================================================== */
import qrcodeFactory from '../../lib/qrcode'
import { qrPngBase64, writePngFile } from '../../lib/png'
import { toast } from '../../lib/ui'
import { tapTick } from '../../../../core/utils/haptics'
import { saveImageToAlbum } from '../../lib/image'
import {
  sharePayloadForCurrentPage,
  timelinePayloadForCurrentPage,
} from '../../../../core/toolbox/share'
import type { IPosterData } from '../../../../core/toolbox/poster'

type ErrorLevel = 'L' | 'M' | 'Q' | 'H'

interface QrCode {
  addData(data: string): void
  make(maskPattern?: number): void
  getModuleCount(): number
  isDark(row: number, col: number): boolean
}

interface QrFactory {
  (typeNumber: number, level: string): QrCode
  stringToBytes: (text: string) => number[]
  stringToBytesFuncs: Record<string, (text: string) => number[]>
}

const qrcodeLib = qrcodeFactory as unknown as QrFactory
/* 库默认按 Latin-1 编码；改为 UTF-8，中文与 Emoji 才能正确写入二维码 */
qrcodeLib.stringToBytes = qrcodeLib.stringToBytesFuncs['UTF-8']
const qrcode = qrcodeLib

const LEVELS: { key: ErrorLevel; label: string; hint: string }[] = [
  { key: 'L', label: 'L', hint: '7%' },
  { key: 'M', label: 'M', hint: '15%' },
  { key: 'Q', label: 'Q', hint: '25%' },
  { key: 'H', label: 'H', hint: '30%' },
]

const SIZES = [
  { key: '240', label: '小', value: 240 },
  { key: '280', label: '中', value: 280 },
  { key: '320', label: '大', value: 320 },
]

const MAX_CONTENT = 500
/** 生成序号：输入变化后丢弃旧二维码写入结果，避免异步回填覆盖新输入 */
let qrRenderSeq = 0

interface QrState {
  destroyed: boolean
}

/** 静默删除上一张二维码临时图，避免用户目录堆积 */
function unlinkQuietly(filePath: string): void {
  if (!filePath) {
    return
  }
  try {
    wx.getFileSystemManager().unlink({ filePath, fail: () => undefined })
  } catch {
    // 文件系统不可用时忽略清理
  }
}

Page({
  /* 此处是处理工具页分享与深链参数校验的边界 */
  onShareAppMessage() {
    return sharePayloadForCurrentPage()
  },

  onShareTimeline() {
    return timelinePayloadForCurrentPage()
  },

  data: {
    toolName: '二维码生成',
    kicker: '图片处理',
    desc: '文本 / 链接转二维码',
    content: '',
    counterText: `0 / ${MAX_CONTENT}`,
    level: 'M' as ErrorLevel,
    levels: LEVELS,
    sizeKey: '280',
    sizes: SIZES,
    canvasCss: 280,
    shellState: 'idle',
    hasResult: false,
    error: '',
    qrImagePath: '',
    moduleText: '',
    versionText: '',
    levelText: '',
    sizeText: '',
    contentText: '',
    moduleCount: 0,
    contentLength: 0,
    saving: false,
    posterData: null as IPosterData | null,
  },

  onLoad() {
    const state = this as unknown as QrState
    state.destroyed = false
  },

  onUnload() {
    const state = this as unknown as QrState
    state.destroyed = true
    /* 让在途生成任务失效，并清理当前二维码临时图；保存中的文件留给 finally 收尾 */
    qrRenderSeq += 1
    if (!this.data.saving) {
      unlinkQuietly(this.data.qrImagePath)
    }
  },

  onInput(event: WechatMiniprogram.TextareaInput) {
    const content = event.detail.value
    qrRenderSeq += 1
    if (!this.data.saving) {
      unlinkQuietly(this.data.qrImagePath)
    }
    this.setData({
      content,
      counterText: `${Array.from(content).length} / ${MAX_CONTENT}`,
      hasResult: false,
      qrImagePath: '',
      error: '',
      shellState: 'idle',
    })
  },

  onLevel(event: WechatMiniprogram.TouchEvent) {
    const level = event.currentTarget.dataset.level as ErrorLevel
    if (!LEVELS.some((item) => item.key === level) || level === this.data.level) {
      return
    }
    tapTick()
    qrRenderSeq += 1
    if (!this.data.saving) {
      unlinkQuietly(this.data.qrImagePath)
    }
    this.setData({ level, hasResult: false, qrImagePath: '', error: '', shellState: 'idle' })
  },

  onSize(event: WechatMiniprogram.TouchEvent) {
    if (this.data.shellState === 'running' || this.data.saving) {
      return
    }
    const key = event.currentTarget.dataset.key as string
    const size = SIZES.find((item) => item.key === key)
    if (!size || key === this.data.sizeKey) {
      return
    }
    tapTick()
    this.setData({ sizeKey: key, canvasCss: size.value }, () => {
      if (this.data.hasResult) {
        this.generate()
      }
    })
  },

  onExample() {
    tapTick()
    const content = 'https://example.com/超欢'
    this.setData(
      {
        content,
        counterText: `${Array.from(content).length} / ${MAX_CONTENT}`,
        level: 'M',
        sizeKey: '280',
        canvasCss: 280,
      },
      () => {
        this.generate()
      },
    )
  },

  onReset() {
    if (this.data.shellState === 'running') {
      toast('正在处理，请稍候')
      return
    }
    if (this.data.saving) {
      toast('正在保存，请稍候')
      return
    }
    qrRenderSeq += 1
    unlinkQuietly(this.data.qrImagePath)
    this.setData({
      content: '',
      counterText: `0 / ${MAX_CONTENT}`,
      level: 'M',
      sizeKey: '280',
      canvasCss: 280,
      shellState: 'idle',
      hasResult: false,
      error: '',
      qrImagePath: '',
      moduleText: '',
      versionText: '',
      levelText: '',
      sizeText: '',
      contentText: '',
      moduleCount: 0,
      contentLength: 0,
      saving: false,
    })
  },

  onRun() {
    this.generate()
  },

  onSave() {
    if (!this.data.qrImagePath || this.data.saving) {
      return
    }
    const state = this as unknown as QrState
    const target = this.data.qrImagePath
    this.setData({ saving: true })
    saveImageToAlbum(target)
      .then((ok) => {
        if (state.destroyed) {
          return
        }
        this.setData({ saving: false })
        if (ok) {
          toast('二维码已保存到相册')
        }
      })
      .catch(() => {
        if (state.destroyed) {
          return
        }
        this.setData({ saving: false })
        toast('保存失败，请重试')
      })
      .finally(() => {
        /* 页面已销毁，或保存期间内容被替换：清理旧文件 */
        if (state.destroyed || this.data.qrImagePath !== target) {
          unlinkQuietly(target)
        }
      })
  },

  /**
   * 二维码生成状态机（本项目最绕的一段）：
   * 1. 同步段先校验内容长度并算出矩阵，避免进入异步后才失败；
   * 2. 异步写 PNG 前分配 qrRenderSeq：后续输入、重置、退出都会递增序号；
   * 3. 回调只在 seq 仍是最新时才 setData，过期结果立刻 unlink，防止临时文件堆积；
   * 4. 成功替换时清理上一张 qrImagePath，失败/过期分支也清理 previous，保证任意时刻只有一张有效图。
   */
  generate() {
    if (this.data.shellState === 'running') {
      return
    }
    const seq = (qrRenderSeq += 1)
    const content = this.data.content.trim()
    if (!content) {
      this.setData({ shellState: 'invalid', error: '请输入需要生成二维码的文本或链接' })
      return
    }
    if (Array.from(content).length > MAX_CONTENT) {
      this.setData({ shellState: 'invalid', error: `内容超过 ${MAX_CONTENT} 字符，请精简后再试` })
      return
    }

    const state = this as unknown as QrState
    const previous = this.data.qrImagePath
    this.setData({ shellState: 'running', hasResult: false, error: '', qrImagePath: '' })

    const fail = (error: unknown) => {
      if (seq !== qrRenderSeq || state.destroyed) {
        return
      }
      const message = error instanceof Error ? error.message : String(error)
      unlinkQuietly(previous)
      this.setData({
        shellState: 'error',
        hasResult: false,
        qrImagePath: '',
        error: `生成失败：${message}。可缩短内容或降低纠错级别。`,
      })
    }

    /* 第一段：矩阵生成（约 14ms）；第二段：PNG 编码（约 9ms）。中间让出一帧，避免单次长任务超过 16ms */
    setTimeout(() => {
      if (seq !== qrRenderSeq || state.destroyed) {
        return
      }
      let count = 0
      let matrix: boolean[][] = []
      try {
        const code = qrcode(0, this.data.level)
        code.addData(content)
        /* 固定 mask 0 符合 ISO/IEC 18004，省去 8 次候选评估 */
        code.make(0)
        count = code.getModuleCount()
        if (count <= 0) {
          throw new Error('无法生成二维码矩阵')
        }
        for (let row = 0; row < count; row += 1) {
          const line: boolean[] = []
          for (let col = 0; col < count; col += 1) {
            line.push(code.isDark(row, col))
          }
          matrix.push(line)
        }
      } catch (error) {
        fail(error)
        return
      }
      if (seq !== qrRenderSeq || state.destroyed) {
        return
      }

      setTimeout(() => {
        if (seq !== qrRenderSeq || state.destroyed) {
          return
        }
        try {
          const scale = Math.max(4, Math.round(this.data.canvasCss / (count + 8)))
          const base64 = qrPngBase64(matrix, count, scale, 4)
          if (seq !== qrRenderSeq || state.destroyed) {
            return
          }
          writePngFile(base64, `tbx-qr-${Date.now()}.png`)
            .then((path) => {
              if (seq !== qrRenderSeq || state.destroyed) {
                unlinkQuietly(path)
                return
              }
              const version = Math.floor((count - 17) / 4)
              const moduleText = `${count} × ${count}`
              const levelText = `${this.data.level} · ${
                LEVELS.find((item) => item.key === this.data.level)?.hint ?? ''
              }`
              const sizeText = `${this.data.canvasCss} px`
              const contentChars = Array.from(content).length
              const poster: IPosterData = {
                toolName: '二维码生成',
                category: '图片处理',
                mainResult: `${contentChars}`,
                resultLabel: '内容字符数',
                params: [
                  { label: '纠错级别', value: levelText },
                  { label: '显示尺寸', value: sizeText },
                ],
                extras: [
                  `版本 ${version}`,
                  `矩阵 ${moduleText}`,
                  `内容预览 ${content.slice(0, 24)}${contentChars > 24 ? '…' : ''}`,
                ],
              }
              this.setData({
                shellState: 'done',
                hasResult: true,
                error: '',
                qrImagePath: path,
                moduleText,
                versionText: `版本 ${version}`,
                levelText,
                sizeText,
                contentText: `${contentChars} 字符`,
                moduleCount: count,
                contentLength: contentChars,
                posterData: poster,
              })
              if (previous && previous !== path) {
                unlinkQuietly(previous)
              }
            })
            .catch(fail)
        } catch (error) {
          fail(error)
        }
      }, 0) as unknown as number
    }, 0) as unknown as number
  },
})
