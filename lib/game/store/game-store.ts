import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'
import type { BallId } from '../physics/index'
import type { BallKinematics } from '../physics/index'
import type { NetworkEnvelope, NetworkMessage } from '../networking/types'
import { getInitialBallPositions } from '../physics/index'
import mmkvStorage from '../../utils/mmkv-storage'

// ─── Types ────────────────────────────────────────────────────────────────────

export interface GameMove {
  id: string
  playerId: 'player1' | 'player2'
  timestamp: number
  angle: number
  power: number
  spin?: { x: number; y: number }
  pocketedBalls: BallId[]
  cueBallPocketed: boolean
}

export interface NetworkPeer {
  id: string
  name: string
  host: string
  port: number
}

export interface GameState {
  // Current game state
  balls: BallKinematics
  turn: 'player1' | 'player2'
  player1Group: 'solids' | 'stripes' | null
  player2Group: 'solids' | 'stripes' | null
  gameOver: boolean
  winner: 'player1' | 'player2' | null

  // Move history
  moves: GameMove[]

  // Networking state
  peers: NetworkPeer[]
  connectedPeers: NetworkPeer[]
  isConnected: boolean
  isDiscovering: boolean
  isHost: boolean
  deviceId: string
  playerName: string
  pendingNetworkMessages: NetworkEnvelope[]
  lastNetworkError: { code: string; message: string } | null

  // Current shot
  currentShot: {
    aiming: boolean
    angle: number
    power: number
  }

  // Actions
  updateBallPositions: (positions: BallKinematics) => void
  setTurn: (player: 'player1' | 'player2') => void
  setPlayerGroup: (player: 'player1' | 'player2', group: 'solids' | 'stripes') => void
  setGameOver: (winner: 'player1' | 'player2' | null) => void
  addMove: (move: Omit<GameMove, 'id' | 'timestamp'>) => void
  setPeers: (peers: NetworkPeer[]) => void
  setConnectedPeers: (connectedPeers: NetworkPeer[]) => void
  setIsConnected: (isConnected: boolean) => void
  setIsDiscovering: (isDiscovering: boolean) => void
  setIsHost: (isHost: boolean) => void
  setDeviceId: (deviceId: string) => void
  setPlayerName: (playerName: string) => void
  setNetworkError: (code: string, message: string) => void
  clearNetworkError: () => void
  enqueueNetworkMessage: (message: NetworkMessage, fromPeerId: string) => void
  dequeueNetworkMessage: () => NetworkEnvelope | null

  // Shot actions
  startAiming: () => void
  setShotAngle: (angle: number) => void
  setShotPower: (power: number) => void
  endAiming: () => void

  // Game actions
  resetGame: () => void
  saveGame: () => string
  getSavedGames: () => SavedGame[]
  deleteGame: (gameId: string) => void
}

export interface SavedGame {
  id: string
  name: string
  date: number
  moves: GameMove[]
  winner: 'player1' | 'player2' | null
  finalTurn: 'player1' | 'player2'
}

// ─── Initial State Helper ────────────────────────────────────────────────────────

function getInitialState() {
  return {
    balls: Object.fromEntries(
      Object.entries(getInitialBallPositions()).map(([id, ball]) => [
        id,
        { x: ball.x, y: ball.y, vx: 0, vy: 0 },
      ])
    ) as BallKinematics,
    turn: 'player1' as const,
    player1Group: null as 'solids' | 'stripes' | null,
    player2Group: null as 'solids' | 'stripes' | null,
    gameOver: false,
    winner: null as 'player1' | 'player2' | null,
    moves: [] as GameMove[],
    peers: [] as NetworkPeer[],
    connectedPeers: [] as NetworkPeer[],
    isConnected: false,
    isDiscovering: false,
    isHost: false,
    deviceId: '',
    playerName: `Player ${Math.floor(Math.random() * 999)}`,
    pendingNetworkMessages: [] as NetworkEnvelope[],
    lastNetworkError: null as { code: string; message: string } | null,
    currentShot: {
      aiming: false,
      angle: 0,
      power: 0,
    },
  }
}

// ─── Store ───────────────────────────────────────────────────────────────────

