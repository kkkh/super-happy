export type GlassModalCloseSource =
  | 'confirm'
  | 'cancel'
  | 'mask'
  | 'extra'
  | 'programmatic'

export interface GlassModalCloseDetail {
  source: GlassModalCloseSource
}
