const TAU = Math.PI * 2
const FIELD_OF_VIEW = 65 * (Math.PI / 180)
const CAMERA_DISTANCE = 150
const CURVE_LENGTH = 30
const CURVE_RADIUS = 5.6
const TUBE_RADIUS = 1
const RING_OUTER_RADIUS = 5.55
const RING_INNER_RADIUS = 4.3
const RING_CENTER_X = CURVE_LENGTH + 1.1
const RING_COVER_X = CURVE_LENGTH + 1
const RING_COVER_WIDTH = 50
const RING_COVER_HEIGHT = 15
const SHADOW_PLANE_START_Z = -2.5
const SHADOW_PLANE_STEP_Z = 0.5
const SHADOW_PLANE_COUNT = 10
const SHADOW_PLANE_OPACITY = 0.13
const SHAPE_SCALE = 3.2
const PROJECTION_EDGE_PADDING = 0.5
const PROJECTION_SAMPLE_COUNT = 24
const ROTATE_VALUE = 0.035
const MAX_ANIMATE_STEP = 240
const FINISH_HOLD_MS = 140
const CURVE_SAMPLE_COUNT = 240
const RING_SAMPLE_COUNT = 48

const reducedMotionMedia =
  typeof window.matchMedia === "function"
    ? window.matchMedia("(prefers-reduced-motion: reduce)")
    : null

const loaderStates = new Set()
const curvePoints = Array.from({ length: CURVE_SAMPLE_COUNT }, (_, index) =>
  curvePointAt(index / CURVE_SAMPLE_COUNT)
)
const curveTangents = createCurveTangents(curvePoints)
const curveNormals = createCurveNormals(curveTangents)

let animationFrameId = 0

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value))
}

function addVectors(left, right) {
  return {
    x: left.x + right.x,
    y: left.y + right.y,
    z: left.z + right.z,
  }
}

function subtractVectors(left, right) {
  return {
    x: left.x - right.x,
    y: left.y - right.y,
    z: left.z - right.z,
  }
}

function scaleVector(vector, scalar) {
  return {
    x: vector.x * scalar,
    y: vector.y * scalar,
    z: vector.z * scalar,
  }
}

function dotProduct(left, right) {
  return left.x * right.x + left.y * right.y + left.z * right.z
}

function crossProduct(left, right) {
  return {
    x: left.y * right.z - left.z * right.y,
    y: left.z * right.x - left.x * right.z,
    z: left.x * right.y - left.y * right.x,
  }
}

function vectorLength(vector) {
  return Math.hypot(vector.x, vector.y, vector.z)
}

function normalizeVector(vector) {
  const length = vectorLength(vector)
  if (!length) {
    return { x: 0, y: 0, z: 0 }
  }
  return scaleVector(vector, 1 / length)
}

function rotateVectorAroundAxis(vector, axis, angle) {
  const normalizedAxis = normalizeVector(axis)
  const cosine = Math.cos(angle)
  const sine = Math.sin(angle)
  const axisCrossVector = crossProduct(normalizedAxis, vector)
  const axisDotVector = dotProduct(normalizedAxis, vector)
  return {
    x:
      vector.x * cosine +
      axisCrossVector.x * sine +
      normalizedAxis.x * axisDotVector * (1 - cosine),
    y:
      vector.y * cosine +
      axisCrossVector.y * sine +
      normalizedAxis.y * axisDotVector * (1 - cosine),
    z:
      vector.z * cosine +
      axisCrossVector.z * sine +
      normalizedAxis.z * axisDotVector * (1 - cosine),
  }
}

function curvePointAt(percent) {
  const x = CURVE_LENGTH * Math.sin(TAU * percent)
  const y = CURVE_RADIUS * Math.cos(TAU * 3 * percent)

  let t = (percent % 0.25) / 0.25
  t = (percent % 0.25) - (2 * (1 - t) * t * -0.0185 + t * t * 0.25)
  if (Math.floor(percent / 0.25) === 0 || Math.floor(percent / 0.25) === 2) {
    t *= -1
  }

  const z = CURVE_RADIUS * Math.sin(TAU * 2 * (percent - t))
  return { x, y, z }
}

