import { midiToNoteName } from '../utils/noteConversion'

const SEMITONES = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 }
const XML_NAMESPACE = 'http://www.w3.org/XML/1998/namespace'
const TIE_TIME_TOLERANCE = 0.001

// Give Verovio the source IDs so its SVG and timemap refer to the same notes.
// Read MIDI pitch from MusicXML itself, including alterations that the importer
// can omit from MIDI when an explicit accidental glyph was not supplied.
export function preparePlaybackScore(xml) {
  const document = new DOMParser().parseFromString(xml, 'text/xml')
  if (document.querySelector('parsererror')) throw new Error('Invalid MusicXML')

  const notesById = new Map()
  const usedIds = new Set(Array.from(document.querySelectorAll('[id]'), el => el.getAttribute('id')))
  const stavesByPart = new Map()
  let nextId = 0
  for (const note of document.querySelectorAll('note')) {
    const pitch = note.querySelector('pitch')
    if (!pitch) continue
    const step = pitch.querySelector('step')?.textContent.trim()
    const octave = Number(pitch.querySelector('octave')?.textContent)
    const alter = Number(pitch.querySelector('alter')?.textContent ?? 0)
    const midi = Math.round((octave + 1) * 12 + SEMITONES[step] + alter)
    if (!Number.isInteger(midi) || midi < 0 || midi > 127) continue

    let id = note.getAttribute('id')
    if (!id) {
      do { id = `pianly-note-${++nextId}` } while (usedIds.has(id))
      usedIds.add(id)
      note.setAttribute('id', id)
    }
    const part = note.closest('part')?.getAttribute('id')
    const staff = Number(note.querySelector('staff')?.textContent ?? 1)
    const voice = note.querySelector('voice')?.textContent.trim() || '1'
    const soundTies = note.getElementsByTagName('tie')
    const ties = Array.from(soundTies.length ? soundTies : note.getElementsByTagName('tied'))
    if (!stavesByPart.has(part)) stavesByPart.set(part, new Set())
    stavesByPart.get(part).add(staff)
    notesById.set(id, {
      id, midi, part, staff, voice, grace: !!note.querySelector('grace'), hand: null,
      tieStart: ties.some(tie => tie.getAttribute('type') === 'start'),
      tieStop: ties.some(tie => tie.getAttribute('type') === 'stop'),
    })
  }

  // A typical piano score has two staves within one part. Leave other parts
  // unassigned so accompaniment does not play in either solo mode.
  const piano = [...stavesByPart].find(([, staves]) => staves.size === 2 && staves.has(1) && staves.has(2))
  if (piano) {
    for (const note of notesById.values()) {
      if (note.part === piano[0]) note.hand = note.staff === 1 ? 'right' : 'left'
    }
  }

  const hasTempo = !!document.querySelector('sound[tempo], metronome > per-minute')
  return { xml: new XMLSerializer().serializeToString(document), notesById, hasTempo, hasHands: !!piano }
}

function mergeTiedNotes(notes, tieSources) {
  const sounds = []
  const pending = new Map()

  for (const note of notes) {
    if (!note.tieStart && !note.tieStop) {
      sounds.push(note)
      continue
    }

    const key = JSON.stringify([note.part, note.midi])
    const candidates = (pending.get(key) ?? []).filter(({ tail }) => tail.end >= note.start - TIE_TIME_TOLERANCE)
    const adjacent = note.tieStop ? candidates.filter(({ tail }) => (
      tail.start < note.start && Math.abs(tail.end - note.start) <= TIE_TIME_TOLERANCE
    )) : []
    const linked = tieSources.get(note.id)
    // Engraved ties identify the exact previous note, including across staves.
    // Sound-only MusicXML ties have no such link, so match within the voice.
    const previous = linked
      ? adjacent.find(({ tail }) => linked.has(tail.id))
      : adjacent.find(({ tail }) => tail.voice === note.voice && tail.staff === note.staff)

    const sound = previous?.sound ?? { ...note }
    if (previous) {
      sound.end = Math.max(sound.end, note.end)
      sound.continuations ??= []
      sound.continuations.push(note)
      candidates.splice(candidates.indexOf(previous), 1)
    } else {
      sounds.push(sound)
    }
    if (note.tieStart) candidates.push({ tail: note, sound })
    if (candidates.length) pending.set(key, candidates)
    else pending.delete(key)
  }

  return sounds
}

