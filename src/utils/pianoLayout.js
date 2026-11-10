export const FIRST_MIDI = 21 // A0
export const LAST_MIDI = 108 // C8
export const WHITE_KEY_COUNT = 52
export const BLACK_KEY_HEIGHT_RATIO = 0.6

const BLACK_KEYS = new Set([1, 3, 6, 8, 10])

export function buildKeyLayout(width) {
  const whiteWidth = width / WHITE_KEY_COUNT
  const blackWidth = whiteWidth * 0.65
  const keys = {}
  let whiteIndex = 0
  for (let midi = FIRST_MIDI; midi <= LAST_MIDI; midi++) {
    if (BLACK_KEYS.has(midi % 12)) {
      keys[midi] = { x: whiteIndex * whiteWidth - blackWidth / 2, width: blackWidth, black: true }
    } else {
      keys[midi] = { x: whiteIndex * whiteWidth, width: whiteWidth, black: false }
      whiteIndex++
    }
  }
  return keys
}