function createCurveTangents(points) {
  return points.map((_, index) => {
    const previousPoint = points[(index - 1 + points.length) % points.length]
    const nextPoint = points[(index + 1) % points.length]
    return normalizeVector(subtractVectors(nextPoint, previousPoint))
  })
}

function initialRibbonNormal(tangent) {
  const absoluteX = Math.abs(tangent.x)
  const absoluteY = Math.abs(tangent.y)
  const absoluteZ = Math.abs(tangent.z)
  const reference =
    absoluteX <= absoluteY && absoluteX <= absoluteZ
      ? { x: 1, y: 0, z: 0 }
      : absoluteY <= absoluteX && absoluteY <= absoluteZ
        ? { x: 0, y: 1, z: 0 }
        : { x: 0, y: 0, z: 1 }
  const binormal = normalizeVector(crossProduct(tangent, reference))
  return normalizeVector(crossProduct(binormal, tangent))
}

function createCurveNormals(tangents) {
  if (tangents.length === 0) return []

  const normals = new Array(tangents.length)
  const binormals = new Array(tangents.length)

  normals[0] = initialRibbonNormal(tangents[0])
  binormals[0] = normalizeVector(crossProduct(tangents[0], normals[0]))

  for (let index = 1; index < tangents.length; index += 1) {
    normals[index] = normals[index - 1]

    const rotationAxis = crossProduct(tangents[index - 1], tangents[index])
    if (vectorLength(rotationAxis) > 1e-6) {
      const rotationAngle = Math.acos(
        clamp(dotProduct(tangents[index - 1], tangents[index]), -1, 1)
      )
      normals[index] = normalizeVector(
        rotateVectorAroundAxis(normals[index], rotationAxis, rotationAngle)
      )
    }

    binormals[index] = normalizeVector(
      crossProduct(tangents[index], normals[index])
    )
    normals[index] = normalizeVector(
      crossProduct(binormals[index], tangents[index])
    )
  }

  const lastIndex = tangents.length - 1
  if (lastIndex > 0) {
    let correctionAngle = Math.acos(
      clamp(dotProduct(normals[0], normals[lastIndex]), -1, 1)
    )
    const correctionAxis = crossProduct(normals[0], normals[lastIndex])
    if (dotProduct(tangents[0], correctionAxis) > 0) {
      correctionAngle *= -1
    }
    correctionAngle /= lastIndex

    for (let index = 1; index < tangents.length; index += 1) {
      normals[index] = normalizeVector(
        rotateVectorAroundAxis(
          normals[index],
          tangents[index],
          correctionAngle * index
        )
      )
    }
  }

  return normals
}

function rotatePointAroundX(point, angle) {
  const cosine = Math.cos(angle)
  const sine = Math.sin(angle)
  return {
    x: point.x,
    y: point.y * cosine - point.z * sine,
    z: point.y * sine + point.z * cosine,
  }
}

function rotatePointAroundY(point, angle) {
  const cosine = Math.cos(angle)
  const sine = Math.sin(angle)
  return {
    x: point.x * cosine + point.z * sine,
    y: point.y,
    z: -point.x * sine + point.z * cosine,
  }
}

function projectPoint(point, focalLength, centerX, centerY) {
  const depth = CAMERA_DISTANCE - point.z
  if (depth <= 0.1) return null

  const scale = focalLength / depth
  return {
    x: centerX - point.x * scale,
    y: centerY + point.y * scale,
    scale,
    z: point.z,
  }
}

function parseColor(value) {
  if (!value || value === "transparent") {
    return { r: 0, g: 0, b: 0, a: 0 }
  }

  const parts = typeof value === "string" ? value.match(/[\d.]+/g) : null
  if (!parts || parts.length < 3) {
    return { r: 255, g: 255, b: 255, a: 1 }
  }

  const [r, g, b, alpha = "1"] = parts
  return {
    r: Number(r),
    g: Number(g),
    b: Number(b),
    a: Number(alpha),
  }
}

