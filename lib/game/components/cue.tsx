import { useMemo } from 'react'
import { View, StyleSheet } from 'react-native'
import { Gesture, GestureDetector } from 'react-native-gesture-handler'
import Animated, { runOnJS, useAnimatedStyle, useSharedValue, type SharedValue } from 'react-native-reanimated'
import { BALL_RADIUS } from '../physics/index'

interface CueProps {
  cueBallX: SharedValue<number>
  cueBallY: SharedValue<number>
  cueVisible: SharedValue<boolean>
  cueIsAiming: SharedValue<boolean>
  cueAngle: SharedValue<number>
  cuePower: SharedValue<number>
  onShoot: (angle: number, power: number) => void
  scale: number
  offsetX: number
  offsetY: number
  canShoot: boolean
}

interface CueVisualProps {
  cueBallX: SharedValue<number>
  cueBallY: SharedValue<number>
  cueVisible: SharedValue<boolean>
  cueIsAiming: SharedValue<boolean>
  cueAngle: SharedValue<number>
  cuePower: SharedValue<number>
  scale: number
  offsetX: number
  offsetY: number
}

const MAX_POWER = 120
const MAX_DRAG_DISTANCE = 260
const DASH_COUNT = 18
const DASH_LENGTH = 18
const DASH_GAP = 12

export function Cue({
  cueBallX,
  cueBallY,
  cueVisible,
  cueIsAiming,
  cueAngle,
  cuePower,
  onShoot,
  scale,
  offsetX,
  offsetY,
  canShoot,
}: CueProps) {
  const isDragging = useSharedValue(false)

  const gesture = useMemo(() => {
    const panGesture = Gesture.Pan()
      .onStart((event) => {
        if (!canShoot) return

        const safeScale = scale > 0 ? scale : 1
        const x = (event.x - offsetX) / safeScale
        const y = (event.y - offsetY) / safeScale

        const dx = x - cueBallX.value
        const dy = y - cueBallY.value
        const touchDistance = Math.sqrt(dx * dx + dy * dy)

        if (touchDistance > BALL_RADIUS * 4) {
          cueIsAiming.value = false
          cuePower.value = 0
          return
        }

        isDragging.value = true
        cueVisible.value = true
        cueIsAiming.value = true

        const shotDx = cueBallX.value - x
        const shotDy = cueBallY.value - y
        const dragDistance = Math.sqrt(shotDx * shotDx + shotDy * shotDy)
        cueAngle.value = Math.atan2(shotDy, shotDx)
        cuePower.value = Math.min(dragDistance / MAX_DRAG_DISTANCE, 1) * MAX_POWER
      })
      .onUpdate((event) => {
        if (!canShoot || !isDragging.value) return

        const safeScale = scale > 0 ? scale : 1
        const x = (event.x - offsetX) / safeScale
        const y = (event.y - offsetY) / safeScale

        const shotDx = cueBallX.value - x
        const shotDy = cueBallY.value - y
        const dragDistance = Math.sqrt(shotDx * shotDx + shotDy * shotDy)

        cueVisible.value = true
        cueIsAiming.value = true
        cueAngle.value = Math.atan2(shotDy, shotDx)
        cuePower.value = Math.min(dragDistance / MAX_DRAG_DISTANCE, 1) * MAX_POWER
      })
      .onEnd(() => {
        if (!isDragging.value) return

        const power = cuePower.value
        const angle = cueAngle.value

        isDragging.value = false
        cueIsAiming.value = false

        if (power > 4) {
          cueVisible.value = false
          cuePower.value = 0
          runOnJS(onShoot)(angle, power)
          return
        }

        cuePower.value = 0
      })
      .onFinalize(() => {
        if (!isDragging.value) return
        isDragging.value = false
        cueIsAiming.value = false
        cuePower.value = 0
      })

    const tapGesture = Gesture.Tap().onStart((event) => {
      if (!canShoot) return

      const safeScale = scale > 0 ? scale : 1
      const x = (event.x - offsetX) / safeScale
      const y = (event.y - offsetY) / safeScale

      const dx = x - cueBallX.value
      const dy = y - cueBallY.value
      const touchDistance = Math.sqrt(dx * dx + dy * dy)

      if (touchDistance <= BALL_RADIUS * 4) {
        cueVisible.value = true
      }
    })

    return Gesture.Simultaneous(panGesture, tapGesture)
  }, [canShoot, cueAngle, cueBallX, cueBallY, cueIsAiming, cuePower, cueVisible, offsetX, offsetY, onShoot, scale, isDragging])

  return (
    <GestureDetector gesture={gesture}>
      <View style={styles.gestureLayer} />
    </GestureDetector>
  )
}

