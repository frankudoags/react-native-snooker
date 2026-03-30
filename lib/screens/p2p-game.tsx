import { GameScreen } from './game'

interface P2PGameScreenProps {
  onBack: () => void
}

export function P2PGameScreen({ onBack }: P2PGameScreenProps) {
  return <GameScreen onBack={onBack} />
}