export const useGameStore = create<GameState>()(
  persist(
    (set, get) => ({
      ...getInitialState(),

      // Actions
      updateBallPositions: (positions) => set({ balls: positions }),

      setTurn: (player) => set({ turn: player }),

      setPlayerGroup: (player, group) => {
        if (player === 'player1') {
          set({ player1Group: group, player2Group: group === 'solids' ? 'stripes' : 'solids' })
        } else {
          set({ player2Group: group, player1Group: group === 'solids' ? 'stripes' : 'solids' })
        }
      },

      setGameOver: (winner) => set({ gameOver: true, winner }),

      addMove: (move) => {
        const newMove: GameMove = {
          ...move,
          id: `move_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`,
          timestamp: Date.now(),
        }
        set((state) => ({ moves: [...state.moves, newMove] }))
      },

      setPeers: (peers) => set({ peers }),

      setConnectedPeers: (connectedPeers) => set({ connectedPeers }),

      setIsConnected: (isConnected) => set({ isConnected }),

      setIsDiscovering: (isDiscovering) => set({ isDiscovering }),

      setIsHost: (isHost) => set({ isHost }),

      setDeviceId: (deviceId) => set({ deviceId }),

      setPlayerName: (playerName) => set({ playerName }),

      setNetworkError: (code, message) => set({ lastNetworkError: { code, message } }),

      clearNetworkError: () => set({ lastNetworkError: null }),

      enqueueNetworkMessage: (message, fromPeerId) => {
        const envelope: NetworkEnvelope = {
          id: `net_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`,
          fromPeerId,
          message,
          receivedAt: Date.now(),
        }
        set((state) => ({
          pendingNetworkMessages: [...state.pendingNetworkMessages, envelope],
        }))
      },

      dequeueNetworkMessage: () => {
        let first: NetworkEnvelope | null = null
        set((state) => {
          if (state.pendingNetworkMessages.length === 0) {
            return state
          }

          first = state.pendingNetworkMessages[0] ?? null
          return {
            pendingNetworkMessages: state.pendingNetworkMessages.slice(1),
          }
        })
        return first
      },

      // Shot actions
      startAiming: () => set((state) => ({ currentShot: { ...state.currentShot, aiming: true } })),

      setShotAngle: (angle) => set((state) => ({ currentShot: { ...state.currentShot, angle } })),

      setShotPower: (power) => set((state) => ({ currentShot: { ...state.currentShot, power } })),

      endAiming: () => set((state) => ({ currentShot: { ...state.currentShot, aiming: false, power: 0 } })),

      // Game actions
      resetGame: () => set(getInitialState()),

      saveGame: () => {
        const state = get()
        const gameId = `game_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`

        const savedGame: SavedGame = {
          id: gameId,
          name: `Game ${new Date().toLocaleString()}`,
          date: Date.now(),
          moves: state.moves,
          winner: state.winner,
          finalTurn: state.turn,
        }

        mmkvStorage.setItem(gameId, JSON.stringify(savedGame))

        // Add to game list
        const gameListData = mmkvStorage.getItem('game_list')
        const gameIds: string[] = gameListData ? JSON.parse(gameListData as string) : []
        gameIds.push(gameId)
        mmkvStorage.setItem('game_list', JSON.stringify(gameIds))

        return gameId
      },

      getSavedGames: () => {
        // Note: MMKV doesn't have getAllKeys in the adapter pattern
        // We'll store game IDs in a separate list
        const gameListData = mmkvStorage.getItem('game_list')
        const gameIds: string[] = gameListData ? JSON.parse(gameListData as string) : []
        const games: SavedGame[] = []

        gameIds.forEach((gameId) => {
          const data = mmkvStorage.getItem(gameId)
          if (data) {
            try {
              games.push(JSON.parse(data as string))
            } catch {
              // Invalid data, skip
            }
          }
        })

        return games.sort((a, b) => b.date - a.date)
      },

      deleteGame: (gameId) => {
        mmkvStorage.removeItem(gameId)

        // Remove from game list
        const gameListData = mmkvStorage.getItem('game_list')
        if (gameListData) {
          const gameIds: string[] = JSON.parse(gameListData as string)
          const newGameIds = gameIds.filter((id) => id !== gameId)
          mmkvStorage.setItem('game_list', JSON.stringify(newGameIds))
        }
      },
    }),
    {
      name: 'game-store',
      storage: createJSONStorage(() => mmkvStorage),
    }
  )
)

// ─── Replays ───────────────────────────────────────────────────────────────────

export interface ReplayState {
  currentMoveIndex: number
  isPlaying: boolean
  playbackSpeed: number
  setCurrentMoveIndex: (index: number) => void
  togglePlayback: () => void
  setPlaybackSpeed: (speed: number) => void
}

export const useReplayStore = create<ReplayState>((set) => ({
  currentMoveIndex: 0,
  isPlaying: false,
  playbackSpeed: 1,

  setCurrentMoveIndex: (index) => set({ currentMoveIndex: index }),

  togglePlayback: () => set((state) => ({ isPlaying: !state.isPlaying })),

  setPlaybackSpeed: (speed) => set({ playbackSpeed: speed }),
}))
