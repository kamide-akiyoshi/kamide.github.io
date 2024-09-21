
const Music = class {
  static FLAT    = '\u{266D}';
  static NATURAL = '\u{266E}';
  static SHARP   = '\u{266F}';
  static DOUBLE_SHARP = '\u{1D12A}';
  static DOUBLE_FLAT  = '\u{1D12B}';
  static majorPitchNameAt = hour => [
    String.fromCharCode('A'.charCodeAt(0) + 4 * (hour + 18) % 7),
    [
      Music.DOUBLE_FLAT,
      Music.FLAT,
      '',
      Music.SHARP,
      Music.DOUBLE_SHARP
    ][Math.trunc((hour + 15) / 7)]
  ];
  static togglePitchNumberAndMajorHour = (n, offset=60) => ((n & 1) ? n + 6 : n) + offset;
  static enharmonicallyEquals = (hour1, hour2) => (hour1 - hour2 + 36) % 12 === 0;
  static normalizeHourAsKey = hour => {
    while( Math.abs(hour) > 7 ) hour -= 12 * Math.sign(hour);
    return hour;
  };
  static keySignatureTextAt = hour => {
    if( ! hour ) return '';
    const n = Math.abs(hour);
    const fs = hour < 0 ? Music.FLAT : Music.SHARP;
    if( n == 1 ) return fs;
    return `${n > 2 ? n : fs}${fs}`;
  };
  static keyTextOf = (hour = 0, minor) => {
    const textAt = (hour) => Music.majorPitchNameAt(hour).join('');
    return minor ? `${textAt(hour + 3)}m` : textAt(hour);
  };
}

const MIDI = class {
  static DRUM_CHANNEL = 9;
  static NUMBER_OF_CHANNELS = 16;
  static FREQUENCIES = Array.from(
    {length: 128},
    (_, midiNoteNumber) => 440 * (2 ** ((midiNoteNumber - 69)/12))
  );
};

const SimpleSynthesizer = class {
  static get audioContext() {
    if( ! SimpleSynthesizer._audioContext ) {
      try {
        const AudioContext = window.AudioContext ?? window.webkitAudioContext;
        SimpleSynthesizer._audioContext = new AudioContext();
      }
      catch(e) {
        alert('Web Audio API is not supported in this browser');
      }
    }
    return SimpleSynthesizer._audioContext;
  };
  constructor() {
    const envelopeSliders = {
      attackTime:   document.getElementById('attack'),
      decayTime:    document.getElementById('decay'),
      sustainLevel: document.getElementById('sustain'),
      releaseTime:  document.getElementById('release'),
    };
    const termsSliders = [
      Array.from(document.querySelectorAll(`#periodicWaveRealTerms input`)),
      Array.from(document.querySelectorAll(`#periodicWaveImagTerms input`)),
    ];
    const waves = {
      ...(["sawtooth", "square", "triangle", "sine"].reduce(
        (basicWaves, key) => {
          basicWaves[key] = {iconFile: `image/${key}.svg`};
          return basicWaves;
        },{}
      )),
      custom: {
        iconFile: "image/wave.svg",
        getTerms: () => termsSliders.map(
          sliders => [0, ...sliders.map(e => parseInt(e.value))]
        ),
      },
    };
    const waveselect = document.getElementById('waveselect');
    if( waveselect ) {
      Object.keys(waves).forEach(key => {
        const option = document.createElement("option");
        option.appendChild(document.createTextNode(key));
        waveselect.appendChild(option);
      });
      waveselect.value = "sawtooth";
      const img = document.getElementById('wave');
      if( img ) {
        const termsElement = termsSliders[0][0].parentElement.parentElement;
        const setWave = waveName => {
          const wave = waves[waveName];
          img.src = wave.iconFile;
          const cl = termsElement.classList;
          wave.getTerms ? cl.remove("hidden") : cl.add("hidden");
        };
        waveselect.addEventListener('change', event => setWave(event.target.value));
        setWave(waveselect.value);
      }
    }
    const getMixer = () => {
      if( !this.mixer ) {
        const volumeSlider = document.getElementById('volume') ?? { value: 0.4 };
        const context = SimpleSynthesizer.audioContext;
        const mixer = this.mixer = context.createGain();
        const { gain } = mixer;
        const changeVolume = () => gain.value = volumeSlider.value ** 2;
        volumeSlider.addEventListener?.('input', changeVolume);
        changeVolume();
        mixer.connect(context.destination);
      }
      return this.mixer;
    }
    const NOISE_TIME = 0.1; // [sec]
    const createNoiseBuffer = () => {
      const { sampleRate } = SimpleSynthesizer.audioContext;
      const length = sampleRate * NOISE_TIME;
      const noiseBuffer = new AudioBuffer({ length, sampleRate });
      const data = noiseBuffer.getChannelData(0);
      for( let i = 0; i < length; i++ ) {
        data[i] = Math.random() * 2 - 1;
      }
      return noiseBuffer;
    };
    const createVoice = (channel, frequency) => {
      const context = SimpleSynthesizer.audioContext;
      const velocityGain = context.createGain();
      velocityGain.gain.value = 0;
      velocityGain.connect(channel.ampan.amplifier);
      const envelope = context.createGain();
      envelope.gain.value = 0;
      envelope.connect(velocityGain);
      let source, modulator, modulatorGain;
      if( frequency ) {
        source = context.createOscillator();
        source.frequency.value = frequency;
        modulator = context.createOscillator();
        modulator.frequency.value = 8;
        modulatorGain = context.createGain();
        modulatorGain.gain.value = 0;
        modulator.connect(modulatorGain);
        modulatorGain.connect(source.frequency);
      } else {
        source = context.createBufferSource();
        source.buffer = this.noiseBuffer ??= createNoiseBuffer();
        source.loop = true;
      }
      source.connect(envelope);
      source.start();
      modulator?.start();
      let timeoutIdToStop;
      const voice = {
        attack: (velocity) => {
          voice.isPressing = true;
          clearTimeout(timeoutIdToStop);
          timeoutIdToStop = undefined;
          const { gain } = envelope;
          gain.cancelScheduledValues(context.currentTime);
          let sustainLevel;
          let attackTime;
          if( source instanceof OscillatorNode ) {
            const waveKey = waveselect?.value ?? "sawtooth";
            const { getTerms } = waves[waveKey];
            if( getTerms ) {
              source.setPeriodicWave(context.createPeriodicWave(...getTerms()));
            } else {
              source.type = waveKey;
            }
            sustainLevel = envelopeSliders.sustainLevel.value;
            attackTime = envelopeSliders.attackTime.value;
          } else {
            sustainLevel = 0;
            attackTime = 0;
          }
          velocityGain.gain.value = velocity / 0x7F;
          const t1 = context.currentTime + (attackTime - 0);
          if( attackTime ) {
            gain.linearRampToValueAtTime(1, t1);
          } else {
            gain.value = 1;
          }
          if( sustainLevel < 1 ) {
            const decayTime = frequency ? envelopeSliders.decayTime.value : NOISE_TIME;
            gain.setTargetAtTime(sustainLevel, t1, decayTime);
          }
        },
        release: stopped => {
          if( timeoutIdToStop ) return;
          delete voice.isPressing;
          const { gain } = envelope;
          const gainValueToStop = 0.001;
          const stop = () => {
            timeoutIdToStop = undefined;
            gain.cancelScheduledValues(context.currentTime);
            gain.value = 0;
            source.stop();
            modulator?.stop();
            stopped && stopped();
          };
          if( gain.value <= gainValueToStop ) { stop(); return; }
          const releaseTime = source instanceof OscillatorNode ? envelopeSliders.releaseTime.value : NOISE_TIME;
          if( !releaseTime ) { stop(); return; }
          const delay = Math.log(gain.value / gainValueToStop) * releaseTime;
          if( delay <= 0 ) { stop(); return; }
          gain.cancelScheduledValues(context.currentTime);
          gain.setTargetAtTime(0, context.currentTime, releaseTime);
          timeoutIdToStop = setTimeout(stop, delay * 1000);
        },
        changeFrequency: newFrequency => {
          frequency && (source.frequency.value = newFrequency);
        },
        changeModulation: gainValue => {
          modulatorGain && (modulatorGain.gain.value = gainValue);
        },
      };
      return voice;
    };
    const midiChannels = this.midiChannels = Array.from(
      {length: MIDI.NUMBER_OF_CHANNELS},
      (_, channelNumber) => ({
        isDrum: channelNumber == MIDI.DRUM_CHANNEL,
        voices: new Map(),
        setParameterNumber(control, value) {
          // Control#
          //   NRPN (Non-Registered Parameter Number)
          //     0x62: LSB
          //     0x63: MSB
          //   RPN (Registered Parameter Number)
          //     0x64: LSB
          //     0x65: MSB
          const pn = this.parameterNumber ??= {};
          pn.isRegistered = !!(control & 4);
          pn[control & 1 ? "MSB" : "LSB"] = value;
        },
        set parameterValue(value) {
          const pn = this.parameterNumber;
          if( !pn ) {
            console.warn(`Warning: MIDI CH.${channelNumber + 1}: No parameter number received yet, value ${value} ignored`);
            return;
          }
          const { MSB, LSB, isRegistered } = pn;
          if( isRegistered && MSB === 0 && LSB === 0 ) {
            this.pitchBendSensitivity = value;
          }
        },
        pitchBendSensitivity: 2,
        pitchRatio: 1,
        set pitchBendValue(value) {
          const r = this.pitchRatio = Math.pow(2, value * this.pitchBendSensitivity / ((1 << 13) * 12));
          this.voices.forEach(
            (voice, noteNumber) => voice.changeFrequency(MIDI.FREQUENCIES[noteNumber] * r)
          );
        },
        set modulationDepth(value) {
          this.voices.forEach(
            (voice, noteNumber) => voice.changeModulation(value / 16)
          );
        },
        _volume: 100,
        _expression: 0x7F,
        get gainValueToSet() {
          return (this._volume / 0x7F) * (this._expression / 0x7F)
        },
        get ampan() {
          if( !this._ampan ) {
            const context = SimpleSynthesizer.audioContext;
            const panner = context.createStereoPanner();
            panner.connect(getMixer());
            const amplifier = context.createGain();
            this._ampan = { amplifier, panner };
            amplifier.gain.value = this.gainValueToSet;
            amplifier.connect(panner);
          }
          return this._ampan;
        },
        set volume(value) {
          this._volume = value;
          this.ampan.amplifier.gain.value = this.gainValueToSet;
        },
        set expression(value) {
          this._expression = value;
          this.ampan.amplifier.gain.value = this.gainValueToSet;
        },
        set pan(value) {
          const context = SimpleSynthesizer.audioContext;
          // MIDI Control# 0x0A's value: 0(L) ... 0x7F(R)
          // Web Audio API's panner value: -1(L) ... 1(R)
          this.ampan.panner.pan.setValueAtTime((value - 0x40) / 0x40, context.currentTime);
        },
        resetAllControllers() {
          delete this.parameterNumber;
          this.pitchRatio = 1;
          this.pitchBendSensitivity = 2;
          this.volume = 100;
          this.expression = 0x7F;
          this.pan = 0x40;
        },
        allSoundOff() {
          const { voices } = this;
          voices.forEach((voice, noteNumber) => voice.release(() => voices.delete(noteNumber)));
        },
        noteOff(noteNumber) {
          const { voices } = this;
          voices.get(noteNumber)?.release(() => voices.delete(noteNumber));
        },
        noteOn(noteNumber, velocity) {
          const { isDrum, pitchRatio, voices } = this;
          let voice = voices.get(noteNumber);
          const isNewVoice = !voice?.isPressing;
          if( !voice ) {
            voice = createVoice(
              this,
              isDrum ? undefined : MIDI.FREQUENCIES[noteNumber] * pitchRatio
            );
            voices.set(noteNumber, voice);
          }
          voice.attack(velocity);
          return isNewVoice;
        },
      }) // Array.from
    ); // midiChannels
  }; // constuctor
};

