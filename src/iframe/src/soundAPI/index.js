// TODO
// - check that this all works in chains and songs

// - work on the correct synth triangle/pulse/sin/noise settings
// - when playing a phrase, let me choose the kind of synth (e.g. triangle/noise)
// - if sustain exists, volume should also just show `-`
// - in chain, show the synth name instead of 0-1-2-3
// - add new API functions to docs and remove `not stable`

import * as Tone from 'tone'
import _ from 'lodash'
import toLetter from '../toLetter.js'
import normalize from '../normalize.js'
import settings from '../settings.js'

const synthOptions = [
  {
    oscillator: {
      type: 'triangle'
    },
    envelope: {
      release: 0.07
    }
  },
  {
    oscillator: {
      type: 'sine'
    },
    envelope: {
      release: 0.07
    }
  },
  {
    oscillator: {
      type: 'sawtooth'
    },
    envelope: {
      release: 0.07
    }
  }
]

const slowToFastTempo = [1, 2, 3, 5, 8, 12, 20, 32]
const fastToSlowTempo = [...slowToFastTempo].reverse()

const tempoToPlaybackRate = tempo => slowToFastTempo[tempo]
const tempoToSubdivision = tempo =>
  fastToSlowTempo.map(i => ({ '16n': i }))[tempo]

const createSynth = ({ volumeNode, index }) => {
  const synth =
    index < 3 ? new Tone.Synth(synthOptions[index]) : new Tone.NoiseSynth()
  if (volumeNode) {
    synth.chain(volumeNode, Tone.Master)
  } else {
    synth.chain(Tone.Master)
  }
  synth.script8Name = index < 3 ? 'synth' : 'noise'
  return synth
}

const stopNote = ({ time = Tone.context.currentTime, synth }) => {
  // If time is not provided, we want to play the note right now - use currentTime.
  // If time is provided,
  // if it is in the past (smaller than currentTime),
  // don't play the note.
  // Otherwise play the note.
  if (time >= Tone.context.currentTime) {
    synth.triggerRelease(time)
  }
}

const playNote = ({
  note,
  octave,
  volume,
  time = Tone.context.currentTime,
  synth,
  tempo
}) => {
  // If time is not provided, we want to play the note right now - use currentTime.
  // If time is provided,
  // if it is in the past (smaller than currentTime),
  // don't play the note.
  // Otherwise play the note.
  if (time >= Tone.context.currentTime) {
    const normalizedVolume = normalize.volume(volume)
    const letter = toLetter(note + octave * 12, true, true)
    const subdivision = tempoToSubdivision(tempo)

    if (synth.script8Name === 'synth') {
      // If the octave is -1, it means we should sustain the previous note.
      // In other words, do nothing.
      if (octave === -1) {
      } else {
        // If the octave is 0 or higher, do something.
        if (typeof tempo === 'undefined') {
          // note, time, velocity
          synth.triggerAttack(letter, time, normalizedVolume)
        } else {
          // note, duration, time, velocity
          synth.triggerAttackRelease(
            letter,
            subdivision,
            time,
            normalizedVolume
          )
        }
      }
    } else {
      // TODO: handle noise synths
      // duration, time, velocity
      // synth.triggerAttackRelease(subdivision, time, normalizedVolume)
    }
  }
}