export function collectScorePlayback(toolkit, source) {
  const mei = new DOMParser().parseFromString(toolkit.getMEI(), 'text/xml')
  const measures = new Map(Array.from(mei.querySelectorAll('measure'), measure => {
    const id = measure.getAttributeNS(XML_NAMESPACE, 'id')
    return [id, { id, label: measure.getAttribute('n') }]
  }))
  const tieSources = new Map()
  for (const tie of mei.querySelectorAll('tie[startid][endid]')) {
    const start = tie.getAttribute('startid').replace(/^#/, '')
    const end = tie.getAttribute('endid').replace(/^#/, '')
    if (!tieSources.has(end)) tieSources.set(end, new Set())
    tieSources.get(end).add(start)
  }
  // Populate MIDI values for any pitched notes Verovio generated or renamed.
  toolkit.renderToMIDI()
  const timemap = toolkit.renderToTimemap({ includeMeasures: true, includeRests: true })
  const notesById = source.notesById
  const bars = []
  const notes = []
  const openNotes = new Map()
  let bar = null
  let lastTime = 0

  for (const { tstamp, measureOn, on = [], off = [], restsOn = [] } of timemap) {
    if (!Number.isFinite(tstamp)) continue
    const time = Math.max(0, tstamp / 1000)
    lastTime = Math.max(lastTime, time)
    if (measureOn) {
      const measure = measures.get(measureOn) ?? measures.get(toolkit.getNotatedIdForElement(measureOn))
      if (measure) {
        bar = { ...measure, index: bars.length + 1, time, anchors: [] }
        bars.push(bar)
      }
    }
    for (const id of off) {
      const note = openNotes.get(id)
      if (!note) continue
      note.end = Math.max(time, note.start + 0.025)
      openNotes.delete(id)
    }
    for (const eventId of on) {
      const id = notesById.has(eventId) ? eventId : toolkit.getNotatedIdForElement(eventId) || eventId
      let sourceNote = notesById.get(id)
      if (!sourceNote) {
        const midi = toolkit.getMIDIValuesForElement(eventId)?.pitch
        if (!Number.isInteger(midi) || midi < 0 || midi > 127) continue
        sourceNote = { id, midi, hand: null, grace: false }
        notesById.set(id, sourceNote)
      }
      const previous = openNotes.get(eventId)
      if (previous) previous.end = Math.max(time, previous.start + 0.025)
      const note = { ...sourceNote, start: time, end: time + 0.08, bar }
      notes.push(note)
      openNotes.set(eventId, note)
    }
    if (bar && (on.length || restsOn.length)) {
      bar.anchors.push({ time, ids: (on.length ? on : restsOn).map(id => (
        notesById.has(id) ? id : toolkit.getNotatedIdForElement(id) || id
      )) })
    }
  }

  const duration = notes.reduce((end, note) => Math.max(end, note.end), lastTime)
  for (let i = 0; i < bars.length; i++) bars[i].end = bars[i + 1]?.time ?? duration
  const tempo = timemap.find(entry => entry.tempo > 0)?.tempo ?? 120
  return { notes: mergeTiedNotes(notes, tieSources), notesById, bars, duration, tempo, measureIds: [...measures.keys()], hasTempo: source.hasTempo, hasHands: source.hasHands }
}

export function buildPlaybackFrames(notes, bars) {
  const changes = bars.map(bar => ({ time: bar.time, bar }))
  for (const note of notes) {
    changes.push({ time: note.start, on: note, focus: note }, { time: note.end, off: note })
    for (const continuation of note.continuations ?? []) {
      changes.push({ time: continuation.start, focus: continuation })
    }
  }
  changes.sort((a, b) => a.time - b.time)

  const frames = []
  const active = new Set()
  let bar = null
  let focusNotes = []
  let onsets = []
  for (let i = 0; i < changes.length; i++) {
    const change = changes[i]
    if (change.bar) {
      bar = change.bar
      focusNotes = []
    }
    if (change.on) active.add(change.on)
    if (change.focus) onsets.push(change.focus)
    if (change.off) active.delete(change.off)
    if (changes[i + 1]?.time !== change.time) {
      if (onsets.length) focusNotes = onsets
      frames.push({ time: change.time, bar, notes: [...active], focusNotes })
      onsets = []
    }
  }
  return frames
}

export function playbackFrameAt(frames, position) {
  let low = 0
  let high = frames.length
  while (low < high) {
    const middle = (low + high) >>> 1
    if (frames[middle].time <= position) low = middle + 1
    else high = middle
  }
  return frames[low - 1] ?? null
}

// Mic and MIDI practice still advance one onset (possibly a chord) at a time.
export function buildPracticeSteps(notes, rate) {
  const steps = []
  for (const note of notes) {
    if (note.grace) continue
    let step = steps.at(-1)
    if (step?.start !== note.start) {
      step = { start: note.start, timeSec: note.start / rate, measure: note.bar?.index ?? 1, bar: note.bar, notes: [], events: [] }
      steps.push(step)
    }
    const name = midiToNoteName(note.midi)
    if (!step.notes.includes(name)) step.notes.push(name)
    step.events.push(note)
  }
  return steps
}
