import {
  Canvas,
  Group,
  Rect,
  Circle,
  Line,
  RadialGradient,
} from '@shopify/react-native-skia'
import {
  TABLE_WIDTH,
  TABLE_HEIGHT,
  TABLE_BORDER,
  BALL_RADIUS,
  POCKET_RADIUS,
  POCKET_POSITIONS,
  type BallId,
} from '../physics/index'
import type { SharedValue } from 'react-native-reanimated'

export interface BallSharedState {
  x: SharedValue<number>
  y: SharedValue<number>
  vx: SharedValue<number>
  vy: SharedValue<number>
  visible: SharedValue<boolean>
  pocketedProgress: SharedValue<number>
}

export interface BallRenderItem {
  id: BallId
  state: BallSharedState
}

const BALL_COLORS: Record<string, string> = {
  'cue-ball': '#f8f8f8',
  '1': '#f4d000',
  '2': '#1f5cff',
  '3': '#d62828',
  '4': '#7b2cbf',
  '5': '#ff7f11',
  '6': '#1b8f3a',
  '7': '#6f1d1b',
  '8': '#111111',
  '9': '#f4d000',
  '10': '#1f5cff',
  '11': '#d62828',
  '12': '#7b2cbf',
  '13': '#ff7f11',
  '14': '#1b8f3a',
  '15': '#6f1d1b',
}

const STRIPE_IDS = new Set(['9', '10', '11', '12', '13', '14', '15'])

class ColorTone {
  public static lighten(hex: string, amount: number): string {
    const [r, g, b] = this.toRgb(hex)
    const nr = Math.min(255, Math.round(r + (255 - r) * amount))
    const ng = Math.min(255, Math.round(g + (255 - g) * amount))
    const nb = Math.min(255, Math.round(b + (255 - b) * amount))
    return this.toHex(nr, ng, nb)
  }

  public static darken(hex: string, amount: number): string {
    const [r, g, b] = this.toRgb(hex)
    const nr = Math.max(0, Math.round(r * (1 - amount)))
    const ng = Math.max(0, Math.round(g * (1 - amount)))
    const nb = Math.max(0, Math.round(b * (1 - amount)))
    return this.toHex(nr, ng, nb)
  }

  private static toRgb(hex: string): [number, number, number] {
    return [
      Number.parseInt(hex.slice(1, 3), 16),
      Number.parseInt(hex.slice(3, 5), 16),
      Number.parseInt(hex.slice(5, 7), 16),
    ]
  }

  private static toHex(r: number, g: number, b: number): string {
    return `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`
  }
}

function Ball({ id, state }: { id: BallId; state: BallSharedState }) {
  const color = BALL_COLORS[id] ?? '#f4d000'
  const stripe = STRIPE_IDS.has(id)
  const pocketedProgress = Math.min(Math.max(state.pocketedProgress.value, 0), 1)
  const visible = state.visible.value || pocketedProgress < 1
  const fadeScale = state.visible.value ? 1 : Math.max(0.15, 1 - 0.85 * pocketedProgress)
  const fadeOpacity = state.visible.value ? 1 : Math.max(0, 1 - pocketedProgress)
  const speed = Math.sqrt(state.vx.value * state.vx.value + state.vy.value * state.vy.value)
  const rollAmount = Math.min(speed / 24, 1)
  const spinOffsetX = state.vx.value * 0.32
  const spinOffsetY = state.vy.value * 0.32

  if (!visible) {
    return null
  }

  return (
    <Group
      transform={[
        { translateX: state.x.value },
        { translateY: state.y.value },
        { scale: fadeScale },
      ]}
      opacity={fadeOpacity}
    >
      <Circle cx={0} cy={0} r={BALL_RADIUS}>
        {id === 'cue-ball' ? (
          <RadialGradient
            c={{ x: -BALL_RADIUS * 0.2, y: -BALL_RADIUS * 0.35 }}
            r={BALL_RADIUS * 1.4}
            colors={['#ffffff', '#f0f0f0', '#cbcbcb']}
          />
        ) : (
          <RadialGradient
            c={{ x: -BALL_RADIUS * 0.2, y: -BALL_RADIUS * 0.35 }}
            r={BALL_RADIUS * 1.4}
            colors={[ColorTone.lighten(color, 0.35), color, ColorTone.darken(color, 0.28)]}
          />
        )}
      </Circle>

      {stripe && (
        <>
          {/* Bold ring makes stripe balls immediately distinguishable at a glance. */}
          <Circle cx={0} cy={0} r={BALL_RADIUS * 0.95} color={color} opacity={0.92} />
          <Circle cx={0} cy={0} r={BALL_RADIUS * 0.66} color="#f8f8f8" opacity={0.98} />
          <Rect
            x={-BALL_RADIUS * 0.92 + spinOffsetX * 0.25}
            y={-BALL_RADIUS * 0.22 + spinOffsetY * 0.25}
            width={BALL_RADIUS * 1.84}
            height={BALL_RADIUS * 0.44}
            color={color}
            opacity={0.9}
          />
        </>
      )}

      {id !== 'cue-ball' && (
        <Circle
          cx={spinOffsetX * 0.2}
          cy={spinOffsetY * 0.2}
          r={BALL_RADIUS * (0.33 - rollAmount * 0.03)}
          color={id === '8' ? '#f2f2f2' : '#fff8dc'}
        />
      )}

      <Circle
        cx={-BALL_RADIUS * 0.32 - spinOffsetX * 0.18}
        cy={-BALL_RADIUS * 0.4 - spinOffsetY * 0.18}
        r={BALL_RADIUS * 0.12}
        color="rgba(255,255,255,0.8)"
      />
    </Group>
  )
}

