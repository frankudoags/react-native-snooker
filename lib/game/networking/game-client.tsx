import { useCallback, useEffect, useState } from 'react'
import { p2p } from '../../../modules/nitro-p2p/src/index'
import { P2PEventType } from '../../../modules/nitro-p2p/src/specs/p2p.nitro'
import type { P2PEvent, P2PPeer } from '../../../modules/nitro-p2p/src/specs/p2p.nitro'
import { useGameStore } from '../store/game-store'
import mmkvStorage from '../../utils/mmkv-storage'
import type { NetworkMessage } from './types'
export type { NetworkMessage } from './types'

// ─── Types ───────────────────────────────────────────────────────────────────

export interface GameClientState {
  peers: P2PPeer[]
  connectedPeers: P2PPeer[]
  isConnected: boolean
  isHost: boolean
  deviceId: string
  playerName: string
}

export interface GameClientCallbacks {
  onPeerDiscovered?: (peer: P2PPeer) => void
  onPeerConnected?: (peer: P2PPeer) => void
  onPeerDisconnected?: (peerId: string) => void
  onMessageReceived?: (message: NetworkMessage, fromPeerId: string) => void
  onError?: (code: string, message: string) => void
}

// ─── Game Client Hook ───────────────────────────────────────────────────────

export interface UseGameClientReturn {
  state: GameClientState
  setPlayerName: (name: string) => void
  startDiscovery: (port?: number) => Promise<void>
  stopDiscovery: () => Promise<void>
  connectToPeer: (peerId: string) => Promise<void>
  disconnectFromPeer: (peerId: string) => Promise<void>
  sendMessage: (message: NetworkMessage, targetPeerId?: string) => void
  broadcastMessage: (message: NetworkMessage) => void
}

const CALLBACK_REGISTRY = new Set<GameClientCallbacks>()
let globalSubscriptionId: number | null = null

function ensureIdentityInitialized() {
  const store = useGameStore.getState()

  let deviceId = store.deviceId
  if (!deviceId) {
    const storedId = mmkvStorage.getItem('p2p_device_id')
    if (typeof storedId === 'string' && storedId.length > 0) {
      deviceId = storedId
    } else {
      deviceId = `device_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`
      mmkvStorage.setItem('p2p_device_id', deviceId)
    }
    store.setDeviceId(deviceId)
  }

  if (!store.playerName) {
    store.setPlayerName(`Player ${Math.floor(Math.random() * 999)}`)
  }
}

function notifyCallbacks(fn: (callbacks: GameClientCallbacks) => void) {
  CALLBACK_REGISTRY.forEach((callbacks) => {
    fn(callbacks)
  })
}

function handleP2PEvent(event: P2PEvent) {
  const store = useGameStore.getState()

  switch (event.type) {
    case P2PEventType.PeerDiscovered:
      store.setPeers(p2p.getDiscoveredPeers())
      notifyCallbacks((callbacks) => callbacks.onPeerDiscovered?.(event.peer))
      break

    case P2PEventType.PeerLost:
      store.setPeers(p2p.getDiscoveredPeers())
      break

    case P2PEventType.PeerConnected:
      store.setConnectedPeers(p2p.getConnectedPeers())
      store.setIsConnected(true)

      p2p.sendToPeer(
        event.peer.id,
        JSON.stringify({
          type: 'HELLO',
          deviceId: store.deviceId,
          playerName: store.playerName,
        } satisfies NetworkMessage)
      )

      notifyCallbacks((callbacks) => callbacks.onPeerConnected?.(event.peer))
      break

    case P2PEventType.PeerDisconnected:
      store.setConnectedPeers(p2p.getConnectedPeers())
      store.setPeers(p2p.getDiscoveredPeers())
      store.setIsConnected(p2p.getConnectedPeers().length > 0)
      notifyCallbacks((callbacks) => callbacks.onPeerDisconnected?.(event.peerId))
      break

    case P2PEventType.MessageReceived:
      try {
        const message = JSON.parse(event.message.data) as NetworkMessage
        store.enqueueNetworkMessage(message, event.message.fromPeerId)
        notifyCallbacks((callbacks) => callbacks.onMessageReceived?.(message, event.message.fromPeerId))
      } catch (e) {
        store.setNetworkError('PARSE_FAILED', String(e))
      }
      break

    case P2PEventType.Error:
      store.setNetworkError(event.code, event.message)
      notifyCallbacks((callbacks) => callbacks.onError?.(event.code, event.message))
      break
  }
}

function ensureSubscription() {
  ensureIdentityInitialized()

  if (globalSubscriptionId !== null) {
    return
  }

  globalSubscriptionId = p2p.subscribe(handleP2PEvent)
}

