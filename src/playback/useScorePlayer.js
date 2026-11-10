import { useCallback, useEffect, useRef, useState } from 'react'
import * as Tone from 'tone'

export function useScorePlayer(pianoRef) {
  const [status, setStatus] = useState('idle')
  const [position, setPosition] = useState(0)
  const positionRef = useRef(0)
  const requestRef = useRef(0)
  const runRef = useRef(null)
  const partRef = useRef(null)
  const rafRef = useRef(null)

  const moveTo = useCallback((seconds) => {
    positionRef.current = seconds
    setPosition(seconds)
  }, [])

  const clearAudio = useCallback(() => {
    requestRef.current++
    cancelAnimationFrame(rafRef.current)
    rafRef.current = null
    runRef.current = null
    const transport = Tone.getTransport()
    transport.stop()
    partRef.current?.dispose()
    partRef.current = null
    pianoRef.current?.sampler.stop()
  }, [pianoRef])

  useEffect(() => clearAudio, [clearAudio])

  const stop = useCallback(() => {
    clearAudio()
    moveTo(0)
    setStatus('idle')
  }, [clearAudio, moveTo])

  const seek = useCallback((seconds) => {
    clearAudio()
    moveTo(seconds)
    setStatus(previous => previous === 'idle' ? 'idle' : 'paused')
  }, [clearAudio, moveTo])

  const pause = useCallback(() => {
    const run = runRef.current
    const at = run ? run.start + Tone.getTransport().seconds * run.rate : positionRef.current
    seek(at)
  }, [seek])

  const play = useCallback(async ({ start, notes, duration, rate }) => {
    const piano = pianoRef.current
    if (!piano || duration <= 0) return
    clearAudio()
    const request = requestRef.current
    moveTo(start)
    setStatus('loading')
    try {
      await Tone.start()
      await piano.ready
    } catch (error) {
      if (request !== requestRef.current) return
      setStatus('paused')
      throw error
    }
    if (request !== requestRef.current) return

    const transport = Tone.getTransport()
    transport.bpm.value = 60
    transport.position = 0
    const events = []
    for (const note of notes) {
      if (note.end <= start) continue
      const onset = Math.max(note.start, start)
      events.push([(onset - start) / rate, { midi: note.midi, duration: (note.end - onset) / rate }])
    }
    const part = new Tone.Part((time, event) => {
      piano.sampler.start({ note: event.midi, time, duration: event.duration })
    }, events)
    part.start(0)
    partRef.current = part
    runRef.current = { start, rate }
    transport.start()
    setStatus('playing')

    function frame() {
      const seconds = Math.min(duration, start + transport.seconds * rate)
      moveTo(seconds)
      if (seconds >= duration) {
        clearAudio()
        setStatus('idle')
      } else {
        rafRef.current = requestAnimationFrame(frame)
      }
    }
    rafRef.current = requestAnimationFrame(frame)
  }, [clearAudio, moveTo, pianoRef])

  const audition = useCallback(async (midi, duration) => {
    const piano = pianoRef.current
    if (!piano) return false
    const request = ++requestRef.current
    await Tone.start()
    await piano.ready
    if (request !== requestRef.current) return false
    piano.sampler.stop()
    piano.sampler.start({ note: midi, duration })
    return true
  }, [pianoRef])

  return { status, position, play, pause, seek, stop, audition }
}
