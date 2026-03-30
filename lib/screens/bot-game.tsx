import { useEffect, useState, useRef, useCallback } from 'react'
import { View, Text, StyleSheet, TouchableOpacity, ScrollView } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import Animated, { makeMutable, useAnimatedStyle, useDerivedValue, useSharedValue } from 'react-native-reanimated'
import {
  initPhysics,
  stepPhysics,
  shoot,
  checkCueBallPocketed,
  resetCueBall,
  isBallsMoving,
  resetPhysics,
  TABLE_WIDTH,
  TABLE_HEIGHT,
  type BallId,
  getInitialBallPositions,
} from '../game/physics/index'
import { PoolTable } from '../game/components/pool-table'
import type { BallRenderItem, BallSharedState } from '../game/components/pool-table'
import { Cue, SkiaCue } from '../game/components/cue'
import { useGameStore } from '../game/store/game-store'

interface BotGameScreenProps {
  onBack: () => void
}

export function BotGameScreen({ onBack }: BotGameScreenProps) {
  const [isTableMoving, setIsTableMoving] = useState(false)
  const [tableLayout, setTableLayout] = useState({ width: 0, height: 0 })
  const [showDebugPanel, setShowDebugPanel] = useState(false)

  const cueVisibleSv = useSharedValue(true)
  const cueIsAimingSv = useSharedValue(false)
  const cueAngleSv = useSharedValue(-Math.PI / 2)
  const cuePowerSv = useSharedValue(0)

  const initialPositions = getInitialBallPositions()
  const ballStateRef = useRef<Record<BallId, BallSharedState> | null>(null)
  const ballsRef = useRef<BallRenderItem[]>([])

  if (!ballStateRef.current) {
    const sharedState = {} as Record<BallId, BallSharedState>

    Object.entries(initialPositions).forEach(([id, ball]) => {
      const ballId = id as BallId
      sharedState[ballId] = {
        x: makeMutable(ball.x),
        y: makeMutable(ball.y),
        vx: makeMutable(ball.vx),
        vy: makeMutable(ball.vy),
        visible: makeMutable(!ball.pocketed),
        pocketedProgress: makeMutable(0),
      }
    })

    ballStateRef.current = sharedState
    ballsRef.current = (Object.keys(sharedState) as BallId[]).map((id) => ({
      id,
      state: sharedState[id],
    }))
  }

  const ballState = ballStateRef.current
  const balls = ballsRef.current

  const animationFrame = useRef<number>(0)
  const lastShotTime = useRef<number>(0)
  const lastStoreSyncTime = useRef(0)
  const botShotTimeout = useRef<ReturnType<typeof setTimeout> | null>(null)
  const botWindupTimeout = useRef<ReturnType<typeof setTimeout> | null>(null)
  const turnRef = useRef<'player1' | 'player2'>('player1')
  const gameOverRef = useRef(false)
  const isTableMovingRef = useRef(false)
  const hasPlayerTakenFirstShotRef = useRef(false)
  const pendingTurnSwitchRef = useRef<'player1' | 'player2' | null>(null)
  const lastFrameTimeRef = useRef<number>(0)

  const cueBallX = useDerivedValue(() => ballState['cue-ball']?.x.value ?? TABLE_WIDTH / 2)
  const cueBallY = useDerivedValue(() => ballState['cue-ball']?.y.value ?? TABLE_HEIGHT * 0.8)

  const turn = useGameStore((state) => state.turn)
  const gameOver = useGameStore((state) => state.gameOver)
  const winner = useGameStore((state) => state.winner)
  const storeBallKinematics = useGameStore((state) => state.balls)
  const updateBallPositions = useGameStore((state) => state.updateBallPositions)
  const addMove = useGameStore((state) => state.addMove)
  const setTurn = useGameStore((state) => state.setTurn)
  const setGameOver = useGameStore((state) => state.setGameOver)
  const resetGame = useGameStore((state) => state.resetGame)

  useEffect(() => {
    turnRef.current = turn
  }, [turn])

  useEffect(() => {
    gameOverRef.current = gameOver
  }, [gameOver])

  const getPocketedBallIds = () => {
    return balls
      .filter((ball) => ball.id !== 'cue-ball' && !ball.state.visible.value)
      .map((ball) => ball.id)
  }

  const runGameLoopFrame = useCallback(() => {
    const frameNow = typeof performance !== 'undefined' ? performance.now() : Date.now()
    const frameDeltaMs = Math.min(34, Math.max(8, frameNow - (lastFrameTimeRef.current || frameNow)))
    lastFrameTimeRef.current = frameNow

    const positions = stepPhysics()

    balls.forEach((ball) => {
      const next = positions[ball.id]
      if (!next) return
      ball.state.x.value = next.x
      ball.state.y.value = next.y
      ball.state.vx.value = next.vx
      ball.state.vy.value = next.vy
      ball.state.visible.value = next.visible
      if (next.visible) {
        ball.state.pocketedProgress.value = 0
      } else {
        const nextProgress = ball.state.pocketedProgress.value + frameDeltaMs / 240
        ball.state.pocketedProgress.value = Math.min(1, nextProgress)
      }
    })

    const now = Date.now()
    if (now - lastStoreSyncTime.current > 120) {
      updateBallPositions(positions)
      lastStoreSyncTime.current = now
    }

    if (checkCueBallPocketed(positions)) {
      resetCueBall()
    }

    const moving = isBallsMoving()

    if (moving !== isTableMovingRef.current) {
      isTableMovingRef.current = moving
      setIsTableMoving(moving)
    }

    if (!moving && pendingTurnSwitchRef.current) {
      const nextTurn = pendingTurnSwitchRef.current
      pendingTurnSwitchRef.current = null
      turnRef.current = nextTurn
      setTurn(nextTurn)
    }

    if (
      hasPlayerTakenFirstShotRef.current &&
      !moving &&
      turnRef.current === 'player2' &&
      !gameOverRef.current &&
      !botShotTimeout.current &&
      !botWindupTimeout.current
    ) {
      botShotTimeout.current = setTimeout(() => {
        botShotTimeout.current = null
        if (isBallsMoving() || gameOverRef.current || turnRef.current !== 'player2') return

        const randomAngle = Math.random() * Math.PI * 2
        const randomPower = 58 + Math.random() * 52
        cueVisibleSv.value = true
        cueIsAimingSv.value = true
        cueAngleSv.value = randomAngle
        cuePowerSv.value = randomPower

        botWindupTimeout.current = setTimeout(() => {
          botWindupTimeout.current = null
          handleShot(randomAngle, randomPower, { actor: 'player2' })
        }, 280)
      }, 600)
    }

    if ((moving || turnRef.current !== 'player2') && botShotTimeout.current) {
      clearTimeout(botShotTimeout.current)
      botShotTimeout.current = null
    }

    if ((moving || turnRef.current !== 'player2') && botWindupTimeout.current) {
      clearTimeout(botWindupTimeout.current)
      botWindupTimeout.current = null
      cueIsAimingSv.value = false
      cuePowerSv.value = 0
    }

    if (!moving && positions['8']?.visible === false && !gameOverRef.current) {
      const currentWinner = turnRef.current === 'player1' ? 'player2' : 'player1'
      gameOverRef.current = true
      setGameOver(currentWinner)
    }

    animationFrame.current = requestAnimationFrame(runGameLoopFrame)
  }, [balls, cueAngleSv, cueIsAimingSv, cuePowerSv, cueVisibleSv, setGameOver, setTurn, updateBallPositions])

  useEffect(() => {
    async function init() {
      await initPhysics()
      turnRef.current = 'player1'
      setTurn('player1')
      hasPlayerTakenFirstShotRef.current = false
      animationFrame.current = requestAnimationFrame(runGameLoopFrame)
    }
    init()

    return () => {
      cancelAnimationFrame(animationFrame.current)
      if (botShotTimeout.current) clearTimeout(botShotTimeout.current)
      if (botWindupTimeout.current) clearTimeout(botWindupTimeout.current)
    }
  }, [runGameLoopFrame, setTurn])

  const cueBallVisible = ballState['cue-ball']?.visible.value ?? true
  const canLocalPlayerShoot = !gameOver && !isTableMoving && cueBallVisible && turn === 'player1'
  const tableWidth = tableLayout.width
  const tableHeight = tableLayout.height
  const tableScale = tableWidth > 0 && tableHeight > 0
    ? Math.min(tableWidth / TABLE_WIDTH, tableHeight / TABLE_HEIGHT, 1)
    : 1
  const tableOffsetX = tableWidth > 0 ? (tableWidth - TABLE_WIDTH * tableScale) / 2 : 0
  const tableOffsetY = tableHeight > 0 ? (tableHeight - TABLE_HEIGHT * tableScale) / 2 : 0

  const debugBallOrder: BallId[] = [
    'cue-ball',
    '1', '2', '3', '4', '5', '6', '7', '8',
    '9', '10', '11', '12', '13', '14', '15',
  ]

  const debugRows = showDebugPanel
    ? debugBallOrder.map((id) => {
      const shared = ballState[id]
      const fromStore = storeBallKinematics[id]
      const x = fromStore?.x ?? shared?.x.value ?? 0
      const y = fromStore?.y ?? shared?.y.value ?? 0
      const vx = fromStore?.vx ?? shared?.vx.value ?? 0
      const vy = fromStore?.vy ?? shared?.vy.value ?? 0
      const visible = fromStore?.visible ?? shared?.visible.value ?? false
      const speed = Math.sqrt(vx * vx + vy * vy)
      return { id, x, y, vx, vy, speed, visible }
    })
    : []

  const handleShot = (angle: number, power: number, options?: { actor?: 'player1' | 'player2' }) => {
    const now = Date.now()
    if (now - lastShotTime.current < 500) return
    lastShotTime.current = now

    const actor = options?.actor ?? turnRef.current
    if (actor === 'player2' && !hasPlayerTakenFirstShotRef.current) return

    const localCanShoot = !gameOverRef.current && !isTableMovingRef.current && cueBallVisible
    if (!localCanShoot && actor === 'player1') return

    if (actor === 'player1' && !hasPlayerTakenFirstShotRef.current) {
      hasPlayerTakenFirstShotRef.current = true
    }

    shoot(angle, power)
    cueVisibleSv.value = false
    cueIsAimingSv.value = false
    cuePowerSv.value = 0
    pendingTurnSwitchRef.current = turnRef.current === 'player1' ? 'player2' : 'player1'

    addMove({
      playerId: actor,
      angle,
      power,
      pocketedBalls: getPocketedBallIds(),
      cueBallPocketed: false,
    })
  }

  const handleReset = () => {
    resetPhysics()
    resetGame()
    gameOverRef.current = false
    turnRef.current = 'player1'
    setTurn('player1')
    if (botShotTimeout.current) {
      clearTimeout(botShotTimeout.current)
      botShotTimeout.current = null
    }
    if (botWindupTimeout.current) {
      clearTimeout(botWindupTimeout.current)
      botWindupTimeout.current = null
    }
    cueVisibleSv.value = false
    cueIsAimingSv.value = false
    cuePowerSv.value = 0
    hasPlayerTakenFirstShotRef.current = false
    pendingTurnSwitchRef.current = null
    setIsTableMoving(false)
    isTableMovingRef.current = false

    const positions = stepPhysics()
    balls.forEach((ball) => {
      const next = positions[ball.id]
      if (!next) return
      ball.state.x.value = next.x
      ball.state.y.value = next.y
      ball.state.vx.value = next.vx
      ball.state.vy.value = next.vy
      ball.state.visible.value = next.visible
    })
    updateBallPositions(positions)
  }

  const powerHudStyle = useAnimatedStyle(() => {
    const active = cueIsAimingSv.value && canLocalPlayerShoot
    return { opacity: active ? 1 : 0 }
  })

  const powerFillStyle = useAnimatedStyle(() => {
    const ratio = Math.min(Math.max(cuePowerSv.value / 120, 0), 1)
    return { width: `${Math.round(ratio * 100)}%` }
  })

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={onBack} style={styles.backButton}>
          <Text style={styles.backButtonText}>← Back</Text>
        </TouchableOpacity>
        <View style={styles.turnIndicator}>
          <Text style={styles.turnText}>
            {gameOver ? (
              winner === 'player1' ? 'You Win!' : 'Bot Wins!'
            ) : (
              `${turn === 'player1' ? 'Your' : 'Bot'} Turn`
            )}
          </Text>
        </View>
        <View style={styles.headerActions}>
          <TouchableOpacity onPress={() => setShowDebugPanel((value) => !value)} style={styles.debugToggleButton}>
            <Text style={styles.debugToggleText}>{showDebugPanel ? 'Hide Debug' : 'Show Debug'}</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={handleReset} style={styles.resetButton}>
            <Text style={styles.resetButtonText}>Reset</Text>
          </TouchableOpacity>
        </View>
      </View>

      <View style={styles.tableContainer}>
        <View
          style={StyleSheet.absoluteFill}
          onLayout={(event) => {
            const { width, height } = event.nativeEvent.layout
            setTableLayout({ width, height })
          }}
        />

        <PoolTable
          balls={balls}
          width={tableWidth}
          height={tableHeight}
          scale={tableScale}
          offsetX={tableOffsetX}
          offsetY={tableOffsetY}
        />

        {cueBallVisible && (
          <SkiaCue
            cueBallX={cueBallX}
            cueBallY={cueBallY}
            cueVisible={cueVisibleSv}
            cueIsAiming={cueIsAimingSv}
            cueAngle={cueAngleSv}
            cuePower={cuePowerSv}
            scale={tableScale}
            offsetX={tableOffsetX}
            offsetY={tableOffsetY}
          />
        )}

        <Cue
          cueBallX={cueBallX}
          cueBallY={cueBallY}
          onShoot={handleShot}
          cueVisible={cueVisibleSv}
          cueIsAiming={cueIsAimingSv}
          cueAngle={cueAngleSv}
          cuePower={cuePowerSv}
          scale={tableScale}
          offsetX={tableOffsetX}
          offsetY={tableOffsetY}
          canShoot={canLocalPlayerShoot}
        />

        <Animated.View style={[styles.powerHud, powerHudStyle]} pointerEvents="none">
          <Text style={styles.powerLabel}>Power</Text>
          <View style={styles.powerTrack}>
            <Animated.View style={[styles.powerFill, powerFillStyle]} />
          </View>
        </Animated.View>

        {showDebugPanel && (
          <View style={styles.debugPanel} pointerEvents="none">
            <Text style={styles.debugTitle}>Ball Debug</Text>
            <ScrollView style={styles.debugScroll} contentContainerStyle={styles.debugScrollContent}>
              {debugRows.map((row) => (
                <Text key={`debug-${row.id}`} style={styles.debugLine}>
                  {`${row.id.padEnd(8, ' ')} x:${row.x.toFixed(1).padStart(6, ' ')} y:${row.y.toFixed(1).padStart(6, ' ')} `
                  + `vx:${row.vx.toFixed(2).padStart(6, ' ')} vy:${row.vy.toFixed(2).padStart(6, ' ')} `
                  + `s:${row.speed.toFixed(2).padStart(6, ' ')} ${row.visible ? 'on' : 'off'}`}
                </Text>
              ))}
            </ScrollView>
          </View>
        )}
      </View>

      {gameOver && (
        <View style={styles.gameOverOverlay}>
          <Text style={styles.gameOverText}>{winner === 'player1' ? 'You Win!' : 'Bot Wins!'}</Text>
          <TouchableOpacity onPress={handleReset} style={styles.playAgainButton}>
            <Text style={styles.playAgainButtonText}>Play Again</Text>
          </TouchableOpacity>
        </View>
      )}
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#1a1a2e',
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#2d2d44',
  },
  backButton: {
    padding: 8,
  },
  backButtonText: {
    color: '#ffffff',
    fontSize: 16,
  },
  turnIndicator: {
    paddingHorizontal: 20,
    paddingVertical: 8,
    borderRadius: 20,
    backgroundColor: '#2d2d44',
  },
  turnText: {
    color: '#4CAF50',
    fontWeight: 'bold',
    fontSize: 16,
  },
  headerActions: {
    alignItems: 'flex-end',
    gap: 6,
  },
  debugToggleButton: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 8,
    backgroundColor: '#2d2d44',
  },
  debugToggleText: {
    color: '#b7d3ff',
    fontSize: 11,
    fontWeight: '700',
  },
  resetButton: {
    padding: 8,
  },
  resetButtonText: {
    color: '#8888aa',
    fontSize: 16,
  },
  tableContainer: {
    flex: 1,
    position: 'relative',
  },
  powerHud: {
    position: 'absolute',
    left: 18,
    right: 18,
    bottom: 18,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 12,
    backgroundColor: 'rgba(10, 12, 28, 0.72)',
  },
  powerLabel: {
    color: '#d8defa',
    fontSize: 13,
    marginBottom: 8,
    fontWeight: '600',
  },
  powerTrack: {
    height: 10,
    borderRadius: 8,
    backgroundColor: 'rgba(255,255,255,0.2)',
    overflow: 'hidden',
  },
  powerFill: {
    height: '100%',
    borderRadius: 8,
    backgroundColor: '#4CAF50',
  },
  debugPanel: {
    position: 'absolute',
    right: 8,
    top: 8,
    width: 330,
    maxHeight: 250,
    borderRadius: 10,
    padding: 8,
    backgroundColor: 'rgba(0, 0, 0, 0.72)',
    borderWidth: 1,
    borderColor: 'rgba(180, 200, 255, 0.25)',
  },
  debugTitle: {
    color: '#d8defa',
    fontSize: 12,
    fontWeight: '700',
    marginBottom: 6,
  },
  debugScroll: {
    maxHeight: 220,
  },
  debugScrollContent: {
    paddingBottom: 6,
  },
  debugLine: {
    color: '#d8defa',
    fontSize: 10,
    lineHeight: 14,
    fontFamily: 'Courier',
  },
  gameOverOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(0, 0, 0, 0.8)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  gameOverText: {
    color: '#ffffff',
    fontSize: 32,
    fontWeight: 'bold',
    marginBottom: 20,
  },
  playAgainButton: {
    paddingHorizontal: 40,
    paddingVertical: 16,
    borderRadius: 12,
    backgroundColor: '#4CAF50',
  },
  playAgainButtonText: {
    color: '#ffffff',
    fontSize: 18,
    fontWeight: 'bold',
  },
})