export function useGameClient(callbacks?: GameClientCallbacks): UseGameClientReturn {
  const peers = useGameStore((state) => state.peers)
  const connectedPeers = useGameStore((state) => state.connectedPeers)
  const isConnected = useGameStore((state) => state.isConnected)
  const isHost = useGameStore((state) => state.isHost)
  const deviceId = useGameStore((state) => state.deviceId)
  const playerName = useGameStore((state) => state.playerName)

  const setPeers = useGameStore((state) => state.setPeers)
  const setConnectedPeers = useGameStore((state) => state.setConnectedPeers)
  const setIsConnected = useGameStore((state) => state.setIsConnected)
  const setIsDiscovering = useGameStore((state) => state.setIsDiscovering)
  const setIsHost = useGameStore((state) => state.setIsHost)
  const setPlayerNameInStore = useGameStore((state) => state.setPlayerName)
  const setNetworkError = useGameStore((state) => state.setNetworkError)

  useEffect(() => {
    ensureSubscription()
    if (callbacks) {
      CALLBACK_REGISTRY.add(callbacks)
    }

    return () => {
      if (callbacks) {
        CALLBACK_REGISTRY.delete(callbacks)
      }
    }
  }, [callbacks])

  const setPlayerName = useCallback((name: string) => {
    setPlayerNameInStore(name)
    p2p.setDeviceName(name)
  }, [setPlayerNameInStore])

  // Start P2P discovery
  const startDiscovery = useCallback(async (port?: number) => {
    try {
      ensureSubscription()
      p2p.setDeviceName(playerName)
      p2p.start(port)
      setIsDiscovering(true)
      setIsHost(true)
      setPeers(p2p.getDiscoveredPeers())
      setConnectedPeers(p2p.getConnectedPeers())
    } catch (e) {
      setNetworkError('START_FAILED', String(e))
    }
  }, [playerName, setConnectedPeers, setIsDiscovering, setIsHost, setNetworkError, setPeers])

  // Stop P2P discovery
  const stopDiscovery = useCallback(async () => {
    try {
      p2p.stop()
      setIsDiscovering(false)
      setIsConnected(false)
      setIsHost(false)
      setPeers([])
      setConnectedPeers([])
    } catch (e) {
      setNetworkError('STOP_FAILED', String(e))
    }
  }, [setConnectedPeers, setIsConnected, setIsDiscovering, setIsHost, setNetworkError, setPeers])

  // Connect to a peer
  const connectToPeer = useCallback(async (peerId: string) => {
    try {
      ensureSubscription()
      p2p.connect(peerId)
    } catch (e) {
      setNetworkError('CONNECT_FAILED', String(e))
    }
  }, [setNetworkError])

  // Disconnect from a peer
  const disconnectFromPeer = useCallback(async (peerId: string) => {
    try {
      p2p.disconnect(peerId)
    } catch (e) {
      setNetworkError('DISCONNECT_FAILED', String(e))
    }
  }, [setNetworkError])

  // Send message to specific peer
  const sendMessage = useCallback((message: NetworkMessage, targetPeerId?: string) => {
    const json = JSON.stringify(message)
    if (targetPeerId) {
      p2p.sendToPeer(targetPeerId, json)
      return
    }
    p2p.broadcast(json)
  }, [])

  // Broadcast message to all connected peers
  const broadcastMessage = useCallback((message: NetworkMessage) => {
    const json = JSON.stringify(message)
    p2p.broadcast(json)
  }, [])

  return {
    state: {
      peers,
      connectedPeers,
      isConnected,
      isHost,
      deviceId,
      playerName,
    },
    setPlayerName,
    startDiscovery,
    stopDiscovery,
    connectToPeer,
    disconnectFromPeer,
    sendMessage,
    broadcastMessage,
  }
}

// ─── Game Synchronization (Deterministic Lockstep) ───────────────────────

export interface GameSyncState {
  moveHistory: NetworkMessage[]
  currentMoveIndex: number
  isSynced: boolean
}

export function useGameSync() {
  const [syncState, setSyncState] = useState<GameSyncState>({
    moveHistory: [],
    currentMoveIndex: 0,
    isSynced: true,
  })

  const addMove = useCallback((move: NetworkMessage) => {
    setSyncState((prev) => ({
      ...prev,
      moveHistory: [...prev.moveHistory, move],
      currentMoveIndex: prev.currentMoveIndex + 1,
    }))
  }, [])

  const syncMove = useCallback((move: NetworkMessage) => {
    // For deterministic lockstep, both players should receive the same moves
    // We just add it to history and the physics engine will process it identically
    addMove(move)
  }, [addMove])

  const requestSync = useCallback((moveIndex: number) => {
    const syncMsg: NetworkMessage = {
      type: 'SYNC_REQUEST',
      moveIndex,
    }
    // Send to all connected peers
    return syncMsg
  }, [])

  const respondToSync = useCallback(() => {
    const syncResponse: NetworkMessage = {
      type: 'SYNC_RESPONSE',
      moves: syncState.moveHistory,
    }
    return syncResponse
  }, [syncState.moveHistory])

  const resetSync = useCallback(() => {
    setSyncState({
      moveHistory: [],
      currentMoveIndex: 0,
      isSynced: true,
    })
  }, [])

  return {
    syncState,
    addMove,
    syncMove,
    requestSync,
    respondToSync,
    resetSync,
  }
}