const PianoKeyboard = class {
  noteOn = (channel, noteNumber, velocity) => {
    const isNewVoice = this.synth.midiChannels[channel].noteOn(noteNumber, velocity);
    if( channel != MIDI.DRUM_CHANNEL && isNewVoice ) {
      this.toneIndicatorCanvas.noteOn(noteNumber);
    }
  };
  noteOff = (channel, noteNumber) => {
    this.synth.midiChannels[channel].noteOff(noteNumber);
    if( channel != MIDI.DRUM_CHANNEL ) {
      this.toneIndicatorCanvas.noteOff(noteNumber);
    }
  };
  allSoundOff = (channel) => {
    this.synth.midiChannels[channel].allSoundOff();
    this.toneIndicatorCanvas.allSoundOff();
  };
  handleMidiMessage = (msg) => {
    const {
      noteOff,
      noteOn,
      allSoundOff,
      synth,
    } = this;
    const [statusWithCh, ...data] = msg;
    const channel = statusWithCh & 0xF;
    const status = statusWithCh & 0xF0;
    switch(status) {
      case 0x90:
        if( data[1] ) { // velocity > 0
          noteOn(channel, data[0], data[1]);
          break;
        }
        // fallthrough: velocity === 0 means Note Off
      case 0x80:
        noteOff(channel, data[0]);
        break;
      case 0xB0: // Control Change
        switch(data[0]) {
          // MSB: 0x00 ... 0x1F
          case 0x01: // Modulation
            synth.midiChannels[channel].modulationDepth = data[1];
            break;
          case 0x06: // RPN/NRPN Data Entry
            synth.midiChannels[channel].parameterValue = data[1];
            break;
          case 0x07: // Channel Volume
            synth.midiChannels[channel].volume = data[1];
            break;
          case 0x0A: // Pan
            synth.midiChannels[channel].pan = data[1];
            break;
          case 0x0B: // Expression
            synth.midiChannels[channel].expression = data[1];
            break;
          // LSB: 0x20 ... 0x3F
          //  :
          //  :
          // RPN/NRPN
          // case 0x60: // Data Increment
          // case 0x61: // Data Decrement
          case 0x62:
          case 0x63:
          case 0x64:
          case 0x65:
            synth.midiChannels[channel].setParameterNumber(...data);
            break;
          case 0x78: // All Sound Off
            if( data[1] == 0 ) { // Must be 0
              allSoundOff(channel);
            }
            break;
          case 0x79: // Reset All Controllers
            synth.midiChannels[channel].resetAllControllers();
            break;
        }
        break;
      case 0xE0: // Pitch Bend Change
        synth.midiChannels[channel].pitchBendValue = (data[1] * (1 << 7) + data[0]) - (1 << 13);
        break;
    }
  };
  setupMidiChannelSelecter = () => {
    const element = document.getElementById('midi_channel');
    Array.from(
      {length: MIDI.NUMBER_OF_CHANNELS},
      (_, ch) => {
        const option = document.createElement("option");
        option.value = ch;
        option.appendChild(document.createTextNode(`${ch + 1}${ch == MIDI.DRUM_CHANNEL ? ' (Drum)' : ''}`));
        element.appendChild(option);
      }
    );
    this.midiChannelSelecter = {
      get selectedChannel() { return parseInt(element?.value); }
    };
  };
  manualNoteOn = (noteNumber, orderInChord) => {
    const ch = this.midiChannelSelecter.selectedChannel;
    const velocity = this.velocitySlider.value - 0;
    this.sendWebMidiLinkMessage?.([0x90 | ch, noteNumber, velocity]);
    this.selectedMidiOutputPorts.noteOn(ch, noteNumber, velocity);
    this.noteOn(ch, noteNumber, velocity);
    const keys = this.pianoKeys;
    const { pressed } = keys;
    if( pressed.has(noteNumber) ) {
      this.manualNoteOff(noteNumber);
    }
    pressed.set(noteNumber, ch);
    !orderInChord && this.chord.classLists.clear();
    const key = keys[noteNumber];
    if( key ) {
      const { element } = key;
      if( element ) {
        const cl = element.classList;
        cl.add('pressed');
        orderInChord && this.chord.classLists.add(cl, orderInChord == 1);
      }
    }
  };
  manualNoteOff = noteNumber => {
    const keys = this.pianoKeys;
    const { pressed } = keys;
    if( pressed.has(noteNumber) ) {
      const ch = pressed.get(noteNumber);
      this.sendWebMidiLinkMessage?.([0x90 | ch, noteNumber, 0]);
      this.selectedMidiOutputPorts.noteOff(ch, noteNumber);
      this.noteOff(ch, noteNumber);
      pressed.delete(noteNumber);
    }
    keys[noteNumber]?.element?.classList.remove('pressed');
  };
  leftEnd = {
    set note(n) {
      this._chordNote = n + 5;
      this._noteC = Math.ceil(n / 12) * 12;
    },
    reset() {
      const n = 4 * 12 + 5;
      this._initialWhiteKeyIndex = Math.ceil(7 * n / 12);
      this.note = n;
    },
    get initialWhiteKeyIndex() { return this._initialWhiteKeyIndex; },
    get chordNote() { return this._chordNote; },
    get noteC() { return this._noteC; },
  };
  chord = {
    classLists: [],
    setup() {
      const createDetachableElementEntry = id => {
        const element = document.getElementById(id);
        if( !element ) return undefined;
        const parent = element.parentNode;
        return {
          element,
          attach: (text) => {
            text && (element.innerHTML = text);
            parent.contains(element) || parent.appendChild(element);
          },
          detach: () => {
            parent.contains(element) && parent.removeChild(element);
          },
        };
      };
      const chord = this;
      chord.label = createDetachableElementEntry('chord');
      chord.dialCenterLabel = createDetachableElementEntry('center_chord');
      chord.keySignatureSetButton = document.getElementById('setkey');
      chord.classLists.clear = () => {
        while( chord.classLists.length ) chord.classLists.pop().remove('chord', 'root');
      };
      chord.classLists.add = (classList, root) => {
        classList.add('chord');
        root && classList.add('root');
        chord.classLists.push(classList);
      }
    },
    clear: () => {
      const { chord } = this;
      const {
        label,
        dialCenterLabel,
        classLists,
        keySignatureSetButton,
        buttonCanvas,
      } = chord;
      label?.detach();
      dialCenterLabel?.detach();
      delete chord.hour;
      delete chord.rootPitchName;
      delete chord.rootPitchNumber;
      delete chord.offset3rd;
      delete chord.offset5th;
      delete chord.offset7th;
      delete chord.add9th;
      keySignatureSetButton.style.visibility = 'hidden';
      buttonCanvas.clearChord();
      classLists.clear();
    },
    stop: () => {
      this.pianoKeys.pressed.forEach((value, key) => this.manualNoteOff(key - 0));
      this.chord.buttonCanvas.disableStrum();
    },
    start: () => {
      const {
        leftEnd,
        chord,
      } = this;
      const {
        hour,
        label,
        dialCenterLabel,
        button,
        keySignature,
        keySignatureSetButton,
        offset3rd,
        offset5th,
        offset7th,
        add9th,
        stop,
        buttonCanvas,
        classLists,
      } = chord;
      stop();
      if( !hour && hour !== 0 ) return;
      const majorRootHour = hour + (offset3rd < 0 ? 3 : 0);
      const rootPitchNumber = Music.togglePitchNumberAndMajorHour(majorRootHour);
      let i = 0;
      const noteOn = n => {
        const noteNumber = n - Math.floor((n - leftEnd.chordNote) / 12) * 12;
        this.manualNoteOn(noteNumber, ++i);
      };
      classLists.clear();
      noteOn(rootPitchNumber);
      noteOn(rootPitchNumber + 4 + offset3rd);
      noteOn(rootPitchNumber + 7 + offset5th);
      offset7th && noteOn(rootPitchNumber + 8 + offset7th);
      add9th && noteOn(rootPitchNumber + 14);
      chord.notes = Array.from(this.pianoKeys.pressed.keys());
      buttonCanvas.selectChord();
      buttonCanvas.enableStrum();
      const rootPitchName = Music.majorPitchNameAt(majorRootHour);
      if( ! rootPitchName ) return;
      if( label || dialCenterLabel ) {
        let sub = '', sup = '';
        if( offset3rd < 0 && offset5th < 0 && offset7th == 1 ) {
          sup += 'dim' + (add9th ? '9':'7');
        } else {
          offset3rd < 0 && (sub += 'm');
          offset5th > 0 && (sup += 'aug');
          sup += (add9th ? ['add9','69','9','M9'] : ['','6','7','M7'])[offset7th];
          offset5th < 0 && (sup += '-5');
          offset3rd > 0 && (sup += 'sus4');
        }
        let text = rootPitchName[0];
        const fs = rootPitchName[1];
        fs && (text += `<sup>${fs}</sup>`);
        sub && (text += `<sub>${sub}</sub>`);
        sup && (text += `<sup style="font-size: 70%;">${sup}</sup>`);
        label?.attach(text);
        dialCenterLabel?.attach(text);
      }
      keySignatureSetButton.style.visibility = Music.enharmonicallyEquals(hour, keySignature.value) ? 'hidden' : 'visible';
      keySignatureSetButton.textContent = Music.keySignatureTextAt(Music.normalizeHourAsKey(hour)) || Music.NATURAL;
    },
    strum: (direction) => {
      const {
        chord: { notes },
        manualNoteOff,
        manualNoteOn,
      } = this;
      let currentIndex = notes.currentIndex + direction;
      if( isNaN(currentIndex) ) {
        if( direction >= 0 ) currentIndex = 0;
        else if( direction < 0 ) currentIndex = notes.length - 1;
      } else {
        if ( currentIndex >= notes.length ) currentIndex = 0;
        else if ( currentIndex < 0 ) currentIndex = notes.length - 1;
      }
      const noteNumber = notes[notes.currentIndex = currentIndex];
      manualNoteOff(noteNumber);
      manualNoteOn(noteNumber, currentIndex + 1);
    },
  };
  createSelectedMidiOutputPorts = () => {
    const ports = [];
    ports.addPort = port => ports.push(port);
    ports.removePort = port => {
      const i = ports.findIndex(p => p.id === port.id);
      i < 0 || ports.splice(i, 1);
    };
    ports.send = (message) => ports.forEach(port => port.send(message));
    ports.noteOn = (channel, noteNumber, velocity = 64) => ports.send([0x90 + channel, noteNumber, velocity]);
    ports.noteOff = (channel, noteNumber) => ports.send([0x90 + channel, noteNumber, 0]);
    return ports;
  };
  setupMidiPorts = () => {
    const midiElement = document.getElementById('midi');
    if( ! midiElement ) return;
    if( ! window.isSecureContext ) {
      console.warn("Warning: Not in secure context - MIDI IN/OUT not allowed");
    }
    // MIDI port selecter
    const midiMessageListener = msg => this.handleMidiMessage(msg.data);
    const selectedMidiOutputPorts = this.selectedMidiOutputPorts = this.createSelectedMidiOutputPorts();
    const checkboxes = {
      eventToAddOrRemove: event => event.target.checked ? "add" : "remove",
      get: port => midiElement.querySelector(`input[value="${port.id}"]`),
      add: port => {
        if( checkboxes.get(port) ) return;
        const cb = document.createElement("input");
        cb.type = "checkbox";
        cb.name = `midi_${port.type}`;
        cb.value = port.id;
        const label = document.createElement("label");
        label.appendChild(cb);
        const manufacturerText = port.manufacturer ? ` (${port.manufacturer})` : "";
        label.appendChild(document.createTextNode(`${port.name}${manufacturerText}`));
        document.getElementById(cb.name).appendChild(label);
        switch(port.type) {
          case "input":
            cb.addEventListener("change", event => {
              port[`${checkboxes.eventToAddOrRemove(event)}EventListener`]("midimessage", midiMessageListener);
            });
            break;
          case "output":
            cb.addEventListener("change", event => {
              selectedMidiOutputPorts[`${checkboxes.eventToAddOrRemove(event)}Port`](port);
            });
            break;
        };
      },
      remove: port => {
        switch(port.type) {
          case "input":
            port.removeEventListener("midimessage", midiMessageListener);
            break;
          case "output":
            selectedMidiOutputPorts.removePort(port);
            break;
        };
        checkboxes.get(port)?.closest("label").remove();
      },
    };
    navigator.requestMIDIAccess({
      sysex: true,
      software: false,
    }).then(access => {
      access.inputs.forEach(checkboxes.add);
      access.outputs.forEach(checkboxes.add);
      access.addEventListener("statechange", ({ port }) => {
        switch(port.state) {
          case "connected": // USB MIDI plugged
            checkboxes.add(port);
            break;
          case "disconnected": // USB MIDI unplugged
            checkboxes.remove(port);
            break;
        }
      });
    }).catch(msg => {
      alert(msg);
    });
  };
  setupWebMidiLink = () => {
    window.addEventListener('message', event => {
      const msg = event.data.split(",");
      const msgType = msg.shift();
      switch(msgType) {
        case 'midi':
          this.handleMidiMessage(msg.map(hexStr => parseInt(hexStr, 16)));
          break;
      }
    });
    const urlElement = document.getElementById('WebMidiLinkUrl');
    const loadButton = document.getElementById('LoadWebMidiLinkUrl');
    const iFrame = document.getElementById('WebMidiLinkSynth');
    if( urlElement && loadButton && iFrame ) {
      const parent = iFrame.parentNode;
      const attach = () => parent.contains(iFrame) || parent.appendChild(iFrame);
      const detach = () => parent.contains(iFrame) && parent.removeChild(iFrame);
      const send = (msg) => {
        const str = msg.reduce((str, num) => `${str},${(num).toString(16)}`, "midi");
        iFrame.contentWindow.postMessage(str, "*");
      };
      detach();
      loadButton.addEventListener('click', () => {
        const url = urlElement.value;
        if( url ) {
          attach();
          iFrame.onload = () => {
            this.sendWebMidiLinkMessage = send;
          };
          iFrame.src = url;
        } else {
          delete this.sendWebMidiLinkMessage;
          iFrame.onload = undefined;
          iFrame.src = undefined;
          detach();
        }
      });
    }
  };
  setupToneIndicatorCanvas = (canvas) => {
    const BASS_MAX_NOTE_NUMBER = 48;
    const { dial, width, height, keySignature } = this.toneIndicatorCanvas = canvas;
    const { center, borderRadius } = dial;
    const toneIndicating = Array.from({ length: 12 }, () => 0);
    const bassToneIndicating = [...toneIndicating];
    const getColorOf = (hour, flatThreshold) => {
      let offset = hour - keySignature?.value + 1; // min:-6, max:19 (when hour:0...11, keySignature:-7...7)
      if( offset < 0 ) offset += 12; else if ( offset >= 12 ) offset -= 12;
      return dial.themeColor.indicator[offset < 7 ? 1 : offset < flatThreshold ? 2 : 0];
    };
    const majorDirections = toneIndicating.map((_, hour) => {
      const diffToAngle = (diff = 0) => (hour + diff) * Math.PI / 6;
      const rootClockAngle = diffToAngle(-0.5);
      const centerClockAngle = diffToAngle();
      return {
        dx: center.dx(rootClockAngle),
        dy: center.dy(rootClockAngle),
        center: {
          dx: center.dx(centerClockAngle),
          dy: center.dy(centerClockAngle),
        },
        arc: {
          angle : diffToAngle(-3.5),
          bassAngles: [diffToAngle(-3.3), diffToAngle(-2.7)],
        },
      };
    });
    const context = canvas.getContext("2d");
    // Primitive drawers
    const drawRadial = (direction, startRadius, endRadius) => {
      context.beginPath();
      context.moveTo(
        center.x + startRadius * direction.dx,
        center.y + startRadius * direction.dy
      );
      context.lineTo(
        center.x + endRadius * direction.dx,
        center.y + endRadius * direction.dy
      );
      context.stroke();
    };
    const drawArc = (radius, ...angles) => {
      context.beginPath();
      context.arc(
        center.x,
        center.y,
        radius * width,
        ...angles
      );
      context.stroke();
    }
    // For best performance, Pre-calculate frequently accessed radiuses
    const average2 = (a, b) => (a + b) / 2;
    const radiusOf = (rs, n) => rs[0] + (rs[1] - rs[0]) / n;
    const shortRadiusesOf = (rs) => [rs[0], radiusOf(rs, 4)];
    //minor
    const minorRadiuses = borderRadius.slice(0, 2);
    const minorShortRadiuses = shortRadiusesOf(minorRadiuses);
    const minorCenterRadius = minorRadiuses.reduce(average2);
    const minorBassRadius = radiusOf(minorRadiuses, 5);
    // major
    const majorRadiuses = borderRadius.slice(1, 3);
    const majorShortRadiuses = shortRadiusesOf(majorRadiuses);
    const majorBassRadius = radiusOf(majorRadiuses, 5);
    // sus4
    const sus4Radiuses = [borderRadius[2], borderRadius[3] - 0.005];
    const sus4CenterRadius = sus4Radiuses.reduce(average2);
    // drawers
    const drawSus4 = (dir, fifthDir, rootColor, sus4Color, fifthColor) => {
      const angles = [dir.arc.angle, fifthDir.arc.angle];
      context.strokeStyle = rootColor; drawArc(sus4Radiuses[0], ...angles);
      drawRadial(dir, ...sus4Radiuses);
      context.strokeStyle = sus4Color; drawArc(sus4Radiuses[1], ...angles);
      context.strokeStyle = fifthColor; drawRadial(fifthDir, ...sus4Radiuses);
    };
    const drawAug = (startDir, endDir) => {
      drawRadial(startDir.center, ...sus4Radiuses);
      drawArc(sus4CenterRadius, startDir.arc.angle, endDir.arc.angle);
    };
    const tritoneArcArgs = [0.03 * width, 0, 2 * Math.PI];
    const drawTritone = (hour) => {
      const direction = majorDirections[hour].center;
      context.beginPath();
      context.arc(
        center.x + minorCenterRadius * direction.dx,
        center.y + minorCenterRadius * direction.dy,
        ...tritoneArcArgs
      );
      context.stroke();
    };
    const draw = (hour) => {
      const hour1ccw = hour ? hour - 1 : 11;
      const hour2ccw = hour + (hour < 2 ? 10 : -2);
      const hour3ccw = hour + (hour < 3 ? 9 : -3);
      const hour4ccw = hour + (hour < 4 ? 8 : -4);
      const hour6 = hour + (hour < 6 ? 6 : -6);
      const hour4 = hour + (hour < 8 ? 4 : -8);
      const hour3 = hour + (hour < 9 ? 3 : -9);
      const hour1 = hour < 11 ? hour + 1 : 0;
      context.lineWidth = 3;
      context.strokeStyle = getColorOf(hour, 8);
      drawRadial(majorDirections[hour], ...majorRadiuses);
      if( toneIndicating[hour4] ) {
        const directions = [
          majorDirections[hour],
          majorDirections[hour1],
        ];
        const arcAngles = directions.map(d => d.arc.angle);
        if( toneIndicating[hour1] ) { // root:hour + major3rd:hour4 + 5th:hour1 = major chord
          drawArc(borderRadius[2], ...arcAngles);
        }
        if( toneIndicating[hour3] ) { // root:hour3 + minor3rd:hour + 5th:hour4 = minor chord
          drawArc(borderRadius[0], ...arcAngles);
        }
        context.strokeStyle = getColorOf(hour4, 11); drawArc(borderRadius[1], ...arcAngles);
        if( toneIndicating[hour4ccw] ) { // Augumented chords
          const hour5 = hour + (hour < 7 ? 5 : -7);
          // Augumented 5th (#5th, 8 hours CW / 4 hours CCW) color
          context.strokeStyle = getColorOf(hour4ccw, 12); drawAug(...directions);
          context.strokeStyle = getColorOf(hour,     12); drawAug(majorDirections[hour4], majorDirections[hour5]);
          context.strokeStyle = getColorOf(hour4,    12); drawAug(majorDirections[hour4ccw], majorDirections[hour3ccw]);
        }
      }
      context.strokeStyle = getColorOf(hour, 11);
      drawRadial(majorDirections[hour3ccw], ...minorRadiuses);
      if( toneIndicating[hour4ccw] ) {
        const arcAngles = [
          majorDirections[hour4ccw].arc.angle,
          majorDirections[hour3ccw].arc.angle,
        ];
        drawArc(borderRadius[1], ...arcAngles);
        if( toneIndicating[hour3ccw] ) { // root:hour4ccw + major3rd:hour + 5th:hour3ccw = major chord
          context.strokeStyle = getColorOf(hour4ccw, 8); drawArc(borderRadius[2], ...arcAngles);
        }
        if( toneIndicating[hour1ccw] ) { // root:hour1ccw + minor3rd:hour4ccw + 5th:hour = minor chord
          context.strokeStyle = getColorOf(hour4ccw, 8); drawArc(borderRadius[0], ...arcAngles);
        }
      }
      context.strokeStyle = getColorOf(hour1, 11); drawRadial(majorDirections[hour2ccw], ...minorShortRadiuses);
      context.strokeStyle = getColorOf(hour1, 8); drawRadial(majorDirections[hour1], ...majorShortRadiuses);
      if( toneIndicating[hour1] ) {
        if( toneIndicating[hour3ccw] ) { // root:hour + minor3rd:hour3ccw + 5th:hour1 = minor chord
          context.strokeStyle = getColorOf(hour3ccw, 8);
          drawArc(
            borderRadius[0],
            majorDirections[hour3ccw].arc.angle,
            majorDirections[hour2ccw].arc.angle
          );
        }
        if( toneIndicating[hour1ccw] ) { // root:hour + sus4:hour1ccw + 5th:hour1 = sus4 chord
          drawSus4(
            majorDirections[hour],
            majorDirections[hour1],
            getColorOf(hour, 8),
            getColorOf(hour1ccw, 7),
            getColorOf(hour1, 8)
          );
        }
        const hour2 = hour + (hour < 10 ? 2 : -10);
        if( toneIndicating[hour2] ) { // root:hour1 + sus4:hour + 5th:hour2 = sus4 chord
          drawSus4(
            majorDirections[hour1],
            majorDirections[hour2],
            getColorOf(hour1, 8),
            getColorOf(hour, 7),
            getColorOf(hour2, 8)
          );
        }
      }
      if( toneIndicating[hour1ccw] ) {
        if( toneIndicating[hour3] ) { // root:hour1ccw + major3rd:hour3 + 5th:hour = major chord
          context.strokeStyle = getColorOf(hour1ccw, 8);
          drawArc(
            borderRadius[2],
            majorDirections[hour1ccw].arc.angle,
            majorDirections[hour].arc.angle
          );
        }
        if( toneIndicating[hour2ccw] ) { // root:hour1ccw + sus4:hour2ccw + 5th:hour = sus4 chord
          drawSus4(
            majorDirections[hour1ccw],
            majorDirections[hour],
            getColorOf(hour1ccw, 8),
            getColorOf(hour2ccw, 7),
            getColorOf(hour, 8)
          );
        }
      }
      if( toneIndicating[hour6] ) { // Tritone
        // Diminished 5th (b5th, 6 hour CW/CCW) color
        context.strokeStyle = getColorOf(hour6, 7); drawTritone(hour3ccw);
        context.strokeStyle = getColorOf(hour,  7); drawTritone(hour3);
      }
    };
    const drawBass = (hour) => {
      const hour3ccw = hour + (hour < 3 ? 9 : -3);
      context.lineWidth = 7;
      context.strokeStyle = getColorOf(hour, 8);  drawArc(majorBassRadius, ...majorDirections[hour].arc.bassAngles);
      context.strokeStyle = getColorOf(hour, 11); drawArc(minorBassRadius, ...majorDirections[hour3ccw].arc.bassAngles);
    };
    const redrawAll = () => {
      context.clearRect(0, 0, width, height);
      toneIndicating.forEach((weight, hour) => weight && draw(hour));
      bassToneIndicating.forEach((weight, hour) => weight && drawBass(hour));
    }
    canvas.noteOn = (noteNumber) => {
      const bass = noteNumber <= BASS_MAX_NOTE_NUMBER;
      const majorHour = Music.togglePitchNumberAndMajorHour(noteNumber) % 12;
      if( toneIndicating[majorHour]++ === 0 ) {
        draw(majorHour);
      }
      if( bass && bassToneIndicating[majorHour]++ === 0 ) {
        drawBass(majorHour);
      }
    };
    canvas.noteOff = (noteNumber) => {
      const bass = noteNumber <= BASS_MAX_NOTE_NUMBER;
      const hour = Music.togglePitchNumberAndMajorHour(noteNumber) % 12;
      let redrawRequired;
      if( --toneIndicating[hour] <= 0) {
        toneIndicating[hour] = 0;
        redrawRequired = true;
      }
      if( bass && --bassToneIndicating[hour] <= 0 ) {
        bassToneIndicating[hour] = 0;
        redrawRequired = true;
      }
      redrawRequired && redrawAll();
    };
    canvas.allSoundOff = () => {
      toneIndicating.fill(0);
      bassToneIndicating.fill(0);
      redrawAll();
    };
  };
  setupMidiSequencer = () => {
    const {
      chord,
      toneIndicatorCanvas,
      selectedMidiOutputPorts,
    } = this;
    const textDecoders = {};
    const decoderOf = (encoding) => textDecoders[encoding] ??= new TextDecoder(encoding);
    const hasValidChunkId = (byteArray, validChunk) => {
      const chunk = decoderOf("UTF-8").decode(byteArray.subarray(0, validChunk.length));
      if( chunk != validChunk ) {
        console.error(`Invalid chunk '${chunk}' - Valid chunk is: '${validChunk}'`);
        return false;
      }
      return true;
    };
    const parseText = (byteArray) => {
      let text;
      let encoding;
      try {
        encoding = Encoding.detect(byteArray) || "sjis";
        text = decoderOf(encoding).decode(byteArray);
      } catch(error) {
        const defaultEncoding = "sjis";
        text = decoderOf(defaultEncoding).decode(byteArray);
        console.warn(
          `Failed to decode as "${encoding}", so force "${defaultEncoding}", and decoded to "${text}" from the source data:`,
          byteArray, error);
      }
      return text.replace(/\0/g, '');
    };
    const parseSignedByte = (b) => (b & 0x80) ? b - 0x100 : b;
    const parseBigEndian = (byteArray) => byteArray.reduce((out, n) => (out << 8) + n);
    const parseVariableLengthValue = (byteArray) => {
      let value = 0;
      let valueLength = 0;
      while(valueLength < 4) {
        const b = byteArray[valueLength++];
        value <<= 7;
        value += (b & 0x7F);
        if( (b & 0x80) == 0 ) break;
      }
      return [value, byteArray.subarray(valueLength)];
    };
    const parseVariableLengthData = (byteArray) => {
      const [length, valuesByteArray] = parseVariableLengthValue(byteArray);
      const out = [valuesByteArray.subarray(0, length)];
      length < valuesByteArray.length && out.push(valuesByteArray.subarray(length));
      return out;
    };
    const parseMetaEvent = (byteArray, event) => {
      if( (event.metaType = byteArray[0]) == 0x2F ) {
        return undefined; // End Of Track
      }
      const [data, nextByteArray] = parseVariableLengthData(byteArray.subarray(1));
      switch(event.metaType) {
        case 0x51:
          event.tempo = { microsecondsPerQuarter: parseBigEndian(data) };
          break;
        case 0x58:
          event.timeSignature = {
            numerator: data[0],
            denominator: 1 << data[1],
            clocksPerTick: data[2],
            noteted32ndsPerQuarter: data[3],
          };
          break;
        case 0x59:
          event.keySignature = parseSignedByte(data[0]);
          if( data[1] == 1 ) event.minor = true;
          break;
        default:
          if( event.metaType > 0 && event.metaType < 0x10 ) {
            event.text = parseText(data);
            break;
          }
          event.metaData = data;
          break;
      }
      return nextByteArray;
    };
    const parseSystemExclusive = (byteArray, event) => {
      const [data, nextByteArray] = parseVariableLengthData(byteArray);
      event.systemExclusive = data;
      return nextByteArray;
    };
    const parseFixedLengthEvent = (byteArray, event, length) => {
      event.data = byteArray.subarray(0, length);
      return length < byteArray.length ? byteArray.subarray(length) : undefined;
    };
    const parseMidiEvent = (byteArray, event, runningStatus) => {
      const topByte = byteArray[0];
      const statusOmitted = !(topByte & 0x80);
      const status = statusOmitted ? runningStatus : topByte;
      let dataLength;
      switch(status & 0xF0) {
        case 0xF0:
          switch(status) {
            //
            // Meta Event: Only for sequencer, Not for MIDI port
            case 0xFF: return parseMetaEvent(byteArray.subarray(1), event);
            //
            // System Common Message
            case 0xF7: // System Exclusive (splited)
            case 0xF0: // System Exclusive
              return parseSystemExclusive(byteArray.subarray(1), event);
            case 0xF2: // Song Position (0xF2, LSB, MSB)
              dataLength = 3;
              break;
            case 0xF1: // Quarter Frame (0xF1, timecode)
            case 0xF3: // Song Select (0xF3, song#)
              dataLength = 2;
              break;
            default: // Status byte only
              // 0xF6: Tune Request
              // 0xF4: Undefined
              // 0xF5: Undefined
              //
              // System Realtime Message
              // 0xF8...0xFE (0xFF: Reset - Not for MIDI file)
              //
              dataLength = 1;
              break;
          }
          return parseFixedLengthEvent(byteArray, event, dataLength);
        case 0xC0: // Program Change (0xC0, Program#)
        case 0xD0: // Channel Pressure (0xD0, PressureValue)
          dataLength = 2;
          break;
        // case 0xE0: // Pitch Bend Change (7-bit Little Endian: -8192 ... +8191)
        // case 0x80: // Note Off (NoteNumber, Velocity)
        // case 0x90: // Note On (NoteNumber, Velocity)
        // case 0xA0: // Polyphonic Key Pressure (NoteNumber, PressureValue)
        // case 0xB0: // Control Change (Control#, Value)
        default:
          dataLength = 3;
          break;
      }
      if( statusOmitted ) {
        const nextByteArray = parseFixedLengthEvent(byteArray, event, dataLength - 1);
        event.data = [runningStatus, ...event.data];
        return nextByteArray;
      }
      return parseFixedLengthEvent(byteArray, event, dataLength);
    };
    const insertEvent = (events, event) => {
      const { tick } = event;
      const index = events.findLastIndex((e) => e.tick <= tick);
      events.splice((index < 0 ? 0 : index) + 1, 0, event);
    };
    const parseMidiSequence = (sequenceByteArray) => {
      if( !hasValidChunkId(sequenceByteArray, "MThd") ) {
        throw new Error(`Invalid MIDI file format`);
      }
      const headerChunkSize = parseBigEndian(sequenceByteArray.subarray(4, 8));
      const sequence = {
        formatType: parseBigEndian(sequenceByteArray.subarray(8, 10)),
        tickLength: 0,
        tracks: [],
        keySignatures: [],
        tempos: [],
        timeSignatures: [],
        lyrics: [],
        markers: [],
      };
      const numberOfTrack = parseBigEndian(sequenceByteArray.subarray(10, 12));
      const timeDivisionArray = sequenceByteArray.subarray(12, 14);
      if( timeDivisionArray[0] & 0x80 ) {
        alert(`Warning: SMPTE resolution not supported`);
        sequence.framesPerSec = timeDivisionArray[0] & 0x7F;
        sequence.ticksPerFrame = timeDivisionArray[1];
      } else {
        sequence.ticksPerQuarter = parseBigEndian(timeDivisionArray);
      }
      const tracksByteArray = sequenceByteArray.subarray(8 + headerChunkSize);
      let karaokeLyricsMetaType;
      Array.from({ length: numberOfTrack }).reduce(
        (tracksByteArray) => {
          if( !tracksByteArray ) { // No more track
            return undefined;
          }
          if( !hasValidChunkId(tracksByteArray, "MTrk") ) {
            console.warn(`Invalid MIDI track chunk`);
          }
          const trackChunkSize = parseBigEndian(tracksByteArray.subarray(4, 8));
          const nextTrackTop = 8 + trackChunkSize;
          let trackByteArray = tracksByteArray.subarray(8, nextTrackTop);
          const events = [];
          let tick = 0;
          let runningStatus;
          const mergedLyrics = {
            lastFragmentTick: 0,
            createEvent: (event) => {
              karaokeLyricsMetaType = event.metaType;
              const lastTick = events.findLast((e) => e.metaType === karaokeLyricsMetaType)?.tick ?? 0;
              mergedLyrics.lastFragmentTick = tick;
              const createdEvent = mergedLyrics.event = {
                ...event,
                tick: tick - Math.min(sequence.ticksPerQuarter * 2, tick - lastTick),
                metaType: 5,
              };
              insertEvent(sequence.lyrics, createdEvent);
              insertEvent(events, createdEvent);
              event.lyricsNextPosition = event.text.length;
            },
            appendTextOf: (event) => {
              mergedLyrics.lastFragmentTick = tick;
              const mergedEvent = mergedLyrics.event;
              event.lyricsNextPosition = (mergedEvent.text = mergedEvent.text.concat(event.text)).length;
            },
          };
          while(true) {
            const [deltaTime, eventByteArray] = parseVariableLengthValue(trackByteArray);
            tick += deltaTime;
            const event = { tick };
            trackByteArray = parseMidiEvent(eventByteArray, event, runningStatus);
            if( "metaType" in event ) {
              switch(event.metaType) {
                case 1: // Text
                  if( event.text.charAt(0) === '\\' ) {
                    event.text = event.text.slice(1);
                    mergedLyrics.createEvent(event);
                  } else if( mergedLyrics.event ) {
                    if( event.text.charAt(0) === '/' ) event.text = event.text.replace('/', '\n');
                    mergedLyrics.appendTextOf(event);
                  }
                  break;
                case 3: // Sequence/Track name
                  if( event.text ) events.title = event.text;
                  break;
                case 5: // Lyrics
                  if( karaokeLyricsMetaType === 1 ) {
                    break;
                  }
                  if ( event.text.charAt(0) === '\n' ) {
                    event.text = event.text.slice(1);
                    mergedLyrics.createEvent(event);
                    break;
                  }
                  if ( mergedLyrics.event?.text.length > 127 ) {
                    if( tick - mergedLyrics.lastFragmentTick > sequence.ticksPerQuarter * 2 ) {
                      mergedLyrics.createEvent(event);
                      break;
                    }
                  }
                  if( karaokeLyricsMetaType === 5 && mergedLyrics.event ) {
                    mergedLyrics.appendTextOf(event);
                    break;
                  }
                  if( karaokeLyricsMetaType === undefined ) {
                    const length = event.text.trim().length;
                    if( 0 < length && length < 4 ) {
                      mergedLyrics.createEvent(event);
                      break;
                    }
                  }
                  sequence.lyrics.push(event);
                  break;
                case 6: sequence.markers.push(event); break;
                case 0x51: sequence.tempos.push(event); break;
                case 0x58: sequence.timeSignatures.push(event); break;
                case 0x59: sequence.keySignatures.push(event); break;
              }
            }
            if( !(karaokeLyricsMetaType === 1 && event.metaType === 5) ) {
              events.push(event);
            }
            if( !trackByteArray ) break;
            runningStatus = event.data?.[0];
          }
          sequence.tracks.push(events);
          if( tick > sequence.tickLength ) sequence.tickLength = tick;
          return nextTrackTop < tracksByteArray.length ? tracksByteArray.subarray(nextTrackTop) : undefined;
        },
        tracksByteArray
      );
      const ascendingByTick = (e1, e2) => e1.tick < e2.tick ? -1 : e1.tick > e2.tick ? 1 : 0;
      [
        "keySignatures",
        "tempos",
        "timeSignatures",
        "lyrics",
        "markers",
      ].forEach((key) => sequence[key].sort(ascendingByTick))
      const title = sequence.tracks.find((track) => track.title)?.title
      if( title ) sequence.title = title;
      return sequence;
    };
    let lastTimeSignatureEvent;
    const currentLyrics = {
      element: document.getElementById("lyrics"),
      pastElement: document.getElementById("past_lyrics"),
      clear: () => {
        delete currentLyrics.text;
        currentLyrics.element.innerText =
        currentLyrics.pastElement.innerText = "";
      },
      setText: (text) => {
        currentLyrics.text = text;
        currentLyrics.pastElement.innerText = "";
        currentLyrics.element.innerText = text;
      },
      proceedText: (nextPosition) => {
        const t = currentLyrics.text;
        currentLyrics.element.innerText = t.slice(nextPosition);
        currentLyrics.pastElement.innerText = t.slice(0, nextPosition);
      },
    };
    const doMetaEvent = (event) => {
      const { metaType } = event;
      switch(metaType) {
        case 5:
          if( "lyricsNextPosition" in event && currentLyrics.element.textContent ) {
            currentLyrics.proceedText(event.lyricsNextPosition);
          } else {
            currentLyrics.setText(event.text);
          }
          break;
        case 6:
          markerElement.textContent = event.text ? `Marker: ${event.text}` : "";
          break;
        case 0x51:
          changeTempo(event.tempo.microsecondsPerQuarter);
          tempoElement.classList.remove("grayout");
          break;
        case 0x58:
          {
            const { numerator, denominator } = event.timeSignature;
            timeSignatureElement.textContent = `${numerator}/${denominator}`;
            timeSignatureElement.classList.remove("grayout");
            lastTimeSignatureEvent = event;
          }
          break;
        case 0x59:
          {
            const hour = event.keySignature;
            toneIndicatorCanvas.keySignature.value = hour;
            chord.clear(); // To hide key signature change button
            keyElement.textContent = `Key:${Music.keyTextOf(hour, event.minor)}`;
            keyElement.classList.remove("grayout");
          }
          break;
        default:
          if( "text" in event ) {
            const { text } = event;
            if( "lyricsNextPosition" in event && currentLyrics.element.textContent && metaType === 1 ) {
              currentLyrics.proceedText(event.lyricsNextPosition);
            } else if( midiSequence.title != text ) {
              textElement.textContent = text;
            }
          }
          break;
      }
    };
    const darkModeSelect = document.getElementById("dark_mode_select");
    const midiFileNameElement = document.getElementById("midi_file_name");
    const tickPositionSlider = document.getElementById("time_position");
    const timeSignatureElement = document.getElementById("time_signature");
    const keyElement = document.getElementById("key");
    const tempoElement = document.getElementById("tempo");
    const bpmElement = document.getElementById("bpm");
    const titleElement = document.getElementById("song_title");
    const markerElement = document.getElementById("song_marker");
    const textElement = document.getElementById("song_text");
    let midiSequence;
    const midiSequenceElement = document.getElementById("midi_sequence");
    document.getElementById("top")?.addEventListener('click', () => setTickPosition(0));
    document.getElementById("play_pause")?.addEventListener('click', () => intervalId ? pause() : play());
    const playPauseIcon = document.getElementById("play_pause_icon");
    tickPositionSlider?.addEventListener("change", (event) => {
      !intervalId && setTickPosition(parseInt(event.target.value));
    });
    const midiSequencerElement = midiSequenceElement.parentElement;
    midiSequencerElement.removeChild(midiSequenceElement);
    const setMidiSequence = (seq) => {
      midiSequence = seq;
      textElement.textContent = "";
      currentLyrics.clear();
      markerElement.textContent = "";
      titleElement.textContent = midiSequence.title ?? "";
      lastTimeSignatureEvent = {
        tick: 0,
        timeSignature: {
          numerator: 4,
          denominator: 4,
        }
      };
      changeTempo(500000);
      [
        tempoElement,
        keyElement,
        timeSignatureElement,
      ].forEach((element) => element.classList.add("grayout"));
      timeSignatureElement.textContent = "4/4";
      keyElement.textContent = `Key:${Music.keyTextOf()}`;
      tickPositionSlider && (tickPositionSlider.max = midiSequence.tickLength);
      if( darkModeSelect.value == "light" ) {
        darkModeSelect.value = "dark";
        darkModeSelect.dispatchEvent(new Event("change"));
      }
      setTickPosition(0);
      midiSequencerElement.prepend(midiSequenceElement);
    }
    const loadMidiFile = (file) => {
      file?.arrayBuffer().then((ab) => {
        const seq = parseMidiSequence(new Uint8Array(ab))
        midiFileNameElement.textContent = (seq.file = file).name;
        setMidiSequence(seq);
        play();
      }).catch((error) => {
        console.error(`Could not load MIDI file ${file.name}:`, error);
        alert(error);
      });
    };
    const midiFileInput = document.getElementById("midi_file");
    const midiFileDropZone = document.getElementsByTagName("body")[0];
    document.getElementById("midi_file_select_button")?.addEventListener("click", () => {
      midiFileInput.click();
    });
    midiFileInput.addEventListener("change", () => loadMidiFile(midiFileInput.files[0]));
    midiFileDropZone.addEventListener("dragenter", (event) => {
      event.stopPropagation();
      event.preventDefault();
    });
    midiFileDropZone.addEventListener("dragover", (event) => {
      event.stopPropagation();
      event.preventDefault();
    });
    midiFileDropZone.addEventListener("drop", (event) => {
      event.stopPropagation();
      event.preventDefault();
      loadMidiFile(event.dataTransfer.files[0]);
    });
    let tickPosition = 0;
    const setTickPosition = (tick) => {
      pause();
      tickPosition = tick;
      tickPositionSlider && (tickPositionSlider.value = tick);
      setBeatAt(tick);
      if( !midiSequence ) {
        return;
      }
      const doLastMetaEvent = (array) => {
        const lastEvent = array.findLast((event) => event.tick <= tick);
        lastEvent && doMetaEvent(lastEvent);
      }
      doLastMetaEvent(midiSequence.timeSignatures);
      doLastMetaEvent(midiSequence.keySignatures);
      doLastMetaEvent(midiSequence.tempos);
      currentLyrics.clear();
      doLastMetaEvent(midiSequence.lyrics);
      markerElement.textContent = "";
      doLastMetaEvent(midiSequence.markers);
      midiSequence.tracks.forEach((track, index) => {
        if( tick === 0 ) {
          // Top
          track.currentEventIndex = 0;
          return;
        } else if( tick >= midiSequence.tickLength ) {
          // Bottom
          track.currentEventIndex = track.length - 1;
          return;
        }
        // Binary search
        let [low, mid, high] = [0, 0, track.length - 1];
        while( low <= high ) {
          mid = Math.floor((low + high) / 2);
          const eventTick = track[mid].tick;
          if( eventTick > tick ) {
            high = mid - 1;
          } else if( eventTick < tick - midiSequence.ticksPerQuarter ) {
            low = mid + 1;
          } else {
            break;
          }
        }
        track.currentEventIndex = mid;
      });
    };
    let beat = 0;
    const beatCanvas = document.getElementById("circleOfFifthsClockBeatCanvas");
    const setBeatAt = (tick) => {
      const {
        tick: lastTick,
        timeSignature: {
          numerator,
          denominator,
        },
      } = lastTimeSignatureEvent;
      const ticksPerBeat = midiSequence.ticksPerQuarter * (4 / denominator);
      const newBeat = Math.floor((tick - lastTick) / ticksPerBeat) % numerator;
      if( beat != newBeat ) {
        beat = newBeat;
        if( beatCanvas ) {
          const context = beatCanvas.getContext("2d");
          const { width, height, dial } = toneIndicatorCanvas;
          const center = dial.center;
          const n = (numerator - 1) || 1;
          const startAngle = - Math.PI / 2;
          const endAngle = startAngle - 2 * Math.PI * (n - beat) / n;
          context.clearRect(0, 0, width, height);
          context.fillStyle = "#808080";
          context.beginPath();
          context.arc(
            center.x,
            center.y,
            dial.borderRadius[0] * width * 3 / 4,
            startAngle,
            endAngle,
            true
          );
          context.arc(
            center.x,
            center.y,
            dial.borderRadius[0] * width / 2,
            endAngle,
            startAngle,
          );
          context.fill();
        }
      }
    };
    const INTERVAL_MILLI_SEC = 10;
    let ticksPerInterval;
    const changeTempo = (uspq) => {
      bpmElement.textContent = Math.floor(60000000 / uspq);
      ticksPerInterval = 1000 * INTERVAL_MILLI_SEC * (midiSequence.ticksPerQuarter / uspq);
    };
    const sendMidiMessage = (midiMessage) => {
      this.handleMidiMessage(midiMessage);
      this.sendWebMidiLinkMessage?.(midiMessage);
      try {
        selectedMidiOutputPorts.send(midiMessage);
      } catch(e) {
        console.error(midiMessage, e);
      }
    };
    let intervalId;
    const pause = () => {
      clearInterval(intervalId);
      intervalId = undefined;
      this.synth.midiChannels.forEach((_, ch) => {
        sendMidiMessage([0xB0 + ch, 0x78, 0]); // All Sound Off
        sendMidiMessage([0xE0 + ch, 0, 0x40]); // Reset Pitch Bend to center
      });
      if( playPauseIcon ) {
        playPauseIcon.src = "image/play-button-svgrepo-com.svg";
        playPauseIcon.alt = "Play";
      }
    };
    const play = () => {
      if( !midiSequence || intervalId ) return;
      const { tickLength, tracks } = midiSequence;
      intervalId = setInterval(
        () => {
          if( tickPositionSlider ) tickPositionSlider.value = tickPosition;
          tracks.forEach((events) => {
            while(true) {
              const event = events[events.currentEventIndex];
              if( !event || event.tick > tickPosition ) {
                break;
              }
              if( "metaType" in event ) {
                doMetaEvent(event); // NOTE: Meta event must not be sent to MIDI port
              } else {
                const { data } = event;
                if( data ) sendMidiMessage(data);
              }
              events.currentEventIndex++;
            }
          });
          setBeatAt(tickPosition);
          if( (tickPosition += ticksPerInterval) > tickLength ) {
            pause();
            setTickPosition(0);
          }
        },
        INTERVAL_MILLI_SEC
      );
      if( playPauseIcon ) {
        playPauseIcon.src = "image/pause-button-svgrepo-com.svg";
        playPauseIcon.alt = "Pause";
      }
    };
  };
  setupPianoKeyboard = () => {
    const {
      leftEnd,
    } = this;
    leftEnd.reset();
    const keyboard = document.getElementById('pianokeyboard');
    if( !keyboard ) {
      return;
    }
    let pointerdown = 'mousedown';
    let pointerup = 'mouseup';
    let pointerenter = 'mouseenter';
    let pointerleave = 'mouseleave';
    if( typeof window.ontouchstart !== 'undefined' ) {
      pointerdown = 'touchstart';
      pointerup = 'touchend';
    }
    const {
      manualNoteOn,
      manualNoteOff,
      chord,
    } = this;
    const pianoKeys = this.pianoKeys = MIDI.FREQUENCIES.map((_) => ({}));
    pianoKeys.pressed = new Map();
    const [
      whiteKeyElement,
      blackKeyElement,
      frequencyElement,
    ] = keyboard.getElementsByTagName('*');
    const [
      whiteKeyWidth,
      xOffsets
    ] = [
      whiteKeyElement,
      blackKeyElement
    ].map((element, noteNumber) => {
      pianoKeys[noteNumber].element = element;
      const w = element.clientWidth + 2 * element.clientLeft;
      return noteNumber ? Array.from({length: 5}, (_, hour) => hour<2 ? w - w/(4-hour) : w/hour) : w;
    });
    let [whiteKeyLeft, hour] = [0, 6];
    pianoKeys.forEach((pianoKey, noteNumber) => {
      if( hour >= 5 ) { // F(5) C(6) G(7) D(8) A(9) E(10) B(11)
        if( whiteKeyLeft ) {
          keyboard.appendChild(pianoKey.element = whiteKeyElement.cloneNode());
          pianoKey.element.style.left = `${whiteKeyLeft}px`;
        }
        if( hour == 9 ) {
          const newFrequencyElement = frequencyElement.cloneNode();
          newFrequencyElement.innerHTML = MIDI.FREQUENCIES[noteNumber];
          newFrequencyElement.style.left = pianoKey.element.style.left;
          keyboard.appendChild(newFrequencyElement);
        }
        whiteKeyLeft += whiteKeyWidth;
        hour -= 5;
      } else { // Gb(0) Db(1) Ab(2) Eb(3) Bb(4)
        if( ! pianoKey.element ) {
          keyboard.appendChild(pianoKey.element = blackKeyElement.cloneNode());
        }
        pianoKey.element.style.left = `${whiteKeyLeft - xOffsets[hour]}px`;
        hour += 7;
      }
      const { element } = pianoKey;
      element.addEventListener(pointerdown, e => {
        chord.clear();
        manualNoteOn(noteNumber);
        keyboard.focus();
        e.preventDefault();
      });
      element.addEventListener(pointerenter, e => {
        if( e.buttons & 1 ) {
          manualNoteOn(noteNumber);
        }
      });
      const handleOff = e => {
        manualNoteOff(noteNumber);
      };
      element.addEventListener(pointerup, handleOff);
      element.addEventListener(pointerleave, handleOff);
      element.addEventListener('contextmenu', e => e.preventDefault());
    });
    keyboard.scrollLeft = whiteKeyWidth * leftEnd.initialWhiteKeyIndex;
    keyboard.addEventListener("scroll",
      event => {
        const { scrollLeft, scrollWidth } = event.target;
        leftEnd.note = Math.ceil(pianoKeys.length * scrollLeft / scrollWidth)
      }
    );
    ['dblclick','selectstart'].forEach(type => keyboard.addEventListener(type, e => e.preventDefault()));
    const pcKey = {
      bindings: Object.fromEntries(
        [
          ...Array.from("Q2W3ER5T6Y7UI9O0P", c => `${c < 10 ? "Digit" : "Key"}${c}`),
          "BracketLeft", "Equal", "BracketRight",
        ].map((code, index) => [code, index])
      ),
      activeNoteNumbers: {},
    };
    keyboard.addEventListener("keydown", e => {
      if( e.repeat ) return;
      const { activeNoteNumbers } = pcKey;
      if( e.code in activeNoteNumbers ) return;
      const index = pcKey.bindings[e.code] ?? -1;
      if( index < 0 ) return;
      const noteNumber = index + leftEnd.noteC;
      manualNoteOn(noteNumber);
      activeNoteNumbers[e.code] = noteNumber;
      chord.clear();
    });
    keyboard.addEventListener("keyup", e => {
      const { activeNoteNumbers } = pcKey;
      manualNoteOff(activeNoteNumbers[e.code]);
      delete activeNoteNumbers[e.code];
    });
  };
  constructor(toneIndicatorCanvas) {
    this.synth = new SimpleSynthesizer();
    const {
      chord,
      setupMidiChannelSelecter,
      setupMidiPorts,
      setupWebMidiLink,
      setupMidiSequencer,
      setupToneIndicatorCanvas,
      setupPianoKeyboard,
    } = this;
    this.velocitySlider = document.getElementById('velocity') ?? { value: 64 };
    chord.setup();
    setupMidiChannelSelecter();
    setupToneIndicatorCanvas(toneIndicatorCanvas);
    setupMidiPorts();
    setupWebMidiLink();
    setupMidiSequencer();
    setupPianoKeyboard();
  }
}

