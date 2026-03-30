import Matter from 'matter-js'

export const TABLE_WIDTH = 820
export const TABLE_HEIGHT = 1280
export const TABLE_BORDER = 30
export const PLAYABLE_WIDTH = TABLE_WIDTH - TABLE_BORDER * 2
export const PLAYABLE_HEIGHT = TABLE_HEIGHT - TABLE_BORDER * 2

export const BALL_RADIUS = 26
export const BALL_MASS = 0.17

export const POCKET_RADIUS = 28
export const POCKET_POSITIONS = [
  { x: TABLE_BORDER, y: TABLE_BORDER },
  { x: TABLE_WIDTH - TABLE_BORDER, y: TABLE_BORDER },
  { x: TABLE_BORDER, y: TABLE_HEIGHT / 2 },
  { x: TABLE_WIDTH - TABLE_BORDER, y: TABLE_HEIGHT / 2 },
  { x: TABLE_BORDER, y: TABLE_HEIGHT - TABLE_BORDER },
  { x: TABLE_WIDTH - TABLE_BORDER, y: TABLE_HEIGHT - TABLE_BORDER },
]

export const BALL_BALL_RESTITUTION = 0.93
export const BALL_CUSHION_RESTITUTION = 0.82
export const FRICTION = 0.012

export type BallType = 'solid' | 'stripe' | 'eight' | 'cue'
export type BallId = 'cue-ball' | `${number}`

export interface Ball {
  id: BallId
  type: BallType
  x: number
  y: number
  vx: number
  vy: number
  pocketed: boolean
}

export interface BallState {
  balls: Record<BallId, Ball>
  turn: 'player1' | 'player2'
  player1Group: 'solids' | 'stripes' | null
  player2Group: 'solids' | 'stripes' | null
  gameOver: boolean
  winner: 'player1' | 'player2' | null
}

export interface BallKinematicsValue {
  x: number
  y: number
  vx: number
  vy: number
  visible: boolean
}

export type BallKinematics = Partial<Record<BallId, BallKinematicsValue>>

const ENGINE_STEP_MS = 1000 / 60
const VELOCITY_STOP_EPSILON = 0.02
const FORCE_SCALE = 0.0026
const RACK_SPACING = BALL_RADIUS * 2.12
const CUE_RESET_CLEARANCE = BALL_RADIUS * 2.1
const LAUNCH_SPEED_MIN = 14
const LAUNCH_SPEED_MAX = 40
const ACCELERATION_TICKS = 3

function distanceSquared(ax: number, ay: number, bx: number, by: number): number {
  const dx = ax - bx
  const dy = ay - by
  return dx * dx + dy * dy
}

function isInsidePocket(x: number, y: number): boolean {
  const pocketRadiusSq = POCKET_RADIUS * POCKET_RADIUS
  for (const pocket of POCKET_POSITIONS) {
    if (distanceSquared(x, y, pocket.x, pocket.y) <= pocketRadiusSq) {
      return true
    }
  }
  return false
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value))
}

function cloneBalls(source: Record<BallId, Ball>): Record<BallId, Ball> {
  const output = {} as Record<BallId, Ball>
  Object.entries(source).forEach(([id, ball]) => {
    output[id as BallId] = { ...ball }
  })
  return output
}

function toKinematics(source: Record<BallId, Ball>): BallKinematics {
  const output: BallKinematics = {}
  Object.entries(source).forEach(([id, ball]) => {
    output[id as BallId] = {
      x: ball.x,
      y: ball.y,
      vx: ball.vx,
      vy: ball.vy,
      visible: !ball.pocketed,
    }
  })
  return output
}

class RackLayout {
  public createInitialBalls(): Record<BallId, Ball> {
    const balls = {
      'cue-ball': this.createCueBallAt(this.getHeadSpot().x, this.getHeadSpot().y),
    } as Record<BallId, Ball>

    const rackRows: BallId[][] = [
      ['1'],
      ['9', '2'],
      ['10', '8', '3'],
      ['11', '7', '14', '4'],
      ['5', '13', '15', '6', '12'],
    ]

    const apex = this.getFootSpot()
    const rowAdvance = RACK_SPACING * 0.5
    const colOffset = Math.sqrt(3) * 0.5 * RACK_SPACING

    rackRows.forEach((row, rowIndex) => {
      const y = apex.y + rowIndex * rowAdvance
      row.forEach((id, colIndex) => {
        const x = apex.x + (colIndex - rowIndex / 2) * colOffset
        balls[id] = {
          id,
          type: this.getBallType(id),
          x: clamp(x, TABLE_BORDER + BALL_RADIUS, TABLE_WIDTH - TABLE_BORDER - BALL_RADIUS),
          y: clamp(y, TABLE_BORDER + BALL_RADIUS, TABLE_HEIGHT - TABLE_BORDER - BALL_RADIUS),
          vx: 0,
          vy: 0,
          pocketed: false,
        }
      })
    })

    return balls
  }

