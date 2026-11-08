/**
 * workers/compute.js
 * 微信小程序 Worker 计算入口
 * - 平台限制：同一时刻只允许一个 Worker，因此本文件按串行任务处理
 * - 协议：
 *   主线程 -> Worker: { kind: 'task', id, task, payload }
 *   Worker -> 主线程: { kind: 'progress', id, progress } |
 *                    { kind: 'done', id, ok, data } |
 *                    { kind: 'done', id, ok: false, error: { code, message } }
 * - 支持 text-stats / dedupe / base64-encode / checksum
 */

function postProgress(id, progress) {
  worker.postMessage({
    kind: 'progress',
    id: id,
    progress: progress,
  })
}

function postDone(id, data) {
  worker.postMessage({
    kind: 'done',
    id: id,
    ok: true,
    data: data,
  })
}

function postError(id, code, message) {
  worker.postMessage({
    kind: 'done',
    id: id,
    ok: false,
    error: {
      code: code,
      message: message,
    },
  })
}

function computeTextStats(id, payload) {
  var text = payload && typeof payload.text === 'string' ? payload.text : ''
  var total = 0
  var noSpace = 0
  var chinese = 0
  var words = 0
  var numberRuns = 0
  var lines = 1
  var nonEmptyLines = 0
  var paragraphs = 0
  var maxLineLength = 0
  var inWord = false
  var inDigits = false
  var lineHasContent = false
  var inParagraph = false
  var lineLength = 0
  var index = 0
  var lastProgress = 0

  while (index < text.length) {
    var code = text.charCodeAt(index)
    var codePoint = code

    if (code >= 0xd800 && code <= 0xdbff && index + 1 < text.length) {
      var low = text.charCodeAt(index + 1)
      if (low >= 0xdc00 && low <= 0xdfff) {
        codePoint = 0x10000 + ((code - 0xd800) << 10) + (low - 0xdc00)
        code = low
        index += 1
      }
    }

    total += 1
    var isSpace =
      codePoint === 32 ||
      (codePoint >= 9 && codePoint <= 13) ||
      codePoint === 160 ||
      codePoint === 5760 ||
      (codePoint >= 8192 && codePoint <= 8202) ||
      codePoint === 8232 ||
      codePoint === 8233 ||
      codePoint === 8239 ||
      codePoint === 8287 ||
      codePoint === 12288 ||
      codePoint === 65279

    if (!isSpace) {
      noSpace += 1
      lineHasContent = true
    }

    if (
      (codePoint >= 0x3400 && codePoint <= 0x4dbf) ||
      (codePoint >= 0x4e00 && codePoint <= 0x9fff) ||
      (codePoint >= 0xf900 && codePoint <= 0xfaff)
    ) {
      chinese += 1
    }

    var isAsciiLetter =
      (code >= 65 && code <= 90) || (code >= 97 && code <= 122)
    var isConnector = code === 39 || code === 8217 || code === 45

    if (isAsciiLetter) {
      if (!inWord) {
        words += 1
        inWord = true
      }
    } else if (!(isConnector && inWord)) {
      inWord = false
    }

    var isDigit = code >= 48 && code <= 57
    if (isDigit) {
      if (!inDigits) {
        numberRuns += 1
        inDigits = true
      }
    } else {
      inDigits = false
    }

    if (codePoint === 10) {
      lines += 1
      if (lineHasContent) {
        nonEmptyLines += 1
        if (!inParagraph) {
          paragraphs += 1
          inParagraph = true
        }
      } else {
        inParagraph = false
      }
      lineHasContent = false
      lineLength = 0
    } else {
      lineLength += 1
      if (lineLength > maxLineLength) {
        maxLineLength = lineLength
      }
    }

    index += 1
    if (text.length > 0 && index - lastProgress > 200000) {
      lastProgress = index
      postProgress(id, Math.min(0.95, index / text.length))
    }
  }

  if (lineHasContent) {
    nonEmptyLines += 1
    if (!inParagraph) {
      paragraphs += 1
    }
  }

  return {
    codePoints: total,
    noSpace: noSpace,
    chinese: chinese,
    words: words,
    numberRuns: numberRuns,
    lines: lines,
    nonEmptyLines: nonEmptyLines,
    paragraphs: paragraphs,
    maxLineLength: maxLineLength,
    readingMinutes: Math.max(1, Math.ceil((chinese + words * 2) / 300)),
  }
}