const soundAPI = volumeNode => {
  const chainSynths = _.range(settings.chainChannels).map(index =>
    createSynth({ volumeNode, index })
  )
  const phraseSynth = createSynth({ volumeNode, index: 0 })

  Tone.Transport.bpm.value = settings.bpm
  Tone.Transport.start(settings.startOffset)

  let songContainers = {}
  let chainContainers = {}
  let localPhrases = {}
  let phrasePool = []

  const stopChain = () => {
    _.forEach(chainContainers, ({ sequence }, key) => {
      if (sequence) {
        sequence.stop()
      }
    })
  }

  const stopSong = () => {
    // Stop all sequences.
    // console.log('soundAPI.stopSong() BEGIN----------')
    // const before = Date.now()
    _.forEach(songContainers, ({ sequence }, key) => {
      if (sequence) {
        sequence.stop()
        // console.log(`stopping song with key: ${key}`)
      }
    })
    // const after = Date.now()
    // console.log(`soundAPI.stopSong() END ${after - before}ms`)
  }

  const makeSongsAndChains = ({ songs, chains, phrases }) => {
    // console.log(`soundAPI.makeSongs() BEGIN----------`)
    // const before = Date.now()
    stopSong()
    stopChain()
    localPhrases = phrases
    songContainers = _.mapValues(songs, song =>
      makeSongContainer({ song, chains, phrases })
    )
    chainContainers = _.mapValues(chains, chain =>
      makeChainContainer({ chain, phrases })
    )
    // const after = Date.now()
    // console.log(`soundAPI.makeSongs() END ${after - before}ms`)
  }

  const makeChainContainer = ({ chain, phrases }) => {
    const notePositions = _(_.range(Math.pow(settings.matrixLength, 2)))
      .map(index => {
        // Get the phrase and note positions by using base math.
        const [phrasePosition, notePosition] = _.padStart(
          index.toString(settings.matrixLength),
          2,
          0
        )
          .split('')
          .map(d => parseInt(d, settings.matrixLength))

        // Get the phrase indices for this position, e.g. { 0: 0, 1: 11, 2: 2 }
        const phrasesIndices = _.get(chain, phrasePosition)

        // For each channel,
        return (
          _.range(settings.chainChannels)
            .map(channel => {
              // get the phrase index.
              const phraseIndex = _.get(phrasesIndices, channel)

              let result
              // If the phrase index exists,
              if (!_.isNil(phraseIndex)) {
                // get the phrase assigned to this channel.
                const phrase = _.get(phrases, phraseIndex, {})

                // Get the note element for this position.
                const noteElement = _.get(phrase.notes, notePosition)

                // If we have a note,
                if (!_.isNil(noteElement)) {
                  // add it to the result.
                  result = {
                    channel,
                    noteElement,
                    tempo: chain.tempo
                  }
                }
              }
              return result
              //   })
            })
            // Only keep non-null elements.
            .filter(d => d)
        )
      })
      // NOW we can drop from right.
      .dropRightWhile(_.isEmpty)
      .value()

    const callback = (time, position) => {
      notePositions[position].forEach(d => {
        const { channel, noteElement, tempo } = d
        playNote({
          ...noteElement,
          time: time,
          synth: chainSynths[channel],
          tempo: tempo
        })
      })
    }

    const events = _.range(notePositions.length)

    return {
      callback,
      events,
      sequence: null,
      tempo: chain.tempo
    }
  }

  const makeSongContainer = ({ song, chains, phrases }) => {
    // const before = Date.now()
    // Create an array of note positions.
    // There's a lot going on here, but the gist:
    // create an array of all the notes, but remove nulls from the end,
    // so that we can make a Tone Sequence that is the right length and no more.
    // This is good for performance.

    // For matrixLength cubed (chains * phrases * notes),
    const notePositions = _(_.range(Math.pow(settings.matrixLength, 3)))
      .map(index => {
        // Get the chain, phrase and note positions by using base math.
        const [chainPosition, phrasePosition, notePosition] = _.padStart(
          index.toString(settings.matrixLength),
          3,
          0
        )
          .split('')
          .map(d => parseInt(d, settings.matrixLength))

        // Get the chain index for this position.
        const chainIndex = _.get(song, chainPosition)

        // Get the chain.
        const chain = _.get(chains, chainIndex)

        // Get the phrase indices for this position, e.g. { 0: 0, 1: 11, 2: 2 }
        const phrasesIndices = _.get(chain, phrasePosition)

        // For each channel,
        return (
          _.range(settings.chainChannels)
            .map(channel => {
              // Get the phrase index for this channel.
              const phraseIndex = _.get(phrasesIndices, channel)
              let result

              // If the phrase index exists,
              if (!_.isNil(phraseIndex)) {
                // get the phrase assigned to this channel.
                const phrase = _.get(phrases, phraseIndex, {})

                // Get the note element for this position.
                const noteElement = _.get(phrase.notes, notePosition)

                // If we have a note,
                if (!_.isNil(noteElement)) {
                  // add it to the result.
                  result = {
                    channel,
                    noteElement,
                    tempo: song.tempo
                  }
                }
              }
              return result
            })
            // Only keep non-null elements.
            .filter(d => d)
        )
      })
      // NOW we can drop from right.
      .dropRightWhile(_.isEmpty)
      .value()

    const callback = (time, position) => {
      notePositions[position].forEach(d => {
        const { channel, noteElement, tempo } = d
        playNote({
          ...noteElement,
          time: time,
          synth: chainSynths[channel],
          tempo: tempo
        })
      })
    }

    const events = _.range(notePositions.length)

    // const after = Date.now()
    // console.log(`soundAPI.makeSongContainer() took ${after - before}ms`)

    return {
      callback,
      events,
      sequence: null,
      tempo: song.tempo
    }
  }

  const playSong = (number, loop = false) => {
    // console.log(`soundAPI.playSong() BEGIN----------`)
    // const before = Date.now()
    stopSong()

    // console.log(`going to play song with key ${number}`)
    _.forEach(songContainers, (value, key) => {
      if (+key === number) {
        // console.log(`found one: key ${key}`)
        value.sequence = new Tone.Sequence(
          value.callback,
          value.events,
          settings.subdivision
        )
        value.sequence.loop = loop
        value.sequence.playbackRate = tempoToPlaybackRate(value.tempo)
        value.sequence.start(settings.startOffset)
      }
    })
    // const after = Date.now()
    // console.log(`soundAPI.playSong() END took ${after - before}ms`)
  }

  const playChain = (number, loop = false) => {
    // console.log(`soundAPI.playSong() BEGIN----------`)
    // const before = Date.now()
    stopChain()

    // console.log(`going to play song with key ${number}`)
    _.forEach(chainContainers, (value, key) => {
      if (+key === number) {
        // console.log(`found one: key ${key}`)
        value.sequence = new Tone.Sequence(
          value.callback,
          value.events,
          settings.subdivision
        )
        value.sequence.loop = loop
        value.sequence.playbackRate = tempoToPlaybackRate(value.tempo)
        value.sequence.start(settings.startOffset)
      }
    })
    // const after = Date.now()
    // console.log(`soundAPI.playSong() END took ${after - before}ms`)
  }

  const playPhrase = number => {
    // const before = Date.now()
    const phrase = _.get(localPhrases, number)
    if (phrase) {
      while (phrasePool.length) {
        const popped = phrasePool.pop()
        popped.dispose()
      }

      const { tempo } = phrase

      const sequence = new Tone.Sequence(
        (time, index) => {
          const value = phrase.notes[index]
          if (value) {
            // console.log(`phraseSynth volume`)
            // console.log({ volume: phraseSynth.volume.value })
            playNote({ ...value, time, synth: phraseSynth, tempo })
          }
        },
        _.range(settings.matrixLength),
        settings.subdivision
      )
      sequence.loop = false
      sequence.playbackRate = tempoToPlaybackRate(tempo)
      sequence.start()
      phrasePool.push(sequence)
      // const after = Date.now()
      // console.log(`soundAPI.playPhrase() took ${after - before}ms`)
    }
  }
  return {
    playPhrase,
    playChain,
    stopChain,
    playSong,
    stopSong,
    makeSongsAndChains
  }
}

export { createSynth, playNote, stopNote, tempoToPlaybackRate }

export default soundAPI
