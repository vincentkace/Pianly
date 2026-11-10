import { useLayoutEffect, useMemo, useRef } from 'react'

const SVG_NS = 'http://www.w3.org/2000/svg'
const TOUCH_RADIUS = 22
const MOUSE_RADIUS = 8

function notehead(note) {
  return note.querySelector('.notehead use, .notehead path') ?? note.querySelector('.notehead, :scope > use')
}

function nearestNote(svg, { clientX, clientY, target, nativeEvent }, notesById) {
  const direct = target.closest('g.note[id]')
  if (direct && target.closest('.notehead, .accid') && notesById.has(direct.id)) return direct

  const touch = nativeEvent.pointerType === 'touch' || window.matchMedia('(pointer: coarse)').matches
  let distance = (touch ? TOUCH_RADIUS : MOUSE_RADIUS) ** 2
  let nearest = null
  for (const note of svg.querySelectorAll('g.note[id]')) {
    if (!notesById.has(note.id)) continue
    const box = notehead(note)?.getBoundingClientRect()
    if (!box?.width) continue
    const d = (clientX - box.x - box.width / 2) ** 2 + (clientY - box.y - box.height / 2) ** 2
    if (d <= distance) {
      distance = d
      nearest = note
    }
  }
  return nearest ?? (notesById.has(direct?.id) ? direct : null)
}

function measureAtPoint(svg, x, y) {
  // Staff paths have a very thin painted area. Treat the space between them
  // as part of the bar, even when the browser reports a tap on the SVG root.
  for (const measure of svg.querySelectorAll('g.measure[id]')) {
    const bounds = measure.getBoundingClientRect()
    if (x < bounds.left || x > bounds.right || y < bounds.top || y > bounds.bottom) continue
    const lines = measure.querySelectorAll(':scope > g.staff > path')
    if (!lines.length) continue
    const first = lines[0].getBoundingClientRect()
    const last = lines[lines.length - 1].getBoundingClientRect()
    if (x >= first.left && x <= first.right && y >= first.top && y <= last.bottom) return measure
  }
  return null
}

function createPlayhead(svg) {
  const group = document.createElementNS(SVG_NS, 'g')
  group.setAttribute('class', 'score-playhead')
  group.setAttribute('aria-hidden', 'true')
  for (const name of ['score-playhead-halo', 'score-playhead-line']) {
    const line = document.createElementNS(SVG_NS, 'line')
    line.setAttribute('class', name)
    line.setAttribute('vector-effect', 'non-scaling-stroke')
    group.append(line)
  }
  svg.append(group)
  return group
}

function measurePlayhead(svg, bar) {
  const measure = svg.querySelector(`g.measure#${CSS.escape(bar.id)}`)
  const screen = svg.getScreenCTM()
  if (!measure || !screen) return null
  const inverse = screen.inverse()
  const staffPoints = []
  for (const path of measure.querySelectorAll(':scope > g.staff > path')) {
    const matrix = path.getScreenCTM()
    const length = path.getTotalLength()
    if (!matrix || !length) continue
    const toPage = inverse.multiply(matrix)
    staffPoints.push(path.getPointAtLength(0).matrixTransform(toPage), path.getPointAtLength(length).matrixTransform(toPage))
  }
  if (!staffPoints.length) return null
  const left = Math.min(...staffPoints.map(p => p.x))
  const right = Math.max(...staffPoints.map(p => p.x))
  const top = Math.min(...staffPoints.map(p => p.y)) - 9
  const bottom = Math.max(...staffPoints.map(p => p.y)) + 9
  const points = [{ time: bar.time, x: left }]
  for (const { time, ids } of bar.anchors) {
    let x = Infinity
    for (const id of ids) {
      const element = measure.querySelector(`#${CSS.escape(id)}`)
      const glyph = element?.matches('g.note') ? notehead(element) : element?.matches('g.rest') ? element : null
      const box = glyph?.getBoundingClientRect()
      if (box?.width > 0) {
        const point = new DOMPoint(box.x + box.width / 2, box.y).matrixTransform(inverse)
        x = Math.min(x, point.x)
      }
    }
    if (!Number.isFinite(x)) continue
    const previous = points.at(-1)
    const point = { time, x: Math.min(right, Math.max(previous.x, x)) }
    if (time === previous.time) points[points.length - 1] = point
    else points.push(point)
  }
  points.push({ time: bar.end, x: right })
  return { points, top, bottom }
}