  public getHeadSpot() {
    return {
      x: TABLE_WIDTH / 2,
      y: TABLE_HEIGHT * 0.8,
    }
  }

  private getFootSpot() {
    return {
      x: TABLE_WIDTH / 2,
      y: TABLE_HEIGHT * 0.3,
    }
  }

  private createCueBallAt(x: number, y: number): Ball {
    return {
      id: 'cue-ball',
      type: 'cue',
      x: clamp(x, TABLE_BORDER + BALL_RADIUS, TABLE_WIDTH - TABLE_BORDER - BALL_RADIUS),
      y: clamp(y, TABLE_BORDER + BALL_RADIUS, TABLE_HEIGHT - TABLE_BORDER - BALL_RADIUS),
      vx: 0,
      vy: 0,
      pocketed: false,
    }
  }

  private getBallType(id: BallId): BallType {
    if (id === '8') return 'eight'
    const n = Number(id)
    if (Number.isNaN(n)) return 'cue'
    return n <= 7 ? 'solid' : 'stripe'
  }
}

class TableRailBuilder {
  public createRails(): Matter.Body[] {
    const rails: Matter.Body[] = []
    const thickness = TABLE_BORDER
    const half = thickness / 2

    const cornerGap = POCKET_RADIUS * 1.55
    const sideMiddleGap = POCKET_RADIUS * 1.45

    const topY = half
    const bottomY = TABLE_HEIGHT - half
    const leftX = half
    const rightX = TABLE_WIDTH - half

    const topStart = TABLE_BORDER + cornerGap
    const topEnd = TABLE_WIDTH - TABLE_BORDER - cornerGap

    const sideTopStart = TABLE_BORDER + cornerGap
    const sideTopEnd = TABLE_HEIGHT / 2 - sideMiddleGap * 0.5
    const sideBottomStart = TABLE_HEIGHT / 2 + sideMiddleGap * 0.5
    const sideBottomEnd = TABLE_HEIGHT - TABLE_BORDER - cornerGap

    rails.push(this.createRail((topStart + topEnd) / 2, topY, topEnd - topStart, thickness))
    rails.push(this.createRail((topStart + topEnd) / 2, bottomY, topEnd - topStart, thickness))

    rails.push(this.createRail(leftX, (sideTopStart + sideTopEnd) / 2, thickness, sideTopEnd - sideTopStart))
    rails.push(this.createRail(leftX, (sideBottomStart + sideBottomEnd) / 2, thickness, sideBottomEnd - sideBottomStart))
    rails.push(this.createRail(rightX, (sideTopStart + sideTopEnd) / 2, thickness, sideTopEnd - sideTopStart))
    rails.push(this.createRail(rightX, (sideBottomStart + sideBottomEnd) / 2, thickness, sideBottomEnd - sideBottomStart))

    return rails
  }

  private createRail(cx: number, cy: number, width: number, height: number): Matter.Body {
    return Matter.Bodies.rectangle(cx, cy, width, height, {
      isStatic: true,
      restitution: BALL_CUSHION_RESTITUTION,
      friction: 0,
      frictionStatic: 0,
      label: 'rail',
    })
  }
}

class PoolPhysicsEngine {
  private engine: Matter.Engine | null = null
  private world: Matter.World | null = null
  private ballBodies: Partial<Record<BallId, Matter.Body>> = {}
  private railBodies: Matter.Body[] = []
  private ballsState = {} as Record<BallId, Ball>
  private initialized = false
  private cueAcceleration: { x: number; y: number; ticks: number } | null = null
  private readonly rackLayout = new RackLayout()
  private readonly railBuilder = new TableRailBuilder()

  public getInitialBallPositions(): Record<BallId, Ball> {
    return this.rackLayout.createInitialBalls()
  }

  public async init(): Promise<void> {
    if (this.initialized) return
    this.ballsState = cloneBalls(this.getInitialBallPositions())
    this.rebuildWorld()
    this.initialized = true
  }