function computeDedupe(id, payload) {
  var text = payload && typeof payload.text === 'string' ? payload.text : ''
  var dropEmpty = payload && payload.dropEmpty === true
  var trimLines = payload && payload.trimLines === true
  var ignoreCase = payload && payload.ignoreCase === true
  var sortMode = payload && payload.sort ? payload.sort : 'none'

  var normalized = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n')
  var rawLines = normalized.split('\n')
  var originalLines = rawLines.length
  var emptyLines = 0
  var lines = []
  var index = 0

  for (index = 0; index < rawLines.length; index += 1) {
    var rawLine = rawLines[index]
    if (!rawLine.trim()) {
      emptyLines += 1
    }
    lines.push(trimLines ? rawLine.trim() : rawLine)
    if (index > 0 && index % 5000 === 0) {
      postProgress(id, Math.min(0.7, index / rawLines.length * 0.7))
    }
  }

  if (dropEmpty) {
    var filtered = []
    for (index = 0; index < lines.length; index += 1) {
      if (lines[index].trim()) {
        filtered.push(lines[index])
      }
    }
    lines = filtered
  }

  var seen = {}
  var deduped = []
  var duplicateLines = 0
  for (index = 0; index < lines.length; index += 1) {
    var line = lines[index]
    var key = ignoreCase ? line.toLowerCase() : line
    if (Object.prototype.hasOwnProperty.call(seen, key)) {
      duplicateLines += 1
    } else {
      seen[key] = true
      deduped.push(line)
    }
  }

  if (sortMode === 'asc') {
    deduped.sort(function (left, right) {
      return left < right ? -1 : left > right ? 1 : 0
    })
  } else if (sortMode === 'desc') {
    deduped.sort(function (left, right) {
      return left > right ? -1 : left < right ? 1 : 0
    })
  } else if (sortMode === 'length') {
    deduped.sort(function (left, right) {
      return left.length - right.length
    })
  }

  postProgress(id, 0.95)

  return {
    text: deduped.join('\n'),
    originalLines: originalLines,
    emptyLines: emptyLines,
    duplicateLines: duplicateLines,
    resultLines: deduped.length,
  }
}

function utf8ToBytes(text) {
  var bytes = []
  var index = 0

  while (index < text.length) {
    var code = text.charCodeAt(index)
    if (code >= 0xd800 && code <= 0xdbff && index + 1 < text.length) {
      var low = text.charCodeAt(index + 1)
      if (low >= 0xdc00 && low <= 0xdfff) {
        code = 0x10000 + ((code - 0xd800) << 10) + (low - 0xdc00)
        index += 1
      }
    }

    if (code < 0x80) {
      bytes.push(code)
    } else if (code < 0x800) {
      bytes.push(0xc0 | (code >> 6), 0x80 | (code & 0x3f))
    } else if (code < 0x10000) {
      bytes.push(
        0xe0 | (code >> 12),
        0x80 | ((code >> 6) & 0x3f),
        0x80 | (code & 0x3f)
      )
    } else {
      bytes.push(
        0xf0 | (code >> 18),
        0x80 | ((code >> 12) & 0x3f),
        0x80 | ((code >> 6) & 0x3f),
        0x80 | (code & 0x3f)
      )
    }

    index += 1
  }

  return bytes
}

function bytesToBase64(bytes) {
  var alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'
  var out = ''
  var index = 0

  for (; index < bytes.length; index += 3) {
    var b1 = bytes[index]
    var b2 = bytes[index + 1]
    var b3 = bytes[index + 2]

    out += alphabet[b1 >> 2]
    out += alphabet[((b1 & 0x03) << 4) | ((b2 === undefined ? 0 : b2) >> 4)]
    out += b2 === undefined
      ? '='
      : alphabet[((b2 & 0x0f) << 2) | ((b3 === undefined ? 0 : b3) >> 6)]
    out += b3 === undefined ? '=' : alphabet[b3 & 0x3f]
  }

  return out
}

function computeBase64(id, payload) {
  var text = payload && typeof payload.text === 'string' ? payload.text : ''
  postProgress(id, 0.2)
  var bytes = utf8ToBytes(text)
  postProgress(id, 0.8)
  return {
    base64: bytesToBase64(bytes),
    bytes: bytes.length,
  }
}

