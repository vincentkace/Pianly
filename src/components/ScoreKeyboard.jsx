import { memo } from 'react'
import { BLACK_KEY_HEIGHT_RATIO, buildKeyLayout } from '../utils/pianoLayout'

const WIDTH = 1040
const HEIGHT = 72
const layout = Object.entries(buildKeyLayout(WIDTH))
const whiteKeys = layout.filter(([, key]) => !key.black)
const blackKeys = layout.filter(([, key]) => key.black)

export default memo(function ScoreKeyboard({ notes, swapHands }) {
  const active = new Map()
  for (const { midi, hand } of notes) {
    const side = swapHands && hand ? (hand === 'left' ? 'right' : 'left') : hand
    const color = side === 'left' ? 'left' : side === 'right' ? 'right' : 'active'
    const previous = active.get(midi)
    active.set(midi, previous && previous !== color ? 'both' : color)
  }

  function drawKey([midi, key]) {
    const highlight = active.get(Number(midi))
    return (
      <rect
        key={midi}
        data-midi={midi}
        data-highlight={highlight}
        x={key.x}
        y="0"
        width={key.width}
        height={key.black ? HEIGHT * BLACK_KEY_HEIGHT_RATIO : HEIGHT}
        rx={key.black ? 2 : 1}
        className={`score-key ${key.black ? 'black' : 'white'}`}
      />
    )
  }

  return (
    <svg className="score-keyboard" role="img" aria-label="Piano keyboard" viewBox={`0 0 ${WIDTH} ${HEIGHT}`} preserveAspectRatio="none">
      {whiteKeys.map(drawKey)}
      {blackKeys.map(drawKey)}
      {whiteKeys.filter(([midi]) => Number(midi) % 12 === 0).map(([midi, key]) => (
        <text key={midi} x={key.x + key.width / 2} y={HEIGHT - 6} textAnchor="middle">
          C{Math.floor(Number(midi) / 12) - 1}
        </text>
      ))}
    </svg>
  )
})