function rgbaString(color, alphaMultiplier = 1) {
  const alpha = clamp(
    (Number.isFinite(color.a) ? color.a : 1) * alphaMultiplier,
    0,
    1
  )
  return `rgba(${Math.round(color.r)}, ${Math.round(color.g)}, ${Math.round(color.b)}, ${alpha})`
}

function mixColor(fromColor, toColor, amount) {
  const t = clamp(amount, 0, 1)
  return {
    r: fromColor.r + (toColor.r - fromColor.r) * t,
    g: fromColor.g + (toColor.g - fromColor.g) * t,
    b: fromColor.b + (toColor.b - fromColor.b) * t,
    a:
      (Number.isFinite(fromColor.a) ? fromColor.a : 1) +
      ((Number.isFinite(toColor.a) ? toColor.a : 1) -
        (Number.isFinite(fromColor.a) ? fromColor.a : 1)) *
        t,
  }
}

function resolveBackdropColor(element) {
  let current = element?.parentElement || null
  while (current) {
    const backgroundColor = parseColor(
      getComputedStyle(current).backgroundColor
    )
    if (backgroundColor.a > 0) {
      return backgroundColor
    }
    current = current.parentElement
  }

  const bodyColor = parseColor(getComputedStyle(document.body).backgroundColor)
  if (bodyColor.a > 0) {
    return bodyColor
  }

  return parseColor(getComputedStyle(document.documentElement).backgroundColor)
}

function shadowPlaneTintAmount(z) {
  let planeCountInFront = 0
  for (let index = 0; index < SHADOW_PLANE_COUNT; index += 1) {
    const planeZ = SHADOW_PLANE_START_Z + index * SHADOW_PLANE_STEP_Z
    if (planeZ > z) {
      planeCountInFront += 1
    }
  }
  return 1 - (1 - SHADOW_PLANE_OPACITY) ** planeCountInFront
}

function syncCanvasSize(state, width, height) {
  const dpr = Math.min(window.devicePixelRatio || 1, 2)
  const pixelWidth = Math.max(1, Math.round(width * dpr))
  const pixelHeight = Math.max(1, Math.round(height * dpr))

  if (
    state.pixelWidth === pixelWidth &&
    state.pixelHeight === pixelHeight &&
    state.dpr === dpr
  ) {
    return
  }

  state.pixelWidth = pixelWidth
  state.pixelHeight = pixelHeight
  state.dpr = dpr
  state.canvas.width = pixelWidth
  state.canvas.height = pixelHeight
}

function easing(t, b, c, d) {
  let value = t / (d / 2)
  if (value < 1) {
    return (c / 2) * value * value + b
  }
  value -= 2
  return (c / 2) * (value * value * value + 2) + b
}

function syncEffectState(state, acceleration) {
  state.groupRotationY = 0
  state.groupOffsetZ = 0
  state.meshOpacity = 1
  state.ringOpacity = 0
  state.ringScale = 0.9

  if (acceleration <= 0.35) return

  const collapseProgress = clamp((acceleration - 0.35) / 0.65, 0, 1)
  state.groupRotationY = -(Math.PI / 2) * collapseProgress
  state.groupOffsetZ = 50 * collapseProgress

  const ringProgress = clamp((acceleration - 0.97) / 0.03, 0, 1)
  state.meshOpacity = 1 - ringProgress
  state.ringOpacity = ringProgress
  state.ringScale = 0.9 + 0.1 * ringProgress
}

function transformMeshPoint(basePoint, state) {
  const rotatedMeshPoint = rotatePointAroundX(basePoint, state.rotationX)
  const rotatedGroupPoint = rotatePointAroundY(
    rotatedMeshPoint,
    state.groupRotationY
  )
  return {
    x: rotatedGroupPoint.x,
    y: rotatedGroupPoint.y,
    z: rotatedGroupPoint.z + state.groupOffsetZ,
  }
}

