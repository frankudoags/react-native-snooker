export type NetworkMessage =
  | { type: 'HELLO'; deviceId: string; playerName: string }
  | { type: 'SHOT'; angle: number; power: number; playerId: string }
  | { type: 'GAME_STATE'; balls: Record<string, { x: number; y: number }>; turn: string }
  | { type: 'SYNC_REQUEST'; moveIndex: number }
  | { type: 'SYNC_RESPONSE'; moves: unknown[] }
  | { type: 'GAME_OVER'; winner: string }

export interface NetworkEnvelope {
  id: string
  fromPeerId: string
  message: NetworkMessage
  receivedAt: number
}
