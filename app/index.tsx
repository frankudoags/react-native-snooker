import { useState } from 'react'
import { Lobby } from '../lib/screens/lobby'
import { P2PGameScreen } from '../lib/screens/p2p-game'
import { BotGameScreen } from '../lib/screens/bot-game'
import { useGameClient } from '../lib/game/networking/game-client'
import { useGameStore } from '../lib/game/store/game-store'

// ─── Entry Screen ───────────────────────────────────────────────────────────

type Screen = 'lobby' | 'p2p-game' | 'bot-game'

export default function IndexScreen() {
  const [screen, setScreen] = useState<Screen>('lobby')
  const {
    state: { peers, connectedPeers, playerName },
    startDiscovery,
    stopDiscovery,
    connectToPeer,
  } = useGameClient()
  const isDiscovering = useGameStore((state) => state.isDiscovering)

  const handleConnect = (peerId: string) => {
    void connectToPeer(peerId)
  }

  const handleStartDiscovery = () => {
    void startDiscovery()
  }

  const handleStopDiscovery = () => {
    void stopDiscovery()
  }

  const handleHostGame = () => {
    setScreen('p2p-game')
  }

  const handlePlayBot = () => {
    setScreen('bot-game')
  }

  const handleBack = () => {
    setScreen('lobby')
  }

  if (screen === 'lobby') {
    return (
      <Lobby
        playerName={playerName}
        peers={peers}
        connectedPeers={connectedPeers}
        onConnect={handleConnect}
        onStartDiscovery={handleStartDiscovery}
        onStopDiscovery={handleStopDiscovery}
        isDiscovering={isDiscovering}
        onHostGame={handleHostGame}
        onPlayBot={handlePlayBot}
      />
    )
  }

  if (screen === 'p2p-game') {
    return <P2PGameScreen onBack={handleBack} />
  }

  return <BotGameScreen onBack={handleBack} />
}