function transformGroupPoint(point, state) {
  const rotatedPoint = rotatePointAroundY(point, state.groupRotationY)
  return {
    x: rotatedPoint.x,
    y: rotatedPoint.y,
    z: rotatedPoint.z + state.groupOffsetZ,
  }
}

function transformMeshVector(baseVector, state) {
  const rotatedMeshVector = rotatePointAroundX(baseVector, state.rotationX)
  return rotatePointAroundY(rotatedMeshVector, state.groupRotationY)
}

function baseFocalLength(width, height) {
  return (
    ((Math.min(width, height) * 0.5) / Math.tan(FIELD_OF_VIEW / 2)) *
    SHAPE_SCALE
  )
}

function buildRibbonProjection(state, focalLength, centerX, centerY) {
  const samples = []

  for (let index = 0; index < curvePoints.length; index += 1) {
    const centerWorldPoint = transformMeshPoint(curvePoints[index], state)
    const worldNormal = transformMeshVector(curveNormals[index], state)
    const leftWorldPoint = addVectors(
      centerWorldPoint,
      scaleVector(worldNormal, TUBE_RADIUS)
    )
    const rightWorldPoint = subtractVectors(
      centerWorldPoint,
      scaleVector(worldNormal, TUBE_RADIUS)
    )
    const leftPoint = projectPoint(
      leftWorldPoint,
      focalLength,
      centerX,
      centerY
    )
    const rightPoint = projectPoint(
      rightWorldPoint,
      focalLength,
      centerX,
      centerY
    )

    if (!leftPoint || !rightPoint) continue

    samples.push({
      leftPoint,
      rightPoint,
      z: centerWorldPoint.z,
    })
  }

  return samples
}

function buildRibbonSegments(samples) {
  if (samples.length < 2) return []

  const segments = []
  for (let index = 0; index < samples.length; index += 1) {
    const currentSample = samples[index]
    const nextSample = samples[(index + 1) % samples.length]
    segments.push({
      z: (currentSample.z + nextSample.z) / 2,
      points: [
        currentSample.leftPoint,
        currentSample.rightPoint,
        nextSample.rightPoint,
        nextSample.leftPoint,
      ],
    })
  }

  segments.sort((left, right) => left.z - right.z)
  return segments
}

function buildRingProjection(state, focalLength, centerX, centerY) {
  const outerPoints = []
  const innerPoints = []

  for (let index = 0; index <= RING_SAMPLE_COUNT; index += 1) {
    const angle = (index / RING_SAMPLE_COUNT) * TAU
    const cosine = Math.cos(angle)
    const sine = Math.sin(angle)
    const outerPoint = projectPoint(
      transformGroupPoint(
        {
          x: RING_CENTER_X,
          y: cosine * RING_OUTER_RADIUS * state.ringScale,
          z: sine * RING_OUTER_RADIUS * state.ringScale,
        },
        state
      ),
      focalLength,
      centerX,
      centerY
    )
    const innerPoint = projectPoint(
      transformGroupPoint(
        {
          x: RING_CENTER_X,
          y: cosine * RING_INNER_RADIUS * state.ringScale,
          z: sine * RING_INNER_RADIUS * state.ringScale,
        },
        state
      ),
      focalLength,
      centerX,
      centerY
    )
    if (outerPoint) outerPoints.push(outerPoint)
    if (innerPoint) innerPoints.push(innerPoint)
  }

  return { outerPoints, innerPoints }
}