  public step(): BallKinematics {
    if (!this.initialized || !this.engine || !this.world) {
      return {}
    }

    Matter.Engine.update(this.engine, ENGINE_STEP_MS)

    if (this.cueAcceleration && this.ballBodies['cue-ball']) {
      const cueBody = this.ballBodies['cue-ball']
      if (cueBody) {
        Matter.Body.applyForce(cueBody, cueBody.position, {
          x: this.cueAcceleration.x,
          y: this.cueAcceleration.y,
        })
      }

      this.cueAcceleration.ticks -= 1
      if (this.cueAcceleration.ticks <= 0) {
        this.cueAcceleration = null
      }
    }

    Object.values(this.ballsState).forEach((ball) => {
      const body = this.ballBodies[ball.id]
      if (!body) return

      ball.x = body.position.x
      ball.y = body.position.y
      ball.vx = body.velocity.x
      ball.vy = body.velocity.y

      const speedSq = ball.vx * ball.vx + ball.vy * ball.vy
      if (speedSq < VELOCITY_STOP_EPSILON * VELOCITY_STOP_EPSILON && !this.cueAcceleration) {
        ball.vx = 0
        ball.vy = 0
        Matter.Body.setVelocity(body, { x: 0, y: 0 })
      }

      if (ball.id !== 'cue-ball' && isInsidePocket(ball.x, ball.y)) {
        ball.pocketed = true
        ball.vx = 0
        ball.vy = 0
        Matter.Composite.remove(this.world!, body)
        delete this.ballBodies[ball.id]
      }
    })

    this.keepCueBallInsideBounds()

    return toKinematics(this.ballsState)
  }

  public shoot(angle: number, power: number, spin?: { x: number; y: number }): void {
    if (!this.initialized || !this.world) return

    const cueBall = this.ballsState['cue-ball']
    const cueBody = this.ballBodies['cue-ball']
    if (!cueBall || !cueBody || cueBall.pocketed) return

    const normalizedPower = clamp(power, 0, 120) / 120
    const launchSpeed = LAUNCH_SPEED_MIN + (LAUNCH_SPEED_MAX - LAUNCH_SPEED_MIN) * normalizedPower
    const fx = Math.cos(angle) * power * FORCE_SCALE
    const fy = Math.sin(angle) * power * FORCE_SCALE

    Matter.Sleeping.set(cueBody, false)
    Matter.Body.setVelocity(cueBody, {
      x: Math.cos(angle) * launchSpeed,
      y: Math.sin(angle) * launchSpeed,
    })
    Matter.Body.applyForce(cueBody, cueBody.position, { x: fx, y: fy })
    this.cueAcceleration = {
      x: fx,
      y: fy,
      ticks: ACCELERATION_TICKS,
    }

    if (spin) {
      Matter.Body.setAngularVelocity(cueBody, cueBody.angularVelocity + (spin.x + spin.y) * 0.0005)
    }
  }

  public resetCueBall(): void {
    if (!this.initialized || !this.world) return

    const cueBall = this.ballsState['cue-ball']
    if (!cueBall) return

    const placement = this.findCueBallResetSpot()
    cueBall.x = placement.x
    cueBall.y = placement.y
    cueBall.vx = 0
    cueBall.vy = 0
    cueBall.pocketed = false

    let cueBody = this.ballBodies['cue-ball']
    if (!cueBody) {
      cueBody = this.createBallBody(cueBall)
      this.ballBodies['cue-ball'] = cueBody
      Matter.Composite.add(this.world, cueBody)
    }

    Matter.Sleeping.set(cueBody, false)
    Matter.Body.setPosition(cueBody, placement)
    Matter.Body.setVelocity(cueBody, { x: 0, y: 0 })
    Matter.Body.setAngularVelocity(cueBody, 0)
  }

  public isMoving(): boolean {
    if (!this.initialized) return false

    return Object.values(this.ballBodies).some((body) => {
      if (!body) return false
      const speedSquared = body.velocity.x * body.velocity.x + body.velocity.y * body.velocity.y
      return speedSquared > VELOCITY_STOP_EPSILON * VELOCITY_STOP_EPSILON
    })
  }

  public reset(): void {
    this.ballsState = cloneBalls(this.getInitialBallPositions())
    this.cueAcceleration = null
    this.rebuildWorld()
    this.initialized = true
  }

  private rebuildWorld(): void {
    this.engine = Matter.Engine.create({
      gravity: { x: 0, y: 0 },
      enableSleeping: true,
      positionIterations: 6,
      velocityIterations: 4,
      constraintIterations: 1,
    })

    this.world = this.engine.world
    this.world.gravity.x = 0
    this.world.gravity.y = 0

    this.ballBodies = {}
    this.railBodies = this.railBuilder.createRails()
    Matter.Composite.add(this.world, this.railBodies)

    Object.values(this.ballsState).forEach((ball) => {
      if (ball.pocketed) return
      const body = this.createBallBody(ball)
      this.ballBodies[ball.id] = body
      Matter.Composite.add(this.world!, body)
    })
  }

