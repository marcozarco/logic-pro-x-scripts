// Logic Pro X Scripter plugin code for SWAM Cello with Akai EWI.
// Script by: Marco Zagha (https://github.com/marcozarco)
// License: MIT
//
//
// Note that some code here was added for experimenting with settings and isn't needed.

var PluginParameters =
[
		{name:"Sample parameter", type:"linear",
		minValue:0, maxValue:127, defaultValue:20},
];

// Breath 
// CC which is used to derive vibrato etc. in this script and passes through for
// SWAM to do a mapping for bow noise (as well as the all-important expression control).
var breathCC = 2; // input and output

// Vibrato
var vibratoPedalCC = 4; // input
var vibratoDepthCC = 7; // output
var vibratoRateCC = 6; // output
var slowVibratoRate = 48;
var fastVibratoRate = 70;
var maxVibratoRate = fastVibratoRate;
var slowVibratoDepth = 24;
var fastVibratoDepth = 80;
var maxVibratoDepth = 110;
var minPedalForVibrato = 20;
var minPedalForFastVibrato = 120;
var vibratoSmallBreathValue = 20;
var vibratoMinNoteRange = 48;
var vibratoMaxNoteRange = 80;
var vibratoPedalContrib = 25;
var vibratoBreathContrib = 45;
var vibratoNoteContrib = 25;

// Harmonics. Passed through and also used to change velocity and bow position and kill vibrato.
var harmonicCC = 71; // input and output

// Flautando
var flautandoCC = 70; // input (output from bow cc's below)
var minFlautandoBowPressure = 15;
var maxFlautandoBowPressure = 40;
var flautandoBowPosition = 24;

// Bow pressure and position
var bowPressureCC = 3; // output
var minBowPressure = 70;
var maxBowPressure = 90;
var bowPositionCC = 28; // output
var minBowPosition = 60;
var maxBowPosition = 60; // was 40;
var harmonicBowPosition = 44;

// Portamento
var portamentoCC = 65; // input and output
var singleStringPortamentoCC = 84; // input
var altFingeringCC = 26; // output
var minPortamentoTime = 6; // 7;
var maxPortamentoTime = 24;
var bigJumpPortamentoTime = 38;

// Simple velocity scaling, but for harmonics, always use minVelocity.
var minVelocity = 1;
var maxVelocity = 92; 

//////////////////////////////

// State variables.
var lastBreathValue;
var lastHarmonic;
var lastPitch;
var lastVibratoPedal;
var portamento;
var flautando;
var harmonic;
var notesOn;
var needToRestoreHandPosition;
var keepHandAtBridge;

function Reset() {
  Trace("Reset()");
  lastBreathValue = 0;
  lastHarmonic = 0;
  lastPitch = 50;
  lastVibratoPedal = 0;
  portamento = false;
  flautando = false;
  harmonic = false;
  notesOn = 0;
  needToRestoreHandPosition = false;
  keepHandAtBridge = false;
}

function ParameterChanged(param, value) {
  Trace('parameter ' + param + ' changed to ' + value);
  Reset(); // fix?
}

function sendEvent(event) {
  event.send();
  // event.trace();
}

function sendCC(number, value) {
  var cc = new ControlChange;
  cc.number = number;
  cc.value = value;
  sendEvent(cc);
} 

function scaleCC(value, minOut, maxOut) {
  return MIDI.normalizeData(value / 127 * (maxOut - minOut) + minOut);
}


// Compute vibrato as a function of breath, pedal, and note value. 
// This was a bit of an experiment in using multiple inputs to a cc and with some
// practice it works pretty well. The pedal has three regions: no vibrato on one end,
// fast vibrato on the other end (typically just for an eighth note), and adaptive
// vibrato in between, which is slightly faster for higher notes, mostly is controlled
// by breath, but still has some contribution from the pedal to give more control.
function sendVibrato() {
    var vibratoRate, vibratoDepth;
    if (lastVibratoPedal < minPedalForVibrato || harmonic) {
      vibratoRate = 0;
      vibratoDepth = 0;
    } else if (lastVibratoPedal > minPedalForFastVibrato) {
      vibratoRate = fastVibratoRate;
      vibratoDepth = fastVibratoDepth;
    } else {
      var breathFrac = Math.max(0.0, lastBreathValue - vibratoSmallBreathValue) / 127;
      var pedalFrac = (lastVibratoPedal - minPedalForVibrato) / (minPedalForFastVibrato - minPedalForVibrato);
      var noteFrac = Math.max(0, (lastPitch - vibratoMinNoteRange)) / (vibratoMaxNoteRange - vibratoMinNoteRange);
 
      // Allow experimenting with weights of pedal, breath, and note using weight parameters.
      var totalDepthWt = vibratoPedalContrib + vibratoBreathContrib;
      var breathDepthWt = vibratoBreathContrib / totalDepthWt;
      var pedalDepthWt = vibratoPedalContrib / totalDepthWt;
      var totalRateWt = vibratoPedalContrib + vibratoBreathContrib + vibratoNoteContrib;
      var breathRateWt = vibratoBreathContrib / totalRateWt;
      var pedalRateWt = vibratoPedalContrib / totalRateWt;
      var noteRateWt = vibratoNoteContrib / totalRateWt;
      
      depthFrac = Math.min(1.0, breathDepthWt * breathFrac + pedalDepthWt * pedalFrac);
      rateFrac = Math.min(1.0, breathRateWt * breathFrac + pedalRateWt * pedalFrac + noteRateWt * noteFrac);

      vibratoDepth = slowVibratoDepth + depthFrac * (maxVibratoDepth - slowVibratoDepth);
      vibratoRate = slowVibratoRate + rateFrac * (maxVibratoRate - slowVibratoRate);
    }
    sendCC(vibratoRateCC, MIDI.normalizeData(vibratoRate));
    sendCC(vibratoDepthCC, MIDI.normalizeData(vibratoDepth));
}