function createProjectionMetrics(state, width, height) {
  const centerX = width / 2
  const centerY = height / 2
  const initialFocalLength = baseFocalLength(width, height)
  const ribbonProjectionState = {
    rotationX: 0,
    groupRotationY: state.groupRotationY,
    groupOffsetZ: state.groupOffsetZ,
  }
  const ringProjectionState = {
    groupRotationY: state.groupRotationY,
    groupOffsetZ: state.groupOffsetZ,
    ringScale: state.ringScale,
  }
  const { outerPoints } = buildRingProjection(
    ringProjectionState,
    initialFocalLength,
    centerX,
    centerY
  )

  let minX = Infinity
  let maxX = -Infinity
  let minY = Infinity
  let maxY = -Infinity

  for (
    let sampleIndex = 0;
    sampleIndex < PROJECTION_SAMPLE_COUNT;
    sampleIndex += 1
  ) {
    ribbonProjectionState.rotationX =
      (sampleIndex / PROJECTION_SAMPLE_COUNT) * TAU
    const ribbonSamples = buildRibbonProjection(
      ribbonProjectionState,
      initialFocalLength,
      centerX,
      centerY
    )
    for (const sample of ribbonSamples) {
      minX = Math.min(minX, sample.leftPoint.x, sample.rightPoint.x)
      maxX = Math.max(maxX, sample.leftPoint.x, sample.rightPoint.x)
      minY = Math.min(minY, sample.leftPoint.y, sample.rightPoint.y)
      maxY = Math.max(maxY, sample.leftPoint.y, sample.rightPoint.y)
    }
  }

  for (const point of outerPoints) {
    minX = Math.min(minX, point.x)
    maxX = Math.max(maxX, point.x)
    minY = Math.min(minY, point.y)
    maxY = Math.max(maxY, point.y)
  }

  const boundsWidth =
    Number.isFinite(minX) && Number.isFinite(maxX)
      ? Math.max(1, maxX - minX)
      : 1
  const boundsHeight =
    Number.isFinite(minY) && Number.isFinite(maxY)
      ? Math.max(1, maxY - minY)
      : 1
  const availableWidth = Math.max(1, width - PROJECTION_EDGE_PADDING * 2)
  const availableHeight = Math.max(1, height - PROJECTION_EDGE_PADDING * 2)
  const fitScale = clamp(
    Math.min(availableWidth / boundsWidth, availableHeight / boundsHeight),
    0.01,
    100
  )

  return {
    focalLength: initialFocalLength * fitScale,
    centerX,
    centerY,
  }
}

function drawMesh(ctx, state, projection, color, backdropColor) {
  if (state.meshOpacity <= 0.001) return

  const ribbonSamples = buildRibbonProjection(
    state,
    projection.focalLength,
    projection.centerX,
    projection.centerY
  )
  const ribbonSegments = buildRibbonSegments(ribbonSamples)
  if (ribbonSegments.length === 0) return

  for (const segment of ribbonSegments) {
    const tintAmount = shadowPlaneTintAmount(segment.z)
    const fillColor = mixColor(color, backdropColor, tintAmount)
    ctx.fillStyle = rgbaString(fillColor, state.meshOpacity)
    ctx.beginPath()
    ctx.moveTo(segment.points[0].x, segment.points[0].y)
    for (let index = 1; index < segment.points.length; index += 1) {
      ctx.lineTo(segment.points[index].x, segment.points[index].y)
    }
    ctx.closePath()
    ctx.fill()
  }
}

function drawRingCover(ctx, state, projection) {
  if (state.ringOpacity <= 0.001) return

  const halfHeight = RING_COVER_HEIGHT / 2
  const halfWidth = RING_COVER_WIDTH / 2
  const corners = [
    { x: RING_COVER_X, y: -halfHeight, z: -halfWidth },
    { x: RING_COVER_X, y: halfHeight, z: -halfWidth },
    { x: RING_COVER_X, y: halfHeight, z: halfWidth },
    { x: RING_COVER_X, y: -halfHeight, z: halfWidth },
  ]

  const projectedCorners = corners
    .map((corner) =>
      projectPoint(
        transformGroupPoint(corner, state),
        projection.focalLength,
        projection.centerX,
        projection.centerY
      )
    )
    .filter(Boolean)

  if (projectedCorners.length !== corners.length) return

  ctx.save()
  ctx.globalCompositeOperation = "destination-out"
  ctx.globalAlpha = clamp(state.ringOpacity, 0, 1)
  ctx.beginPath()
  ctx.moveTo(projectedCorners[0].x, projectedCorners[0].y)
  for (let index = 1; index < projectedCorners.length; index += 1) {
    ctx.lineTo(projectedCorners[index].x, projectedCorners[index].y)
  }
  ctx.closePath()
  ctx.fill()
  ctx.restore()
}

