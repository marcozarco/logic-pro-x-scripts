// Logic Pro X Scripter plugin code for SWAM Flute with Akai EWI.
// Script by: Marco Zagha (https://github.com/marcozarco)
// License: MIT
//
// Video demo: https://youtu.be/O0tlm8kKvzI


var PluginParameters =
[
    {name:"SlewStep", type:"linear", minValue:0.01, maxValue:2.0, defaultValue:0.15, numberOfSteps:200},
];

// Breath 
var breathCC = 2; // input and output
var breathScale = 0.88; // leave a little headroom for vibrato and random dynamics

// Breath noise
var breathNoiseElbow = 64; // max ("LowBreath") noise up to this point
var breathNoiseAtMaxBreath = 10;
var breathNoiseAtLowBreath = 127;
var breathNoiseCC = 6;  // output

// Brightness / formant 
var brightnessCC = 84;  // input and output
var brightnessSlewStep = 0;

// Pipesplit
var pipeSplitCC = 40; // output

// Vibrato
var vibratoPedalCC = 4; // input
var fastVibratoCC = 20; // input
var vibratoDepthCC = 9; // output
var vibratoRateCC = 8; // output
var slowVibratoRate = 48;
var fastVibratoRate = 68;
var maxVibratoRate = 64;
var slowVibratoDepth = 1;
var fastVibratoDepth = 105;
var maxVibratoDepth = 125;
var minPedalForVibrato = 8;
var vibratoSmallBreathValue = 10;
var vibratoMinNoteRange = 58;
var vibratoMaxNoteRange = 90;

var vibratoDepthPedalContrib = 60; // 85;
var vibratoDepthBreathContrib = 40; // 15;
var vibratoDepthNoteContrib = 0;

var vibratoRatePedalContrib = 20;
var vibratoRateBreathContrib = 60;
var vibratoRateNoteContrib = 20;
        
//////////////////////////////

// State variables.
var lastBreathValue;
var lastPitch;
var lastVibratoPedal;
var lastFastVibrato;
var lastSmoothnessValue;

function Reset() {
    Trace("Reset()");
    lastBreathValue = 0;
    lastPitch = 50;
    lastVibratoPedal = 0;
    lastFastVibrato = 0;
    lastSmoothnessValue = 0;
}

function ParameterChanged(param, value) {
    brightnessSlewStep = value;
    Trace('parameter ' + param + ' changed to ' + value);
    Reset();
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

// Compute vibrato as a function of breath, pedal, "fast vibrato" CC on/off, and note value. 
function sendVibrato() {
    var vibratoRate, vibratoDepth;
    if (lastFastVibrato > 0) {
        vibratoRate = fastVibratoRate;
        vibratoDepth = fastVibratoDepth;
    } else if (lastVibratoPedal < minPedalForVibrato) {
        vibratoRate = 0;
        vibratoDepth = 0;
    } else {
        var breathFrac = Math.max(0.0, lastBreathValue - vibratoSmallBreathValue) / 127;
        var pedalFrac = (lastVibratoPedal - minPedalForVibrato) / (127 - minPedalForVibrato);
        var noteFrac = Math.max(0, (lastPitch - vibratoMinNoteRange)) / (vibratoMaxNoteRange - vibratoMinNoteRange);

        // Allow experimenting with weights of pedal, breath, and note using weight parameters.
        var totalDepthWt = vibratoDepthPedalContrib + vibratoDepthBreathContrib + vibratoDepthNoteContrib;
        var breathDepthWt = vibratoDepthBreathContrib / totalDepthWt;
        var pedalDepthWt = vibratoDepthPedalContrib / totalDepthWt;
        var noteDepthWt = vibratoDepthNoteContrib / totalDepthWt;
        
        var totalRateWt = vibratoRatePedalContrib + vibratoRateBreathContrib + vibratoRateNoteContrib;
        var breathRateWt = vibratoRateBreathContrib / totalRateWt;
        var pedalRateWt = vibratoRatePedalContrib / totalRateWt;
        var noteRateWt = vibratoRateNoteContrib / totalRateWt;

        depthFrac = Math.min(1.0, breathDepthWt * breathFrac + pedalDepthWt * pedalFrac + noteDepthWt * noteFrac);
        rateFrac = Math.min(1.0, breathRateWt * breathFrac + pedalRateWt * pedalFrac + noteRateWt * noteFrac);

        vibratoDepth = slowVibratoDepth + depthFrac * (maxVibratoDepth - slowVibratoDepth);
        vibratoRate = slowVibratoRate + rateFrac * (maxVibratoRate - slowVibratoRate);
    }
    sendCC(vibratoRateCC, MIDI.normalizeData(vibratoRate));
    sendCC(vibratoDepthCC, MIDI.normalizeData(vibratoDepth));
}


var smoothedBrightness = 0.0;
function sendBrightness() {
  if (lastSmoothnessValue > smoothedBrightness) {
    smoothedBrightness = Math.min(smoothedBrightness + brightnessSlewStep, lastSmoothnessValue);
  } else {
    smoothedBrightness = Math.max(smoothedBrightness - brightnessSlewStep, lastSmoothnessValue);
  }
  sendCC(brightnessCC, scaleCC(smoothedBrightness, 0, 127));
}

function sendBreath(breath) {
    if (breath > breathNoiseElbow) {
        slope = (breathNoiseAtMaxBreath - breathNoiseAtLowBreath) / (127 - breathNoiseElbow);
        noise = breathNoiseAtLowBreath + slope * (breath - breathNoiseElbow);
    } else {
        noise = breathNoiseAtLowBreath;
    }
    sendCC(breathNoiseCC, noise);
    sendCC(breathCC, breath * breathScale);
}

function HandleMIDI(event) {
    if (event instanceof ControlChange) {
        switch(event.number) {
            case breathCC:
                lastBreathValue = event.value;
                sendBreath(lastBreathValue);
                sendVibrato();
                sendBrightness();
                break;
            case brightnessCC:
                lastSmoothnessValue = event.value;
                sendBrightness();
                break;
            case vibratoPedalCC:
                lastVibratoPedal = event.value;
                sendVibrato();  // swallow pedal event
                sendBrightness();
                break;
            case fastVibratoCC:
                lastFastVibrato = event.value;
                sendVibrato();
                break;
            default:
                sendEvent(event);
                break;
        }

    } else if (event instanceof NoteOff && event.pitch <= 24) {
        sendEvent(event);
        Trace('All off ' + event.pitch);
        MIDI.allNotesOff();
        Reset();
    } else if (event instanceof NoteOn) {
     // Custom keyswitch for pipe split
        if (event.pitch == 26) { // lowest EWI D -> pipe split "auto"
          sendCC(pipeSplitCC, 0);
        } else if (event.pitch == 28) { // lowest EWI E -> pipe split -1
          sendCC(pipeSplitCC, 48);
        } else {
          lastPitch = event.pitch;
          sendEvent(event);
        }
    } else {
        sendEvent(event);
    }
}