function playheadX(points, time) {
  const next = points.findIndex(point => point.time > time)
  if (next === 0) return points[0].x
  if (next < 0) return points.at(-1).x
  const a = points[next - 1]
  const b = points[next]
  return a.x + (b.x - a.x) * ((time - a.time) / (b.time - a.time))
}

function timeAtX(points, x) {
  const next = points.findIndex(point => point.x > x)
  if (next === 0) return points[0].time
  if (next < 0) return points.at(-1).time
  const a = points[next - 1]
  const b = points[next]
  return a.time + (b.time - a.time) * ((x - a.x) / (b.x - a.x))
}

export default function ScorePage({ svg, activeNotes, selectedBarId, swapHands, onScoreClick, cursorBar, cursorTime, bars, notesById }) {
  const pageRef = useRef(null)
  const playheadRef = useRef(null)
  // Keep the engraved DOM while the playback clock moves. Replacing the SVG
  // would discard the highlight classes and the cursor between note onsets.
  const markup = useMemo(() => ({ __html: svg }), [svg])

  useLayoutEffect(() => {
    const page = pageRef.current
    page.querySelectorAll('.current-note, .selected-score-bar').forEach(element => {
      element.classList.remove('current-note', 'selected-score-bar')
      element.removeAttribute('data-score-hand')
    })
    for (const note of activeNotes) {
      const element = page.querySelector(`#${CSS.escape(note.id)}`)
      if (!element) continue
      const hand = swapHands && note.hand ? (note.hand === 'left' ? 'right' : 'left') : note.hand
      element.classList.add('current-note')
      if (hand) element.dataset.scoreHand = hand
    }
    if (selectedBarId) {
      page.querySelector(`#${CSS.escape(selectedBarId)}`)?.classList.add('selected-score-bar')
    }
  }, [svg, activeNotes, selectedBarId, swapHands])

  useLayoutEffect(() => {
    const root = pageRef.current.firstElementChild
    if (!root) {
      playheadRef.current = null
      return
    }
    if (playheadRef.current?.root !== root) {
      playheadRef.current = { root, overlay: null, bar: null, geometry: null }
    }
    const cursor = playheadRef.current
    if (cursor.bar !== cursorBar) {
      cursor.bar = cursorBar
      cursor.geometry = cursorBar ? measurePlayhead(root, cursorBar) : null
    }
    if (!cursor.geometry) {
      cursor.overlay?.setAttribute('visibility', 'hidden')
      return
    }
    if (!cursor.overlay) cursor.overlay = createPlayhead(root)
    const { points, top, bottom } = cursor.geometry
    const x = playheadX(points, cursorTime)
    cursor.overlay.setAttribute('visibility', 'visible')
    cursor.overlay.setAttribute('transform', `translate(${x} 0)`)
    for (const line of cursor.overlay.children) {
      line.setAttribute('y1', top)
      line.setAttribute('y2', bottom)
    }
  }, [svg, cursorBar, cursorTime])

  function handleClick(event) {
    const root = pageRef.current.firstElementChild
    if (!root || !notesById) return
    const note = nearestNote(root, event, notesById)
    const measure = note?.closest('g.measure[id]') ?? event.target.closest('g.measure[id]')
      ?? measureAtPoint(root, event.clientX, event.clientY)
    if (!measure && !note) return

    const barId = measure?.id
    const bar = cursorBar?.id === barId ? cursorBar : bars.find(candidate => candidate.id === barId)
    let time = note && bar?.anchors.find(anchor => anchor.ids.includes(note.id))?.time
    if (bar && time == null) {
      // A tied continuation or a tap between notes may have no onset event.
      const geometry = measurePlayhead(root, bar)
      const screen = root.getScreenCTM()
      const box = note ? notehead(note)?.getBoundingClientRect() : null
      const x = box?.width ? box.x + box.width / 2 : event.clientX
      const point = screen && new DOMPoint(x, event.clientY).matrixTransform(screen.inverse())
      time = geometry && point ? timeAtX(geometry.points, point.x) : bar.time
      time = Math.min(time, Math.max(bar.time, bar.end - 0.001))
    }
    onScoreClick(note?.id, barId, time ?? undefined)
  }

  return (
    <div
      ref={pageRef}
      className="score-page"
      onClick={handleClick}
      dangerouslySetInnerHTML={markup}
    />
  )
}