function fnv1a(text, seed) {
  var hash = seed >>> 0
  var index = 0

  for (; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index)
    hash = (hash * 0x01000193) >>> 0
  }

  return hash >>> 0
}

function padHex(value) {
  var text = value.toString(16)
  while (text.length < 8) {
    text = '0' + text
  }
  return text
}

function computeChecksum(id, payload) {
  var text = payload && typeof payload.text === 'string' ? payload.text : ''
  postProgress(id, 0.2)
  var first = fnv1a(text, 0x811c9dc5)
  postProgress(id, 0.6)
  var second = fnv1a(text, 0x7f4a7c15)
  postProgress(id, 0.95)
  return {
    hash: padHex(first) + padHex(second),
    length: text.length,
  }
}

function computeChunkText(id, payload) {
  var text = payload && typeof payload.text === 'string' ? payload.text : ''
  var chunkSize = clampInt(payload && payload.chunkSize, 256, 65536, 4096)
  var overlap = clampInt(payload && payload.overlap, 0, Math.floor(chunkSize / 2), 0)
  var step = Math.max(1, chunkSize - overlap)
  var chunks = []
  var start = 0
  var index = 0

  while (start < text.length || (text.length === 0 && index === 0)) {
    var end = Math.min(text.length, start + chunkSize)
    chunks.push({
      index: index,
      start: start,
      end: end,
      preview: text.slice(start, Math.min(end, start + 80)),
    })
    index += 1
    if (end >= text.length) {
      break
    }
    start += step
    if (index % 200 === 0) {
      postProgress(id, Math.min(0.95, start / Math.max(1, text.length)))
    }
  }

  return {
    chunks: chunks,
    total: chunks.length,
    chunkSize: chunkSize,
    overlap: overlap,
  }
}

function computeNineGridPlan(id, payload) {
  var width = payload && typeof payload.width === 'number'
    ? Math.max(0, Math.floor(payload.width))
    : 0
  var height = payload && typeof payload.height === 'number'
    ? Math.max(0, Math.floor(payload.height))
    : 0
  var columns = clampInt(payload && payload.columns, 1, 12, 3)
  var rows = clampInt(payload && payload.rows, 1, 12, 3)
  var side = Math.min(width, height)
  var cell = Math.floor(side / Math.max(columns, rows))
  var originX = Math.floor((width - side) / 2)
  var originY = Math.floor((height - side) / 2)
  var offsetsX = []
  var offsetsY = []
  var index = 0

  for (index = 0; index < columns; index += 1) {
    offsetsX.push(originX + index * cell)
  }
  for (index = 0; index < rows; index += 1) {
    offsetsY.push(originY + index * cell)
  }

  postProgress(id, 0.4)

  return {
    side: side,
    cell: cell,
    columns: columns,
    rows: rows,
    offsetsX: offsetsX,
    offsetsY: offsetsY,
    count: columns * rows,
  }
}

function clampInt(value, min, max, fallback) {
  if (typeof value !== 'number' || !isFinite(value)) {
    return fallback
  }
  var next = Math.floor(value)
  return Math.min(max, Math.max(min, next))
}

function runTask(message) {
  var id = message.id
  var task = message.task
  var payload = message.payload

  try {
    if (task === 'text-stats') {
      postDone(id, computeTextStats(id, payload))
      return
    }
    if (task === 'dedupe') {
      postDone(id, computeDedupe(id, payload))
      return
    }
    if (task === 'base64-encode') {
      postDone(id, computeBase64(id, payload))
      return
    }
    if (task === 'checksum') {
      postDone(id, computeChecksum(id, payload))
      return
    }
    if (task === 'chunk-text') {
      postDone(id, computeChunkText(id, payload))
      return
    }
    if (task === 'nine-grid-plan') {
      postDone(id, computeNineGridPlan(id, payload))
      return
    }
    postError(id, 'UNKNOWN_TASK', '未知的计算任务：' + String(task))
  } catch (error) {
    var messageText =
      error && error.message ? error.message : String(error)
    postError(id, 'WORKER_ERROR', messageText)
  }
}

worker.onMessage(function (res) {
  var message = res && res.message ? res.message : res
  if (!message || message.kind !== 'task') {
    return
  }
  runTask(message)
})
