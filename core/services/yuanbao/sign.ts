/* 元宝搜索 TC3-HMAC-SHA256 签名：纯 TS、零依赖，不打印任何密钥 */
const K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
])
const HEX = '0123456789abcdef'
const rotr = (value: number, bits: number): number => (value >>> bits) | (value << (32 - bits))

export function utf8Bytes(input: string): Uint8Array {
  const bytes: number[] = []
  for (let index = 0; index < input.length; index += 1) {
    let code = input.charCodeAt(index)
    if (code >= 0xd800 && code <= 0xdbff && index + 1 < input.length) {
      const next = input.charCodeAt(index + 1)
      if (next >= 0xdc00 && next <= 0xdfff) {
        code = 0x10000 + ((code - 0xd800) << 10) + (next - 0xdc00)
        index += 1
      }
    }
    if (code < 0x80) bytes.push(code)
    else if (code < 0x800) bytes.push(0xc0 | (code >> 6), 0x80 | (code & 0x3f))
    else if (code < 0x10000) {
      bytes.push(0xe0 | (code >> 12), 0x80 | ((code >> 6) & 0x3f), 0x80 | (code & 0x3f))
    } else {
      bytes.push(
        0xf0 | (code >> 18),
        0x80 | ((code >> 12) & 0x3f),
        0x80 | ((code >> 6) & 0x3f),
        0x80 | (code & 0x3f),
      )
    }
  }
  return new Uint8Array(bytes)
}

export function bytesToHex(bytes: Uint8Array): string {
  let output = ''
  for (let index = 0; index < bytes.length; index += 1) {
    output += HEX[(bytes[index] >> 4) & 0x0f] + HEX[bytes[index] & 0x0f]
  }
  return output
}

export function sha256Bytes(input: Uint8Array): Uint8Array {
  const bitLength = input.length * 8
  const paddedLength = (((input.length + 9) >> 6) + 1) << 6
  const buffer = new Uint8Array(paddedLength)
  buffer.set(input)
  buffer[input.length] = 0x80
  const view = new DataView(buffer.buffer)
  view.setUint32(paddedLength - 8, Math.floor(bitLength / 0x100000000), false)
  view.setUint32(paddedLength - 4, bitLength >>> 0, false)

  let h0 = 0x6a09e667
  let h1 = 0xbb67ae85
  let h2 = 0x3c6ef372
  let h3 = 0xa54ff53a
  let h4 = 0x510e527f
  let h5 = 0x9b05688c
  let h6 = 0x1f83d9ab
  let h7 = 0x5be0cd19
  const w = new Uint32Array(64)

  for (let offset = 0; offset < buffer.length; offset += 64) {
    for (let index = 0; index < 16; index += 1) w[index] = view.getUint32(offset + index * 4, false)
    for (let index = 16; index < 64; index += 1) {
      const s0 = rotr(w[index - 15], 7) ^ rotr(w[index - 15], 18) ^ (w[index - 15] >>> 3)
      const s1 = rotr(w[index - 2], 17) ^ rotr(w[index - 2], 19) ^ (w[index - 2] >>> 10)
      w[index] = (w[index - 16] + s0 + w[index - 7] + s1) >>> 0
    }
    let a = h0
    let b = h1
    let c = h2
    let d = h3
    let e = h4
    let f = h5
    let g = h6
    let h = h7
    for (let index = 0; index < 64; index += 1) {
      const s1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25)
      const ch = (e & f) ^ (~e & g)
      const temp1 = (h + s1 + ch + K[index] + w[index]) >>> 0
      const s0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22)
      const maj = (a & b) ^ (a & c) ^ (b & c)
      const temp2 = (s0 + maj) >>> 0
      h = g
      g = f
      f = e
      e = (d + temp1) >>> 0
      d = c
      c = b
      b = a
      a = (temp1 + temp2) >>> 0
    }
    h0 = (h0 + a) >>> 0
    h1 = (h1 + b) >>> 0
    h2 = (h2 + c) >>> 0
    h3 = (h3 + d) >>> 0
    h4 = (h4 + e) >>> 0
    h5 = (h5 + f) >>> 0
    h6 = (h6 + g) >>> 0
    h7 = (h7 + h) >>> 0
  }

  const output = new Uint8Array(32)
  const outputView = new DataView(output.buffer)
  ;[h0, h1, h2, h3, h4, h5, h6, h7].forEach((value, index) => {
    outputView.setUint32(index * 4, value, false)
  })
  return output
}

export function sha256Hex(input: string): string {
  return bytesToHex(sha256Bytes(utf8Bytes(input)))
}

export function hmacSha256Bytes(key: Uint8Array, message: string): Uint8Array {
  const normalized = key.length > 64 ? sha256Bytes(key) : key
  const block = new Uint8Array(64)
  block.set(normalized)
  const messageBytes = utf8Bytes(message)
  const inner = new Uint8Array(64 + messageBytes.length)
  for (let index = 0; index < 64; index += 1) inner[index] = block[index] ^ 0x36
  inner.set(messageBytes, 64)
  const innerHash = sha256Bytes(inner)
  const outer = new Uint8Array(64 + 32)
  for (let index = 0; index < 64; index += 1) outer[index] = block[index] ^ 0x5c
  outer.set(innerHash, 64)
  return sha256Bytes(outer)
}

function utcDate(timestamp: number): string {
  const date = new Date(timestamp * 1000)
  const month = String(date.getUTCMonth() + 1).padStart(2, '0')
  const day = String(date.getUTCDate()).padStart(2, '0')
  return `${date.getUTCFullYear()}-${month}-${day}`
}

export interface Tc3SignInput {
  secretId: string
  secretKey: string
  host: string
  service: string
  action: string
  version: string
  payload: string
  timestamp: number
}

export interface Tc3SignResult {
  authorization: string
  headers: Record<string, string>
  date: string
}

export function signTc3(input: Tc3SignInput): Tc3SignResult {
  const date = utcDate(input.timestamp)
  const canonicalHeaders = `content-type:application/json; charset=utf-8\nhost:${input.host}\nx-tc-action:${input.action.toLowerCase()}\n`
  const signedHeaders = 'content-type;host;x-tc-action'
  const canonicalRequest = `POST\n/\n\n${canonicalHeaders}\n${signedHeaders}\n${sha256Hex(input.payload)}`
  const credentialScope = `${date}/${input.service}/tc3_request`
  const stringToSign = `TC3-HMAC-SHA256\n${input.timestamp}\n${credentialScope}\n${sha256Hex(canonicalRequest)}`
  const secretDate = hmacSha256Bytes(utf8Bytes(`TC3${input.secretKey}`), date)
  const secretService = hmacSha256Bytes(secretDate, input.service)
  const secretSigning = hmacSha256Bytes(secretService, 'tc3_request')
  const signature = bytesToHex(hmacSha256Bytes(secretSigning, stringToSign))
  const authorization = `TC3-HMAC-SHA256 Credential=${input.secretId}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`

  return {
    date,
    authorization,
    headers: {
      Authorization: authorization,
      'Content-Type': 'application/json; charset=utf-8',
      'X-TC-Action': input.action,
      'X-TC-Version': input.version,
      'X-TC-Timestamp': String(input.timestamp),
    },
  }
}