const CircleOfFifthsClock = class {
  static themeColors = {
    light: {
      foreground: 'black',
      grayoutForeground: 'gray',
      background: {
        donut: ['#99CCFF', '#FB99CC', '#FFFF99'],
        pie: ['#FB99CC', '#FFFF66', '#CCFFCC', '#99CCFF'],
      },
      hourBorder: {
        fine: 'rgb(0, 0, 0, 0.2)',
        coarse: 'rgb(0, 0, 0, 0.6)',
      },
      hand: {
        hour: 'rgba(0, 0, 0, 0.5)',
        minute: 'rgba(0, 0, 0, 0.5)',
        second: '#ff4000',
      },
      indicator: ['blue', 'firebrick', 'darkorange'],
    },
    dark: {
      foreground: '#C0C0C0',
      grayoutForeground: '#404040',
      background: {
        donut: ['#102030', '#301020', '#302000'],
        pie: ['#301020', '#302000', '#103010', '#102030'],
      },
      hourBorder: {
        fine: 'rgb(255, 255, 255, 0.2)',
        coarse: 'rgb(255, 255, 255, 0.6)',
      },
      hand: {
        hour: 'rgba(255, 255, 255, 0.25)',
        minute: 'rgba(255, 255, 255, 0.25)',
        second: '#ff4000',
      },
      indicator: ['cyan', 'lightpink', 'yellow'],
    },
  };
  dial = {
    borderRadius: [0.14, 0.29, 0.42, 0.5],
    has: r => 
      r <= this.dial.borderRadius[3] &&
      r >= this.dial.borderRadius[0],
    toOffset3rd: r =>
      r < this.dial.borderRadius[1] ? -1 : // minor
      r > this.dial.borderRadius[2] ?  1 : // sus4
      0, // Major
    keySignatureTextAt0: 'key',
    draw: () => {
      const { dial, keySignature } = this;
      const {
        canvas,
        center,
        themeColor,
        backgroundMode,
        chord,
      } = dial;
      if( !themeColor ) return;
      const { width, height } = canvas;
      const context = canvas.getContext("2d");
      const selectedHour = keySignature.value;
      // Background
      const arcRadius = dial.borderRadius.map(r => r * width);
      const addCirclePath = (r, ccw) => context.arc(center.x, center.y, r, 0, 2 * Math.PI, ccw);
      if( backgroundMode === 'pie' ) {
        themeColor.background.pie.map(
          (color, index) => {
            const relativeHour = 3 * index;
            const startAngle = (selectedHour + relativeHour - 4.5) * Math.PI / 6;
            return {startAngle, color};
          }
        ).forEach(
          ({startAngle, color}, index, array) => {
            const endAngle = (array[index + 1] ?? array[0]).startAngle;
            context.fillStyle = color;
            context.beginPath();
            context.arc(center.x, center.y, arcRadius[0], startAngle, endAngle);
            context.arc(center.x, center.y, arcRadius[3], endAngle, startAngle, true);
            context.fill();
          }
        );
      } else {
         themeColor.background.donut.forEach((color, i) => {
          context.fillStyle = color;
          context.beginPath();
          addCirclePath(arcRadius[i]);
          addCirclePath(arcRadius[i + 1], true);
          context.fill();
        });
      }
      // Donut border
      context.strokeStyle = themeColor.hourBorder.fine;
      arcRadius.forEach(r => {
        context.beginPath();
        addCirclePath(r);
        context.stroke();
      });
      // Foreground
      const textColorAt = h => themeColor[h < -5 || h > 6 ? 'grayoutForeground' : 'foreground'];
      const sizeToFont = (sz, weight) => (weight||'normal')+' '+(sz * Math.min(width, height)/400)+'px san-serif';
      const fontWeightAt = h => h === 0 ?'bold':'normal';
      context.textAlign = "center";
      context.textBaseline = "middle";
      const rDot = width / 120;
      const rSmallDot = width / 200;
      for( let hour = -5; hour <= 6; hour++ ) {
        const t = hour * Math.PI / 6;
        const x = center.dx(t);
        const y = center.dy(t);
        const relativeHour = hour - selectedHour;
        // Hour-border
        let tt = t + Math.PI / 12;
        let xx = center.dx(tt);
        let yy = center.dy(tt);
        let r0 = dial.borderRadius[0];
        let r1 = dial.borderRadius[3];
        context.strokeStyle = themeColor.hourBorder[(relativeHour + 24) % 3 == 1 ? 'coarse' : 'fine'];
        context.beginPath();
        context.moveTo( center.x + r0*xx, center.y + r0*yy );
        context.lineTo( center.x + r1*xx, center.y + r1*yy );
        context.stroke();
        // Dot
        context.fillStyle = themeColor.grayoutForeground;
        r0 = dial.borderRadius[2];
        xx = x; yy = y;
        for( let i = 0; i < 5; i++ ) {
          if( i ) {
            tt = t + i * Math.PI / 30;
            xx = center.dx(tt);
            yy = center.dy(tt);
          }
          context.beginPath();
          context.arc( center.x + r0*xx, center.y + r0*yy, i ? rSmallDot : rDot, 0, 2 * Math.PI );
          context.fill();
        }
        // Text
        const drawText = (text, r) => context.fillText(text, center.x + r*x, center.y + r*y);
        const keySignatureText = hour ? Music.keySignatureTextAt(hour) : dial.keySignatureTextAt0 ;
        const majorText = Music.keyTextOf(hour);
        const minorText = Music.keyTextOf(hour, true);
        context.fillStyle = textColorAt(relativeHour);
        const fontWeight = fontWeightAt(relativeHour);
        context.font = sizeToFont(11, fontWeight);
        if( Math.abs(hour) > 4 ) {
          drawText(keySignatureText, 0.48);
          context.font = sizeToFont(14, fontWeight);
          drawText(majorText, 0.38);
          drawText(minorText, 0.25);
          const enharmonicHour = hour - 12 * Math.sign(hour);
          const enharmonicRelativeHour = enharmonicHour - selectedHour;
          context.fillStyle = textColorAt(enharmonicRelativeHour);
          const enharmonicFontWeight = fontWeightAt(enharmonicRelativeHour);
          context.font = sizeToFont(11, enharmonicFontWeight);
          drawText(Music.keySignatureTextAt(enharmonicHour), 0.45);
          context.font = sizeToFont(14, enharmonicFontWeight);
          drawText(Music.keyTextOf(enharmonicHour), 0.33);
          drawText(Music.keyTextOf(enharmonicHour, true), 0.19);
        } else {
          drawText(keySignatureText, 0.465);
          if( Math.abs(relativeHour) > 4 ) {
            context.font = sizeToFont(14);
            drawText(majorText, 0.38);
            drawText(minorText, 0.25);
            const enharmonicHour = hour - 12 * Math.sign(relativeHour);
            const enharmonicRelativeHour = enharmonicHour - selectedHour;
            context.fillStyle = textColorAt(enharmonicRelativeHour);
            drawText(Music.keyTextOf(enharmonicHour), 0.33);
            drawText(Music.keyTextOf(enharmonicHour, true), 0.19);
          } else {
            context.font = sizeToFont(19, fontWeight);
            drawText(majorText, 0.36);
            drawText(minorText, 0.22);
          }
        }
      }
    }
  };
  hands = {
    parameter: {
      hour: {
        getValueAt: time => time.getHours(), valuePerTurn: 12,
        length: 0.25, width: 1/40, colorKey: "hour",
      },
      minute: {
        getValueAt: time => time.getMinutes(), valuePerTurn: 60,
        length: 0.4, width: 7/400, colorKey: "minute",
      },
      second: {
        getValueAt: time => time.getSeconds(), valuePerTurn: 60,
        length: 0.45, width: 1/400, colorKey: "second",
        tail: {length: -0.12, width: 3/400}, center: {radius: 7/400}
      },
    },
    clear() {
      const { canvas, offscreenDialCanvas: dial } = this;
      const { width, height } = canvas;
      const context = canvas.getContext("2d");
      context.clearRect(0, 0, width, height);
      dial && context.drawImage(dial, 0, 0);
      return context;
    },
    draw: () => {
      const { hands, dial } = this;
      const { center } = hands;
      const { width } = dial.canvas;
      const drawHand = (context, hand) => {
        const color = dial.themeColor.hand[hand.colorKey];
        context.beginPath();
        context.moveTo( center.x, center.y );
        context.lineWidth = hand.width * width;
        context.lineCap = 'round';
        context.lineTo( center.x + hand.x, center.y + hand.y );
        context.strokeStyle = color;
        context.stroke();
        hand.tail && drawHand(context, hand.tail);
        if( hand.center ) {
          context.beginPath();
          context.arc(center.x, center.y, hand.center.radius * width, 0, 2 * Math.PI);
          context.fillStyle = color;
          context.fill();
        }
        return context;
      };
      const { hour, minute, second } = hands.parameter;
      [hour, minute, second].reduce(drawHand, hands.clear());
    },
    set time(time) {
      const {
        center,
        parameter: { hour, minute, second },
        draw,
      } = this;
      this._time = time;
      [second, minute, hour].reduce((fraction, hand) => {
        const turn = (hand.getValueAt(time) + fraction) / hand.valuePerTurn;
        const t = 2 * Math.PI * turn;
        const x = center.dx(t);
        const y = center.dy(t);
        hand.x = hand.length * x;
        hand.y = hand.length * y;
        if( hand.tail ) {
          hand.tail.x = hand.tail.length * x;
          hand.tail.y = hand.tail.length * y;
        }
        return turn;
      }, 0);
      draw();
    },
    get time() { return this._time; },
    set moving(flag) {
      if( ! flag ) {
        clearInterval(this.intervalId);
        this.intervalId = this._isMoving = undefined;
        return;
      }
      if( this._isMoving ) return;
      this._isMoving = true;
      this.time = new Date();
      setTimeout(
        () => {
          this.intervalId = setInterval( () => this.time = new Date(), 1000 );
          this.time = new Date();
        },
        1000 - (new Date()).getMilliseconds()
      );
    },
    get moving() { return this._isMoving; }
  };
  keySignature = {
    get value() { return this.element?.value - 0; },
    set value(hour) {
      const { element, dial, chord, enharmonicButton: ehb } = this;
      element.value = hour = Music.normalizeHourAsKey(hour);
      if( ehb ) {
        const { style } = ehb;
        if( Math.abs(hour) > 4 ) {
          ehb.textContent = Music.keySignatureTextAt(this.enharmonicHour = hour - 12 * Math.sign(hour));
          style.visibility = 'visible';
        } else {
          this.enharmonicHour = undefined;
          style.visibility = 'hidden';
        }
      }
      const ksb = chord?.keySignatureSetButton;
      if( ksb ) {
        ksb.style.visibility = "hour" in chord && ! Music.enharmonicallyEquals(hour, chord.hour) ? 'visible' : 'hidden';
      }
      dial.draw();
    },
    toggle() { this.value = this.enharmonicHour; }
  };
  constructor() {
    const loader = event => {
      const canvasId = 'circleOfFifthsClockCanvas';
      const canvas = document.getElementById(canvasId);
      if( ! canvas ) {
        console.error(`${canvasId}: No such element ID`);
        return;
      }
      const titleElement = document.getElementById('title');
      if( titleElement ) {
        const pcTitle = titleElement.innerText;
        const mobileTitle = pcTitle.split(" ")[1];
        const titleMediaQuery = window.matchMedia('(max-width: 450px)');
        const updateTitle = () => {
          titleElement.innerText = titleMediaQuery.matches ? mobileTitle : pcTitle;
        }
        updateTitle();
        titleMediaQuery.addEventListener('change', updateTitle);
      }
      const { hands, dial } = this;
      const { width, height } = hands.canvas = canvas;
      hands.center = dial.center = {
        x: width/2,
        y: height/2,
        dx: t =>  width  * Math.sin(t),
        dy: t => -height * Math.cos(t),
      };
      dial.canvas = document.getElementById('circleOfFifthsClockDialCanvas');
      if( ! dial.canvas ) {
        const osdc = hands.offscreenDialCanvas = dial.canvas = document.createElement('canvas');
        osdc.width = width;
        osdc.height = height;
      }
      const darkModeMediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
      const darkModeSelect = document.getElementById('dark_mode_select');
      const changeDarkClass = (classList, classPrefix, theme) => {
        if( !classList ) return;
        const newClassName = `${classPrefix}${theme}`;
        if( !classList.contains(newClassName) ) {
          const oldClassName = `${classPrefix}${theme === 'dark' ? 'light' : 'dark'}`;
          classList.remove(oldClassName);
          classList.add(newClassName);
        }
      };
      const setTheme = (theme) => {
        dial.themeColor = CircleOfFifthsClock.themeColors[theme];
        darkModeSelect && (darkModeSelect.value = theme);
        changeDarkClass(dial.canvas.parentElement?.classList, 'clock_', theme);
        changeDarkClass(dial.chord?.dialCenterLabel.element?.classList, 'center_chord_', theme);
        dial.draw();
        hands.draw();
      };
      const setSystemTheme = () => setTheme(darkModeMediaQuery.matches ? 'dark' : 'light');
      darkModeSelect?.addEventListener('change', e => setTheme(e.target.value));
      darkModeMediaQuery.addEventListener('change', setSystemTheme);
      const backgroundModeSelect = document.getElementById('background_mode_select');
      backgroundModeSelect?.addEventListener('change', e => {
        dial.backgroundMode = e.target.value;
        dial.draw();
      });
      dial.backgroundMode = backgroundModeSelect?.value ?? "donut";
      const chordButtonCanvas = document.getElementById('circleOfFifthsClockChordButtonCanvas');
      chordButtonCanvas && this.listen({
        chordButtonCanvas,
        toneIndicatorCanvas: document.getElementById('circleOfFifthsClockToneIndicatorCanvas'),
      });
      setSystemTheme();
      hands.moving = true;
    }
    window.addEventListener("load", loader);
  };
  listen = ({chordButtonCanvas: canvas, toneIndicatorCanvas}) => {
    if( this.pianokeyboard ) {
      console.warn('CircleOfFifthsClock: listen(): Already listening');
      return;
    }
    const { keySignature, dial } = this;
    toneIndicatorCanvas.dial = dial;
    toneIndicatorCanvas.keySignature = keySignature;
    const { chord } = this.pianokeyboard = new PianoKeyboard(toneIndicatorCanvas);
    canvas.focus();
    chord.keySignature = keySignature;
    chord.buttonCanvas = canvas;
    chord.dial = dial;
    dial.chord = chord;
    keySignature.chord = chord;
    keySignature.dial = dial;
    dial.keySignatureTextAt0 = 'key/sus4';
    const kse = keySignature.element = document.getElementById('keyselect') || {};
    if( kse.addEventListener ) {
      for( let hour = -7; hour <= 7; hour++ ) {
        const option = document.createElement('option');
        const value = document.createAttribute('value');
        option.setAttributeNode(value);
        (value.value = hour) === 0 && option.setAttributeNode(document.createAttribute('selected'));
        option.appendChild(document.createTextNode(Music.keySignatureTextAt(hour)||Music.NATURAL));
        kse.appendChild(option);
      }
      kse.addEventListener('change', event => keySignature.value = event.target.value);
      (keySignature.enharmonicButton = document.getElementById('enharmonic'))?.addEventListener(
        'click', event => keySignature.toggle()
      );
      chord.keySignatureSetButton?.addEventListener('click',
        event => ( chord.hour || chord.hour === 0 ) && ( keySignature.value = chord.hour )
      );
    }
    keySignature.value = 0;
    //
    // PC keyboard bindings
    const createLeftRightKeyCodes = (key) => [`${key}Left`, `${key}Right`];
    const createCharKeyCodes = (arrayLike) => Array.from(arrayLike, c => `Key${c}`);
    const createDigitKeyCodes = () => {
      const keys = Array.from({ length: 10 }, (_, index) => `Digit${index}`);
      keys.push(keys.shift());
      return keys;
    };
    const chordKeyBindings = Object.fromEntries(
      [
        [...createDigitKeyCodes(), 'Minus', 'Equal'],
        [...createCharKeyCodes('QWERTYUIOP'), ...createLeftRightKeyCodes('Bracket')],
        [...createCharKeyCodes('ASDFGHJKL'), 'Semicolon', 'Quote', 'Backslash'],
      ].flatMap(
        (row, y) => row.map((code, x) => [code, [x-5, 1-y]])
      )
    );
    const shiftLikeKeyCodes = ['Shift', 'Alt', 'Control', 'Meta'].flatMap(createLeftRightKeyCodes);
    const handleEvent = (event, chord) => {
      switch( event.type ) {
        case 'keydown':
          if( event.repeat || ! chord || shiftLikeKeyCodes.includes(event.code) ) {
            event.preventDefault();
            return;
          }
          if( event.code in chordKeyBindings ) {
            [chord.hour, chord.offset3rd] = chordKeyBindings[event.code];
            chord.hour += keySignature.value;
          } else {
            switch(event.code) {
              case 'Space':
                event.preventDefault(); // To avoid unexpected page down
                // fallthrough
              case 'Enter':
                chord.start();
                return;
              case 'Tab':
                // Move focus (Keep default action)
                return;
              case 'ArrowLeft': keySignature.value-- ; event.preventDefault(); return;
              case 'ArrowRight': keySignature.value++ ; event.preventDefault(); return;
              case 'ArrowUp': keySignature.value -= 5 ; event.preventDefault(); return;
              case 'ArrowDown': keySignature.value += 5 ; event.preventDefault(); return;
              default: event.preventDefault(); return;
            }
          }
          break;
        case 'touchmove':
        case 'mousemove':
          event.preventDefault();
          return;
        default:
          if( ! chord ) {
            event.preventDefault();
            return;
          } else {
            const { target: canvas, clientX, clientY } = event.changedTouches?.[0] ?? event;
            const { left, right, top, bottom } = canvas.getBoundingClientRect();
            const x = ( clientX - (left + right) / 2 ) / canvas.width;
            const y = ( clientY - (top + bottom) / 2 ) / canvas.height;
            const r = Math.sqrt( x ** 2 + y ** 2 );
            if( ! dial.has(r) ) return;
            canvas.focus();
            chord.offset3rd = dial.toOffset3rd(r);
            chord.hour = Math.round( (canvas.lastHourAngle = Math.atan2(x, -y)) * 6 / Math.PI );
          }
          break;
      }
      const relativeHour = chord.hour - keySignature.value;
      if( relativeHour < -5 ) chord.hour += 12; else if( relativeHour > 6 ) chord.hour -= 12;
      chord.offset5th = 0;
      const { shiftButtonStatus } = this;
      if( event.altKey || shiftButtonStatus?.button_flat5 ) {
        if( chord.offset3rd == 1 ) {
          chord.offset3rd = 0; chord.offset5th = 1; // replace sus4 to augumented
        } else {
          chord.offset5th = -1; // -5
        }
      }
      chord.offset7th = 0;
      if( shiftButtonStatus ) {
        chord.offset7th = 4;
        shiftButtonStatus.button_7th && (chord.offset7th -= 2);
        shiftButtonStatus.button_major7th && (chord.offset7th -= 1);
      } else if( event.type === 'keydown' ) {
        event.shiftKey && (chord.offset7th += 2);
        event.metaKey && (chord.offset7th += 1);
      } else {
        event.button == 2 && (chord.offset7th += 2);
        event.shiftKey && (chord.offset7th += 1);
      }
      chord.offset7th == 4 && (chord.offset7th = 0);
      chord.add9th = event.ctrlKey || shiftButtonStatus?.button_add9;
      chord.start();
    };
    const isSmartphone = typeof window.ontouchstart !== 'undefined';
    const eventTypes = {
      disable: [
        'click',
        'dblclick',
        'contextmenu',
        'selectstart',
      ],
      move: isSmartphone ? "touchmove" : "mousemove",
      start: ['pointerdown', 'keydown'],
      end: ['pointerup', 'keyup', 'mouseleave']
    };
    const buttonContainer = document.getElementById('button_container');
    if( isSmartphone ) {
      const status = this.shiftButtonStatus = {};
      [
        "button_7th",
        "button_major7th",
        "button_flat5",
        "button_add9"
      ].forEach(id => {
        const button = document.getElementById(id);
        if( ! button ) return;
        button.addEventListener('touchstart', event => {
          status[id] = true;
          event.changedTouches[0].target.classList.add('pressed');
        });
        button.addEventListener('touchend', event => {
          delete status[id];
          event.changedTouches[0].target.classList.remove('pressed');
        });
        [...eventTypes.disable, eventTypes.move].forEach(t => button.addEventListener(t, e => e.preventDefault()));
      });
      canvas.title = "Touch the chord symbol to sound";
    } else {
      buttonContainer?.remove();
      canvas.title = "Click the chord symbol to sound";
    }
    eventTypes.disable.forEach(t => canvas.addEventListener(t, handleEvent));
    eventTypes.start.forEach(t => canvas.addEventListener(t, e => handleEvent(e, chord)));
    eventTypes.end.forEach(t => canvas.addEventListener(t, chord.stop));
    if( chord.dialCenterLabel ) {
      const { element } = chord.dialCenterLabel;
      element.addEventListener('pointerdown', e => {
        chord.start();
      });
      element.addEventListener('pointerup', e => {
        canvas.focus();
        chord.stop();
      });
      element.addEventListener('mouseleave', e => {
        chord.stop();
      });
    }
    canvas.clearChord = () => {
      const context = canvas.getContext("2d");
      const { width, height } = canvas;
      context.clearRect(0, 0, width, height);
    };
    canvas.selectChord = () => {
      canvas.clearChord();
      const { dial, hour, offset3rd } = chord;
      const centerXY = [
        dial.center.x,
        dial.center.y,
      ];
      const [innerRadius, outerRadius] = [1, 2].map(i => dial.borderRadius[offset3rd + i] * canvas.width);
      const [startAngle, endAngle] = [3.5, 2.5].map(dh => (hour - dh) / 6 * Math.PI);
      const context = canvas.getContext("2d");
      context.beginPath();
      context.fillStyle = "#80808080";
      context.arc(...centerXY, innerRadius, startAngle, endAngle);
      context.arc(...centerXY, outerRadius, endAngle, startAngle, true);
      context.fill();
    };
    const handleMouseMove = (event) => {
      const {
        target: canvas,
        clientX,
        clientY,
      } = event.changedTouches?.[0] ?? event;
      const { left, right, top, bottom } = canvas.getBoundingClientRect();
      const x = ( clientX - (left + right) / 2 );
      const y = ( clientY - (top + bottom) / 2 );
      const hourAngle = Math.atan2(x, -y);
      const diffHourAngle = hourAngle - canvas.lastHourAngle;
      if( Math.abs(diffHourAngle) < Math.PI / 15 ) return;
      canvas.lastHourAngle = hourAngle;
      chord.strum(diffHourAngle < 0 ? -1 : 1);
    };
    canvas.enableStrum = () => canvas.addEventListener(eventTypes.move, handleMouseMove);
    canvas.disableStrum = () => canvas.removeEventListener(eventTypes.move, handleMouseMove);
    chord.clear();
  };
};