// If we're mid single-string portamento, we'll first move the hand towards the bridge.
// Then we'll just scale the portamento a bit based on the pitch delta so that we can
// have something more like portamento time than portamento speed and get a reasonably
// slow half step portamento without making other portamento comically slow. That's how
// this started -- with noble intentions -- but then I kept just tossing in special cases
// to handle particular musical passages. At this point, I'm thinking I'd be better of
// replacing the special cases with another cc, e.g. a second expression pedal, bite, or
// left thumb (which is supposed to be used for portamento but is a bit hard for me to
// control), but I'd probably combine it with the pitch delta scaling below.
function sendPortamentoAfterMovingHandToBridgeIfNeeded(pitch) {
  var portamentoTime = 0;
  var pitchDelta = Math.max(1,Math.abs(lastPitch - pitch));
  if (portamento) {
    if (pitchDelta >= 8 && pitch > lastPitch) {
      if (notesOn > 1 || pitch > 65 /* 72 */) { // example: bar 8, octave jmp
         moveHandToBridge();
      }
      if (pitch > 72) { // example: bar 59, big jump to harmonic
    	    portamentoTime = 127 - maxPortamentoTime;
      } else { // examples: bar 8 & 25, octave jmp up; bar 20, up 7th; bar 49, up 6th
      	  portamentoTime = 127 - bigJumpPortamentoTime;
      }
    } else if (needToRestoreHandPosition){
      // examples: bar 24, down 6th; bar 43, up 4th; bar 54 down 3rds; bar 60 up whole step
      portamentoTime = 127 - maxPortamentoTime;
    	} else { // examples: bar 14, down tritone; bar 16 up 4th; bar 59 down semitone
    	  if (pitch < lastPitch - 4) {
    	    portamentoTime = 127 - bigJumpPortamentoTime;
    	  } else {
        portamentoTime = 127 - Math.min(minPortamentoTime * pitchDelta, maxPortamentoTime);
      }
    }
  }
  sendCC(portamentoCC, MIDI.normalizeData(portamentoTime));
}

var HandPosition = {
  MID: 0,
  BRIDGE: 63,
  NUT: 127,
};

function restoreHandPosition() {
  if (keepHandAtBridge) {
    // Wait for one more NoteOff before restoring hand position.
    // TODO(marcoz): find a better way to determine when to move hand back.
    keepHandAtBridge = false;
    return;
  }
  if (needToRestoreHandPosition) {
    needToRestoreHandPosition = false;
    sendCC(altFingeringCC, HandPosition.MID);
  }
}

function moveHandUpTowardsNut() {
  if (needToRestoreHandPosition) {
   // We've already moved hand, so we'll ignore the single-string-portamento CC.
    return;
  }
  needToRestoreHandPosition = true;
  sendCC(altFingeringCC, HandPosition.NUT);
}

function moveHandToBridge() {
  keepHandAtBridge = true;
  needToRestoreHandPosition = true;
  sendCC(altFingeringCC, HandPosition.BRIDGE);
}

function sendBowPressureAndPosition() { // based on breath, flautando, and harmonic
  var bowPressure, bowPosition;
  if (flautando) {
    bowPressure = scaleCC(lastBreathValue, minFlautandoBowPressure, maxFlautandoBowPressure);
    bowPosition = flautandoBowPosition;
  } else {
    bowPressure = scaleCC(lastBreathValue, minBowPressure, maxBowPressure);
    if (harmonic) {
      bowPosition = harmonicBowPosition;
    } else {
      bowPosition = scaleCC(lastBreathValue, minBowPosition, maxBowPosition);
    }
  }
  sendCC(bowPressureCC, bowPressure);
  sendCC(bowPositionCC, bowPosition);
}


function HandleMIDI(event) {
  if (event instanceof ControlChange) {
    switch(event.number) {
      case breathCC:
        lastBreathValue = event.value;
        sendEvent(event);
        sendBowPressureAndPosition();
        sendVibrato();
        break;
      case vibratoPedalCC:
        lastVibratoPedal = event.value;
        sendVibrato();  // swallow pedal event
        break;
      case flautandoCC:
        flautando = (event.value > 0);
      	  sendBowPressureAndPosition(); // swallow event
     	  break;
      case singleStringPortamentoCC:
        if (event.value >= 32) moveHandUpTowardsNut();
        // fall through [commenting per Section 5.8.3.1 of the javascript style guide]
      case portamentoCC:
        // Save state for next NoteOn.
    	    portamento = (event.value >= 32); // just enough to avoid accidental touch
    	    break;
      case harmonicCC:
        harmonic = event.value; // swallow event;
        break;
    }
  } else if (event instanceof NoteOff && event.pitch <= 36) {
    sendEvent(event);
    Trace('All off ' + event.pitch);
    MIDI.allNotesOff();
    Reset();
  } else if (event instanceof NoteOn) {
    notesOn++;
    if (harmonic > 0) {
      event.velocity = 1; // Kill velocity with harmonics.
      sendCC(bowPositionCC, harmonicBowPosition);
    } else {
      event.velocity = scaleCC(event.velocity, minVelocity, maxVelocity);
    }
    if (harmonic != lastHarmonic) {
      sendCC(harmonicCC, harmonic);
      lastHarmonic = harmonic;
    }
    sendPortamentoAfterMovingHandToBridgeIfNeeded(event.pitch);
	  lastPitch = event.pitch;
    sendEvent(event);
  } else if (event instanceof NoteOff) {
    notesOn--;
    restoreHandPosition();
    sendEvent(event);
  } else {
    sendEvent(event);
  }
}