function drawRing(ctx, state, projection, color) {
  if (state.ringOpacity <= 0.001) return

  const { outerPoints, innerPoints } = buildRingProjection(
    state,
    projection.focalLength,
    projection.centerX,
    projection.centerY
  )

  if (outerPoints.length < 3 || innerPoints.length < 3) return

  ctx.fillStyle = rgbaString(color, state.ringOpacity)
  ctx.beginPath()
  ctx.moveTo(outerPoints[0].x, outerPoints[0].y)
  for (let index = 1; index < outerPoints.length; index += 1) {
    ctx.lineTo(outerPoints[index].x, outerPoints[index].y)
  }
  for (let index = innerPoints.length - 1; index >= 0; index -= 1) {
    const point = innerPoints[index]
    ctx.lineTo(point.x, point.y)
  }
  ctx.closePath()
  ctx.fill("evenodd")
}

function clearCanvas(state) {
  const bounds = state.element.getBoundingClientRect()
  const width = bounds.width
  const height = bounds.height
  if (!(width > 0) || !(height > 0) || !state.ctx) return
  syncCanvasSize(state, width, height)
  state.ctx.setTransform(state.dpr, 0, 0, state.dpr, 0, 0)
  state.ctx.clearRect(0, 0, width, height)
}

function renderLoader(state) {
  if (!state.ctx || !state.element.isConnected) return false

  const bounds = state.element.getBoundingClientRect()
  const width = bounds.width
  const height = bounds.height
  if (!(width > 0) || !(height > 0)) return true

  syncCanvasSize(state, width, height)

  const ctx = state.ctx
  ctx.setTransform(state.dpr, 0, 0, state.dpr, 0, 0)
  ctx.clearRect(0, 0, width, height)

  if (!state.visible) return true

  const color = parseColor(getComputedStyle(state.element).color)
  const backdropColor = resolveBackdropColor(state.element)
  const projection = createProjectionMetrics(state, width, height)
  drawMesh(ctx, state, projection, color, backdropColor)
  drawRingCover(ctx, state, projection)
  drawRing(ctx, state, projection, color)
  return true
}

function completeLoader(state) {
  state.active = false
  state.visible = false
  state.toEnd = false
  state.animateStep = 0
  state.finishHoldUntil = 0
  syncEffectState(state, 0)
  clearCanvas(state)
  state.element.dispatchEvent(new CustomEvent("loaderfinish"))
}

function loaderNeedsAnimation(state) {
  return Boolean(state.active || state.toEnd || state.finishHoldUntil)
}

function hasAnimatingLoaders() {
  for (const state of loaderStates) {
    if (loaderNeedsAnimation(state)) return true
  }
  return false
}

function updateLoaderState(state, now) {
  if (!state.element.isConnected) return

  if (reducedMotionMedia?.matches) {
    if (state.active) {
      state.visible = true
      state.toEnd = false
      state.animateStep = 0
      syncEffectState(state, 0)
      renderLoader(state)
    } else if (state.visible || state.toEnd || state.finishHoldUntil) {
      completeLoader(state)
    }
    return
  }

  if (!loaderNeedsAnimation(state)) {
    renderLoader(state)
    return
  }

  if (typeof state.lastTimestamp !== "number") {
    state.lastTimestamp = now
  }

  const frameFactor = Math.min(
    3,
    Math.max(0, ((now - state.lastTimestamp) / 1000) * 60)
  )
  state.lastTimestamp = now

  if (state.toEnd) {
    state.animateStep = Math.min(
      MAX_ANIMATE_STEP,
      state.animateStep + frameFactor
    )
  } else {
    state.animateStep = Math.max(0, state.animateStep - 4 * frameFactor)
  }

  const acceleration = easing(state.animateStep, 0, 1, MAX_ANIMATE_STEP)
  state.rotationX =
    (state.rotationX - (ROTATE_VALUE + acceleration) * frameFactor + TAU * 4) %
    TAU
  syncEffectState(state, acceleration)
  state.visible = true

  if (state.toEnd && state.animateStep >= MAX_ANIMATE_STEP) {
    if (!state.finishHoldUntil) {
      state.finishHoldUntil = now + FINISH_HOLD_MS
    } else if (now >= state.finishHoldUntil) {
      completeLoader(state)
      return
    }
  } else {
    state.finishHoldUntil = 0
  }

  renderLoader(state)
}

