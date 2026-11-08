/* ==========================================================================
   crypto-js 本地 vendor 类型声明
   - 运行时文件来自 tools-core 已审计的 miniprogram_npm/crypto-js/index.js
   - 只声明本分包实际消费的 AES / SHA256 / WordArray API
   ========================================================================== */

export interface CryptoWordArray {
  toString(encoding: unknown): string
}

export interface CryptoEncoding {
  parse(input: string): CryptoWordArray
  stringify(words: CryptoWordArray): string
}

export interface CryptoJsStatic {
  lib: {
    WordArray: {
      random(words: number): CryptoWordArray
      create(words: number[]): CryptoWordArray
    }
    CipherParams: {
      create(params: { ciphertext: CryptoWordArray }): unknown
    }
  }
  enc: {
    Hex: CryptoEncoding
    Utf8: CryptoEncoding
    Base64: CryptoEncoding
  }
  mode: {
    CBC: unknown
  }
  pad: {
    Pkcs7: unknown
  }
  AES: {
    encrypt(
      message: string,
      key: CryptoWordArray,
      config: Record<string, unknown>,
    ): { ciphertext: CryptoWordArray; iv: CryptoWordArray }
    decrypt(
      ciphertext: unknown,
      key: CryptoWordArray,
      config: Record<string, unknown>,
    ): { toString(encoding: unknown): string }
  }
  SHA256(message: string): CryptoWordArray
}

declare const CryptoJS: CryptoJsStatic
export default CryptoJS
