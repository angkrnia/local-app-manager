import type { TunnelManagerApi } from '../shared/types'

declare global {
  interface Window {
    api: TunnelManagerApi
  }
}

export {}