  private createBallBody(ball: Ball): Matter.Body {
    return Matter.Bodies.circle(ball.x, ball.y, BALL_RADIUS, {
      restitution: BALL_BALL_RESTITUTION,
      frictionAir: FRICTION,
      friction: 0.02,
      frictionStatic: 0.02,
      density: BALL_MASS,
      slop: 0.01,
      label: ball.id,
    })
  }

  private keepCueBallInsideBounds(): void {
    const cue = this.ballsState['cue-ball']
    const cueBody = this.ballBodies['cue-ball']
    if (!cue || !cueBody) return

    const minX = TABLE_BORDER + BALL_RADIUS
    const maxX = TABLE_WIDTH - TABLE_BORDER - BALL_RADIUS
    const minY = TABLE_BORDER + BALL_RADIUS
    const maxY = TABLE_HEIGHT - TABLE_BORDER - BALL_RADIUS

    const clampedX = clamp(cue.x, minX, maxX)
    const clampedY = clamp(cue.y, minY, maxY)

    if (clampedX !== cue.x || clampedY !== cue.y) {
      cue.x = clampedX
      cue.y = clampedY
      cue.vx *= 0.65
      cue.vy *= 0.65
      Matter.Body.setPosition(cueBody, { x: cue.x, y: cue.y })
      Matter.Body.setVelocity(cueBody, { x: cue.vx, y: cue.vy })
    }
  }

  private findCueBallResetSpot(): { x: number; y: number } {
    const head = this.rackLayout.getHeadSpot()
    const minX = TABLE_BORDER + BALL_RADIUS
    const maxX = TABLE_WIDTH - TABLE_BORDER - BALL_RADIUS
    const minY = TABLE_BORDER + BALL_RADIUS
    const maxY = TABLE_HEIGHT - TABLE_BORDER - BALL_RADIUS

    const candidates: Array<{ x: number; y: number }> = [
      head,
      { x: head.x - BALL_RADIUS * 2.5, y: head.y },
      { x: head.x + BALL_RADIUS * 2.5, y: head.y },
      { x: head.x, y: head.y + BALL_RADIUS * 2.5 },
      { x: head.x, y: head.y - BALL_RADIUS * 2.5 },
      { x: head.x - BALL_RADIUS * 3.5, y: head.y + BALL_RADIUS },
      { x: head.x + BALL_RADIUS * 3.5, y: head.y + BALL_RADIUS },
    ]

    for (const spot of candidates) {
      const candidate = {
        x: clamp(spot.x, minX, maxX),
        y: clamp(spot.y, minY, maxY),
      }

      const colliding = Object.values(this.ballsState).some((ball) => {
        if (ball.id === 'cue-ball' || ball.pocketed) return false
        return distanceSquared(candidate.x, candidate.y, ball.x, ball.y) < CUE_RESET_CLEARANCE * CUE_RESET_CLEARANCE
      })

      if (!colliding) {
        return candidate
      }
    }

    return {
      x: clamp(head.x, minX, maxX),
      y: clamp(head.y, minY, maxY),
    }
  }
}

const sharedEngine = new PoolPhysicsEngine()

export function getInitialBallPositions(): Record<BallId, Ball> {
  return sharedEngine.getInitialBallPositions()
}

export async function initPhysics(): Promise<void> {
  await sharedEngine.init()
}

export function stepPhysics(): BallKinematics {
  return sharedEngine.step()
}

export function shoot(angle: number, power: number, spin?: { x: number; y: number }): void {
  sharedEngine.shoot(angle, power, spin)
}

export function checkPockets(positions: Partial<Record<BallId, { x: number; y: number }>>): Set<BallId> {
  const pocketed = new Set<BallId>()
  Object.entries(positions).forEach(([id, pos]) => {
    if (!pos || id === 'cue-ball') return
    if (isInsidePocket(pos.x, pos.y)) {
      pocketed.add(id as BallId)
    }
  })
  return pocketed
}

export function checkCueBallPocketed(positions: Partial<Record<BallId, { x: number; y: number }>>): boolean {
  const cue = positions['cue-ball']
  if (!cue) return false
  return isInsidePocket(cue.x, cue.y)
}

export function resetCueBall(): void {
  sharedEngine.resetCueBall()
}

export function isBallsMoving(): boolean {
  return sharedEngine.isMoving()
}

export function resetPhysics(): void {
  sharedEngine.reset()
}