function renderAll(now) {
  animationFrameId = 0

  for (const state of loaderStates) {
    if (!state.element.isConnected) {
      loaderStates.delete(state)
      continue
    }
    updateLoaderState(state, now)
  }

  if (hasAnimatingLoaders()) {
    animationFrameId = window.requestAnimationFrame(renderAll)
  }
}

function ensureAnimation() {
  if (reducedMotionMedia?.matches) {
    for (const state of loaderStates) {
      updateLoaderState(state, performance.now())
    }
    return
  }

  if (!animationFrameId && hasAnimatingLoaders()) {
    animationFrameId = window.requestAnimationFrame(renderAll)
  }
}

function handleReducedMotionChange() {
  if (animationFrameId) {
    window.cancelAnimationFrame(animationFrameId)
    animationFrameId = 0
  }

  for (const state of loaderStates) {
    state.lastTimestamp = undefined
  }

  ensureAnimation()
}

reducedMotionMedia?.addEventListener?.("change", handleReducedMotionChange)

function createCanvas() {
  const canvas = document.createElement("canvas")
  canvas.className = "app-loader-canvas"
  canvas.setAttribute("aria-hidden", "true")
  return canvas
}

export function mountLoaderElement(element) {
  if (!element) return null

  element.classList.add("app-loader")

  if (element._loaderState) {
    loaderStates.add(element._loaderState)
    renderLoader(element._loaderState)
    return element
  }

  const canvas = element.querySelector("canvas") || createCanvas()
  if (!canvas.isConnected) {
    element.append(canvas)
  }

  const ctx = canvas.getContext("2d", { alpha: true, desynchronized: true })
  const state = {
    element,
    canvas,
    ctx,
    active: false,
    visible: false,
    toEnd: false,
    animateStep: 0,
    rotationX: Math.random() * TAU,
    groupRotationY: 0,
    groupOffsetZ: 0,
    meshOpacity: 1,
    ringOpacity: 0,
    ringScale: 0.9,
    finishHoldUntil: 0,
    lastTimestamp: undefined,
    pixelWidth: 0,
    pixelHeight: 0,
    dpr: 1,
  }

  element._loaderState = state
  loaderStates.add(state)
  renderLoader(state)
  return element
}

export function setLoaderActive(element, active) {
  const state = element?._loaderState
  if (!state) return

  if (active) {
    if (state.active && !state.toEnd) {
      loaderStates.add(state)
      state.visible = true
      ensureAnimation()
      renderLoader(state)
      return
    }

    state.active = true
    state.visible = true
    state.toEnd = false
    state.finishHoldUntil = 0
    state.lastTimestamp = undefined
    ensureAnimation()
    renderLoader(state)
    return
  }

  if (!state.active) {
    return
  }

  state.active = false
  state.visible = true
  state.toEnd = true
  state.finishHoldUntil = 0
  state.lastTimestamp = undefined
  ensureAnimation()
}

export function clearLoader(element) {
  const state = element?._loaderState
  if (!state) return

  state.active = false
  state.visible = false
  state.toEnd = false
  state.animateStep = 0
  state.finishHoldUntil = 0
  state.lastTimestamp = undefined
  syncEffectState(state, 0)
  loaderStates.delete(state)
  clearCanvas(state)
}

export function isLoaderVisible(element) {
  const state = element?._loaderState
  return Boolean(
    state?.visible || state?.active || state?.toEnd || state?.finishHoldUntil
  )
}