export function SkiaCue({ cueBallX, cueBallY, cueVisible, cueIsAiming, cueAngle, cuePower, scale, offsetX, offsetY }: CueVisualProps) {
  const ringStyle = useAnimatedStyle(() => {
    const cx = offsetX + cueBallX.value * scale
    const cy = offsetY + cueBallY.value * scale
    const size = BALL_RADIUS * 2.64 * scale
    return {
      opacity: cueVisible.value ? (cueIsAiming.value ? 0.55 : 0.32) : 0,
      width: size,
      height: size,
      borderRadius: size / 2,
      borderWidth: 2,
      borderColor: '#ffffff',
      left: cx - size / 2,
      top: cy - size / 2,
      position: 'absolute',
    }
  })

  const stickStyle = useAnimatedStyle(() => {
    const angle = Number.isFinite(cueAngle.value) ? cueAngle.value : -Math.PI / 2
    const ratio = Math.min(Math.max(cuePower.value / MAX_POWER, 0), 1)
    const offsetFromBall = (BALL_RADIUS + (cueIsAiming.value ? 6 + ratio * 34 : 8)) * scale
    const stickLength = 360 * scale

    const cx = offsetX + cueBallX.value * scale
    const cy = offsetY + cueBallY.value * scale

    const startX = cx - Math.cos(angle) * offsetFromBall
    const startY = cy - Math.sin(angle) * offsetFromBall

    return {
      opacity: cueVisible.value ? 0.95 : 0,
      width: stickLength,
      height: 8,
      borderRadius: 6,
      backgroundColor: '#c7924e',
      position: 'absolute',
      left: startX,
      top: startY - 4,
      transform: [{ rotateZ: `${angle + Math.PI}rad` }],
    }
  })

  const buttStyle = useAnimatedStyle(() => {
    const angle = Number.isFinite(cueAngle.value) ? cueAngle.value : -Math.PI / 2
    const ratio = Math.min(Math.max(cuePower.value / MAX_POWER, 0), 1)
    const offsetFromBall = (BALL_RADIUS + (cueIsAiming.value ? 6 + ratio * 34 : 8)) * scale
    const stickLength = 360 * scale

    const cx = offsetX + cueBallX.value * scale
    const cy = offsetY + cueBallY.value * scale

    const startX = cx - Math.cos(angle) * offsetFromBall
    const startY = cy - Math.sin(angle) * offsetFromBall

    const buttStartX = startX - Math.cos(angle) * (stickLength - 86 * scale)
    const buttStartY = startY - Math.sin(angle) * (stickLength - 86 * scale)

    return {
      opacity: cueVisible.value ? 0.92 : 0,
      width: 86 * scale,
      height: 11,
      borderRadius: 8,
      backgroundColor: '#4a2c1b',
      position: 'absolute',
      left: buttStartX,
      top: buttStartY - 5.5,
      transform: [{ rotateZ: `${angle + Math.PI}rad` }],
    }
  })

  const tipStyle = useAnimatedStyle(() => {
    const angle = Number.isFinite(cueAngle.value) ? cueAngle.value : -Math.PI / 2
    const ratio = Math.min(Math.max(cuePower.value / MAX_POWER, 0), 1)
    const offsetFromBall = (BALL_RADIUS + (cueIsAiming.value ? 6 + ratio * 34 : 8)) * scale

    const cx = offsetX + cueBallX.value * scale
    const cy = offsetY + cueBallY.value * scale

    const startX = cx - Math.cos(angle) * offsetFromBall
    const startY = cy - Math.sin(angle) * offsetFromBall

    return {
      opacity: cueVisible.value ? 1 : 0,
      width: 8,
      height: 8,
      borderRadius: 4,
      backgroundColor: '#2d7fd3',
      position: 'absolute',
      left: startX - 4,
      top: startY - 4,
    }
  })

  return (
    <View style={styles.visualLayer} pointerEvents="none">
      {Array.from({ length: DASH_COUNT }).map((_, index) => (
        <GuideDash
          key={`guide-dash-${index}`}
          index={index}
          cueBallX={cueBallX}
          cueBallY={cueBallY}
          cueVisible={cueVisible}
          cueIsAiming={cueIsAiming}
          cueAngle={cueAngle}
          cuePower={cuePower}
          scale={scale}
          offsetX={offsetX}
          offsetY={offsetY}
        />
      ))}
      <Animated.View style={stickStyle} />
      <Animated.View style={buttStyle} />
      <Animated.View style={tipStyle} />
      <Animated.View style={ringStyle} />
    </View>
  )
}

interface GuideDashProps extends CueVisualProps {
  index: number
}

function GuideDash({ index, cueBallX, cueBallY, cueVisible, cueIsAiming, cueAngle, cuePower, scale, offsetX, offsetY }: GuideDashProps) {
  const style = useAnimatedStyle(() => {
    if (!cueVisible.value || !cueIsAiming.value) {
      return { opacity: 0 }
    }

    const angle = Number.isFinite(cueAngle.value) ? cueAngle.value : -Math.PI / 2
    const ratio = Math.min(Math.max(cuePower.value / MAX_POWER, 0), 1)
    const maxDistance = (220 + ratio * 300) * scale
    const dashLength = DASH_LENGTH * scale
    const distance = (BALL_RADIUS * 1.8 + index * (DASH_LENGTH + DASH_GAP)) * scale

    if (distance > maxDistance) {
      return { opacity: 0 }
    }

    const cx = offsetX + cueBallX.value * scale
    const cy = offsetY + cueBallY.value * scale

    return {
      opacity: Math.max(0.18, 0.85 - index * 0.03),
      width: dashLength,
      height: 2,
      borderRadius: 2,
      backgroundColor: '#ffffff',
      position: 'absolute',
      left: cx + Math.cos(angle) * distance,
      top: cy + Math.sin(angle) * distance,
      transform: [{ rotateZ: `${angle}rad` }],
    }
  })

  return <Animated.View style={style} />
}

const styles = StyleSheet.create({
  gestureLayer: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: 0,
    bottom: 0,
    zIndex: 20,
  },
  visualLayer: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 15,
  },
})