function TableBed() {
  const playingX = TABLE_BORDER
  const playingY = TABLE_BORDER
  const playingW = TABLE_WIDTH - TABLE_BORDER * 2
  const playingH = TABLE_HEIGHT - TABLE_BORDER * 2

  return (
    <Group>
      <Rect x={0} y={0} width={TABLE_WIDTH} height={TABLE_HEIGHT} color="#3e2a1b" />
      <Rect x={8} y={8} width={TABLE_WIDTH - 16} height={TABLE_HEIGHT - 16} color="#5a3a24" />

      <Rect x={playingX} y={playingY} width={playingW} height={playingH}>
        <RadialGradient
          c={{ x: TABLE_WIDTH / 2, y: TABLE_HEIGHT / 2 }}
          r={TABLE_WIDTH * 0.7}
          colors={['#2f7b4b', '#1e5f39', '#12472b']}
        />
      </Rect>
    </Group>
  )
}

function TableMarkers() {
  const markerColor = 'rgba(240,230,210,0.95)'
  const xLeft = TABLE_BORDER + 6
  const xRight = TABLE_WIDTH - TABLE_BORDER - 6
  const yStep = (TABLE_HEIGHT - TABLE_BORDER * 2) / 4

  return (
    <Group>
      {[1, 2, 3].map((n) => {
        const y = TABLE_BORDER + yStep * n
        return (
          <Group key={`diamond-${n}`}>
            <Circle cx={xLeft} cy={y} r={4} color={markerColor} />
            <Circle cx={xRight} cy={y} r={4} color={markerColor} />
          </Group>
        )
      })}

      <Line
        p1={{ x: TABLE_BORDER + 18, y: TABLE_HEIGHT * 0.68 }}
        p2={{ x: TABLE_WIDTH - TABLE_BORDER - 18, y: TABLE_HEIGHT * 0.68 }}
        color="rgba(255,255,255,0.18)"
        strokeWidth={2}
      />

      <Circle
        cx={TABLE_WIDTH / 2}
        cy={TABLE_HEIGHT * 0.78}
        r={3}
        color="rgba(255,255,255,0.55)"
      />

      <Circle
        cx={TABLE_WIDTH / 2}
        cy={TABLE_HEIGHT * 0.28}
        r={3}
        color="rgba(255,255,255,0.55)"
      />
    </Group>
  )
}

function Pockets() {
  return (
    <>
      {POCKET_POSITIONS.map((pocket, index) => (
        <Group key={`pocket-${index}`} transform={[{ translateX: pocket.x }, { translateY: pocket.y }]}> 
          <Circle cx={0} cy={0} r={POCKET_RADIUS + 8} color="#2d1b10" />
          <Circle cx={0} cy={0} r={POCKET_RADIUS + 2} color="#0f0f0f" />
          <Circle cx={0} cy={0} r={POCKET_RADIUS - 8} color="#000000" />
        </Group>
      ))}
    </>
  )
}

interface PoolTableProps {
  balls: BallRenderItem[]
  width: number
  height: number
  scale?: number
  offsetX?: number
  offsetY?: number
}

export function PoolTable({ balls, width, height, scale: scaleProp, offsetX: offsetXProp, offsetY: offsetYProp }: PoolTableProps) {
  const safeWidth = Math.max(1, width)
  const safeHeight = Math.max(1, height)

  const scaleX = safeWidth / TABLE_WIDTH
  const scaleY = safeHeight / TABLE_HEIGHT
  const scale = scaleProp ?? Math.min(scaleX, scaleY, 1)

  const scaledWidth = TABLE_WIDTH * scale
  const scaledHeight = TABLE_HEIGHT * scale
  const offsetX = offsetXProp ?? (safeWidth - scaledWidth) / 2
  const offsetY = offsetYProp ?? (safeHeight - scaledHeight) / 2

  return (
    <Canvas style={{ width: safeWidth, height: safeHeight }}>
      <Group transform={[{ translateX: offsetX }, { translateY: offsetY }, { scale }]}> 
        <TableBed />
        <TableMarkers />
        <Pockets />

        {balls.map((ball) => (
          <Ball key={ball.id} id={ball.id} state={ball.state} />
        ))}
      </Group>
    </Canvas>
  )
}
