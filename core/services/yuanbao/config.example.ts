/* ==========================================================================
   元宝搜索 · 本地配置模板
   - 正式接入请把本文件复制为 config-local.ts，填入 TC3 SecretId / SecretKey（当前采用）
   - 也可只填服务 API KEY（sk- 开头），此时走 Bearer
   - config-local.ts 已被 .gitignore 忽略，禁止把真实密钥提交到仓库
   ========================================================================== */
export interface YuanbaoConfig {
  /** 服务 API KEY（sk- 开头）；为空时走 TC3 SecretId/SecretKey */
  apiKey: string
  /** 腾讯云 SecretId（仅 TC3 方式使用） */
  secretId: string
  /** 腾讯云 SecretKey（仅 TC3 方式使用；禁止提交） */
  secretKey: string
  /** 服务 API KEY 方式的接入地址 */
  endpoint: string
  /** 单次请求超时（毫秒） */
  timeout: number
}

export const YUANBAO_CONFIG: YuanbaoConfig = {
  apiKey: '',
  secretId: '',
  secretKey: '',
  endpoint: 'https://api.wsa.cloud.tencent.com/SearchPro',
  timeout: 15000,
}
