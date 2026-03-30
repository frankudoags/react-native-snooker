import type { P2P } from './specs/p2p.nitro'
export type {
  P2PEvent,
  P2PPeer,
  P2PMessage,
  P2PEventType,
  P2PEventCallback,
} from './specs/p2p.nitro'

import { NitroModules } from 'react-native-nitro-modules'

const p2pInstance = NitroModules.createHybridObject<P2P>('P2P')

export { p2pInstance as p2p }
