/* ==========================================================================
   图片转 PDF · 手写 PDF 1.4（无第三方库）
   - 只嵌入 JPEG（DCTDecode）；调用方负责把 PNG 白底转 JPEG
   - A4 595×842pt、Letter 612×792pt、原图按 72DPI；等比居中
   - 最多 9 页、文件上限 2MB；超限返回 null
   - 纯函数、无 wx / DOM，可在 Node 中单测
   ========================================================================== */

export const PDF_MAX_PAGES = 9
export const PDF_MAX_BYTES = 2 * 1024 * 1024

export type PdfPageSize = 'a4' | 'letter' | 'original'

export interface PdfJpegPage {
  data: Uint8Array
  width: number
  height: number
}

export interface JpegInfo {
  width: number
  height: number
  components: number
}

function ascii(text: string): Uint8Array {
  const bytes = new Uint8Array(text.length)
  for (let index = 0; index < text.length; index += 1) {
    bytes[index] = text.charCodeAt(index) & 0xff
  }
  return bytes
}

function concat(chunks: Uint8Array[]): Uint8Array {
  let total = 0
  chunks.forEach((chunk) => {
    total += chunk.length
  })
  const output = new Uint8Array(total)
  let offset = 0
  chunks.forEach((chunk) => {
    output.set(chunk, offset)
    offset += chunk.length
  })
  return output
}

function fmt(value: number): string {
  return String(Math.round(value * 100) / 100)
}

/** 解析 JPEG SOF 段，拿到宽高与通道数；非 JPEG 返回 null */
export function jpegSize(bytes: Uint8Array): JpegInfo | null {
  if (!bytes || bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) {
    return null
  }
  let index = 2
  while (index + 9 < bytes.length) {
    if (bytes[index] !== 0xff) {
      index += 1
      continue
    }
    while (index < bytes.length && bytes[index] === 0xff) {
      index += 1
    }
    if (index >= bytes.length) {
      return null
    }
    const marker = bytes[index]
    index += 1
    if (marker === 0xd8 || marker === 0xd9) {
      continue
    }
    if (index + 1 >= bytes.length) {
      return null
    }
    const segmentLength = (bytes[index] << 8) | bytes[index + 1]
    if (segmentLength < 2 || index + segmentLength > bytes.length) {
      return null
    }
    const isSof =
      marker >= 0xc0 &&
      marker <= 0xcf &&
      marker !== 0xc4 &&
      marker !== 0xc8 &&
      marker !== 0xcc
    if (isSof) {
      const height = (bytes[index + 3] << 8) | bytes[index + 4]
      const width = (bytes[index + 5] << 8) | bytes[index + 6]
      const components = bytes[index + 7]
      if (!width || !height || !components) {
        return null
      }
      return { width, height, components }
    }
    index += segmentLength
  }
  return null
}

interface PageBox {
  pageWidth: number
  pageHeight: number
  drawWidth: number
  drawHeight: number
  x: number
  y: number
}

function pageBox(width: number, height: number, size: PdfPageSize): PageBox {
  if (size === 'original') {
    return {
      pageWidth: width,
      pageHeight: height,
      drawWidth: width,
      drawHeight: height,
      x: 0,
      y: 0,
    }
  }
  const pageWidth = size === 'a4' ? 595 : 612
  const pageHeight = size === 'a4' ? 842 : 792
  const scale = Math.min(pageWidth / width, pageHeight / height)
  const drawWidth = width * scale
  const drawHeight = height * scale
  return {
    pageWidth,
    pageHeight,
    drawWidth,
    drawHeight,
    x: (pageWidth - drawWidth) / 2,
    y: (pageHeight - drawHeight) / 2,
  }
}

function colorSpaceOf(components: number): string | null {
  if (components === 1) {
    return 'DeviceGray'
  }
  if (components === 3) {
    return 'DeviceRGB'
  }
  if (components === 4) {
    return 'DeviceCMYK'
  }
  return null
}

/**
 * 组装 PDF 1.4：Catalog / Pages / Page / Contents / Image / xref。
 * 任一页不是可解析 JPEG、页数超限或成品超过 2MB 时返回 null。
 */
export function buildImagePdf(
  pages: PdfJpegPage[],
  pageSize: PdfPageSize,
): Uint8Array | null {
  if (!Array.isArray(pages) || pages.length < 1 || pages.length > PDF_MAX_PAGES) {
    return null
  }
  if (pageSize !== 'a4' && pageSize !== 'letter' && pageSize !== 'original') {
    return null
  }

  const parts: Uint8Array[] = []
  const offsets: number[] = []
  let cursor = 0
  const append = (chunk: Uint8Array): void => {
    parts.push(chunk)
    cursor += chunk.length
  }
  const beginObject = (objectNumber: number): void => {
    offsets[objectNumber] = cursor
  }

  append(ascii('%PDF-1.4\n%CHTBX\n'))

  beginObject(1)
  append(ascii('1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n'))

  const pageObjects = pages.map((_, index) => 3 + index * 3)
  beginObject(2)
  append(
    ascii(
      `2 0 obj\n<< /Type /Pages /Kids [${pageObjects
        .map((number) => `${number} 0 R`)
        .join(' ')}] /Count ${pages.length} >>\nendobj\n`,
    ),
  )

  for (let index = 0; index < pages.length; index += 1) {
    const page = pages[index]
    if (!page || !page.data || page.data.length === 0) {
      return null
    }
    const info = jpegSize(page.data)
    if (!info) {
      return null
    }
    const colorSpace = colorSpaceOf(info.components)
    if (!colorSpace) {
      return null
    }
    const pageNumber = pageObjects[index]
    const contentNumber = pageNumber + 1
    const imageNumber = pageNumber + 2
    const box = pageBox(info.width, info.height, pageSize)
    const content = `q ${fmt(box.drawWidth)} 0 0 ${fmt(box.drawHeight)} ${fmt(
      box.x,
    )} ${fmt(box.y)} cm /Im0 Do Q`

    beginObject(pageNumber)
    append(
      ascii(
        `${pageNumber} 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${fmt(
          box.pageWidth,
        )} ${fmt(box.pageHeight)}] /Resources << /XObject << /Im0 ${imageNumber} 0 R >> >> /Contents ${contentNumber} 0 R >>\nendobj\n`,
      ),
    )

    beginObject(contentNumber)
    append(
      ascii(
        `${contentNumber} 0 obj\n<< /Length ${content.length} >>\nstream\n${content}\nendstream\nendobj\n`,
      ),
    )

    beginObject(imageNumber)
    append(
      ascii(
        `${imageNumber} 0 obj\n<< /Type /XObject /Subtype /Image /Width ${
          info.width
        } /Height ${info.height} /ColorSpace /${colorSpace} /BitsPerComponent 8 /Filter /DCTDecode /Length ${
          page.data.length
        } >>\nstream\n`,
      ),
    )
    append(page.data)
    append(ascii('\nendstream\nendobj\n'))
  }

  const objectCount = 2 + pages.length * 3
  const xrefOffset = cursor
  append(ascii(`xref\n0 ${objectCount + 1}\n0000000000 65535 f \n`))
  for (let number = 1; number <= objectCount; number += 1) {
    const offset = offsets[number] ?? 0
    append(ascii(`${String(offset).padStart(10, '0')} 00000 n \n`))
  }
  append(
    ascii(
      `trailer\n<< /Size ${objectCount + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`,
    ),
  )

  const output = concat(parts)
  return output.length > PDF_MAX_BYTES ? null : output
}
