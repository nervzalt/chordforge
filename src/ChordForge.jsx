import { useState, useRef, useEffect } from "react";

const NOTES = ['C','C#','D','D#','E','F','F#','G','G#','A','A#','B'];
const WHITE_KEYS = ['C','D','E','F','G','A','B'];
const BK_DATA = [
  {note:'C#',left:'10.0%'},{note:'D#',left:'24.3%'},
  {note:'F#',left:'52.8%'},{note:'G#',left:'67.1%'},{note:'A#',left:'81.4%'},
];
const NOTE_FREQS = {
  C:261.63,'C#':277.18,D:293.66,'D#':311.13,E:329.63,
  F:349.23,'F#':369.99,G:392,'G#':415.30,A:440,'A#':466.16,B:493.88,
};

// ---- ROMAN NUMERAL PARSER ----

const ROMAN_OFFSETS = {VII:11,VI:9,IV:5,III:4,II:2,V:7,I:0};

function parseComplexChord(symbol, rootNote) {
  const ri = NOTES.indexOf(rootNote);
  let s = symbol, acc = 0;
  if (s[0]==='b'){acc=-1;s=s.slice(1);}
  else if(s[0]==='#'){acc=1;s=s.slice(1);}

  let roman = null;
  for (const r of Object.keys(ROMAN_OFFSETS)) {
    if (s.toUpperCase().startsWith(r)){roman=r;break;}
  }
  if (!roman) return {root:rootNote,intervals:[0,4,7],displayName:symbol,romanIsLower:false};

  const romanIsLower = s.slice(0,roman.length) !== s.slice(0,roman.length).toUpperCase();
  const degOffset    = ROMAN_OFFSETS[roman];
  const chordRootIdx = ((ri+degOffset+acc)%12+12)%12;
  const chordRoot    = NOTES[chordRootIdx];
  const rawSuffix    = s.slice(roman.length);
  const cleanSuffix  = rawSuffix.replace(/[()]/g,'');

  const IMAP = {
    'maj7':[0,4,7,11],'m7':[0,3,7,10],'7':[0,4,7,10],
    'maj9':[0,4,7,11,14],'m9':[0,3,7,10,14],'9':[0,4,7,10,14],
    'add9':[0,4,7,14],'madd9':[0,3,7,14],
    '(maj7)':[0,3,7,11],'m6':[0,3,7,9],'6':[0,4,7,9],
    'sus2':[0,2,7],'sus4':[0,5,7],
    'dim7':[0,3,6,9],'m7b5':[0,3,6,10],
    'm11':[0,3,7,10,14,17],'11':[0,4,7,10,14,17],
    'm':[0,3,7],'':[0,4,7],
  };

  let intervals;
  if (romanIsLower) {
    if (rawSuffix==='(maj7)') intervals=[0,3,7,11];
    else if (cleanSuffix===''||cleanSuffix==='m') intervals=[0,3,7];
    else if (cleanSuffix==='7')    intervals=IMAP['m7'];
    else if (cleanSuffix==='9')    intervals=IMAP['m9'];
    else if (cleanSuffix==='6')    intervals=IMAP['m6'];
    else if (cleanSuffix==='11')   intervals=IMAP['m11'];
    else if (cleanSuffix==='maj7') intervals=IMAP['(maj7)'];
    else if (cleanSuffix==='add9') intervals=IMAP['madd9'];
    else intervals=IMAP[cleanSuffix]||[0,3,7];
  } else {
    intervals=IMAP[cleanSuffix]||IMAP[rawSuffix]||[0,4,7];
  }

  let displayName;
  if (romanIsLower) {
    if (rawSuffix==='(maj7)') displayName=chordRoot+'m(maj7)';
    else {
      let ds=cleanSuffix;
      if(ds.startsWith('m')&&!ds.startsWith('maj')) ds=ds.slice(1);
      displayName=ds===''?chordRoot+'m':chordRoot+'m'+ds;
    }
  } else {
    displayName=chordRoot+cleanSuffix;
  }

  return {root:chordRoot,intervals,displayName,romanIsLower};
}

// ---- VOICING ENGINE ----

function freqFromMidi(m){return 440*Math.pow(2,(m-69)/12);}
function midiFromFreq(f){return Math.round(69+12*Math.log2(f/440));}
function noteMidi(n,o){return NOTES.indexOf(n)+(o+1)*12;}

// 3 styles: 1=Block, 2=EDM, 3=Wide
// Returns upper voice pitch classes (in order) + bass pc, anchored at oct=4
function buildShapeAtOct(cd, style, oct) {
  const {root, intervals} = cd;
  const ri = NOTES.indexOf(root);
  const o  = oct ?? 4;

  function dm(semi, oc) {
    return noteMidi(NOTES[((ri+semi)%12+12)%12], oc);
  }

  const third  = intervals.find(i=>i===3||i===4) ?? 4;
  const fifth  = intervals.find(i=>i===6||i===7) ?? 7;
  const sev    = intervals.find(i=>i===10||i===11);
  const ninth  = intervals.find(i=>i===14||i===2);

  // Bass is ALWAYS fixed at octave 2 regardless of which oct the upper voices land on.
  // This prevents the inversion engine from randomly shifting the bass an octave.
  const bass = Math.max(BASS_MIN, noteMidi(root, 2));

  let upper;
  switch (style) {
    case 2: {
      upper = [dm(0,o), dm(fifth,o)];
      if (ninth != null) upper.push(dm(ninth, o+1));
      if (sev   != null) upper.push(dm(sev,   o+1));
      upper.push(dm(third, o+1));
      break;
    }
    case 3: {
      upper = [dm(fifth, o-1)];
      if (sev != null) upper.push(dm(sev, o));
      upper.push(dm(third, o+1));
      break;
    }
    default: {
      upper = [dm(0,o), dm(fifth,o)];
      if (ninth != null) upper.push(dm(ninth, o));
      if (sev   != null) upper.push(dm(sev,   o));
      upper.push(dm(third, o));
      break;
    }
  }
  return {bass, upper};
}

// ---- EXTENSION RESOLVER ----

function resolveIntervals(cd, ext) {
  let ivs = [...cd.intervals];
  if (ext && !ext.seventh) ivs = ivs.filter(i=>i!==10&&i!==11);
  if (ext && !ext.ninth)   ivs = ivs.filter(i=>i!==14&&i!==2);
  if (ext && ext.seventh && !ivs.some(i=>i===10||i===11)) ivs.push(cd.romanIsLower?10:11);
  if (ext && ext.ninth   && !ivs.some(i=>i===14||i===2))  ivs.push(14);
  return ivs;
}

// ---- INVERSION ENGINE ----
// Finds the best rotation of the upper notes that minimises voice movement,
// then shifts the ENTIRE block (preserving internal intervals) to sit
// closest to the previous chord's average. This keeps EDM "wide" and Block "tight."

const VOICE_MIN = 40;
const VOICE_MAX = 88;
const BASS_MIN  = 28;

function permutations(arr) {
  if (arr.length <= 1) return [arr];
  const result = [];
  for (let i = 0; i < arr.length; i++) {
    const rest = arr.slice(0, i).concat(arr.slice(i + 1));
    for (const p of permutations(rest)) result.push([arr[i], ...p]);
  }
  return result;
}

function bestVoiceLeading(upper, prevUpper) {
  // No context: return shape as-is (will be octave-shifted by caller)
  if (!prevUpper || prevUpper.length === 0) return upper;

  const prevAvg = prevUpper.reduce((a, b) => a + b, 0) / prevUpper.length;
  const n = upper.length;
  const pn = prevUpper.length;

  // Build reference array - pad/trim to match current chord size
  let refs = [...prevUpper];
  while (refs.length < n) refs.push(refs[refs.length - 1]);
  refs = refs.slice(0, n);

  // Step 1: find the best permutation (rotation preserves relative intervals)
  // We only try cyclic rotations (not all permutations) to preserve the
  // style's internal shape - e.g. EDM keeps the octave gap between root and 3rd
  let bestRotation = upper;
  let bestCost = Infinity;

  for (let rot = 0; rot < n; rot++) {
    const rotated = upper.slice(rot).concat(upper.slice(0, rot));
    // Shift entire rotated block to sit closest to prevAvg
    const rotAvg = rotated.reduce((a, b) => a + b, 0) / n;
    const semitoneShift = Math.round((prevAvg - rotAvg) / 12) * 12;
    const shifted = rotated.map(m => m + semitoneShift);
    // Clamp check - skip if any note goes out of range
    if (shifted.some(m => m < VOICE_MIN || m > VOICE_MAX)) continue;
    const cost = shifted.reduce((sum, m, vi) => sum + Math.abs(m - refs[vi]), 0);
    if (cost < bestCost) { bestCost = cost; bestRotation = shifted; }
  }

  // Step 2: final octave shift of the whole block to sit closest to prevAvg
  let result = bestRotation;
  const resultAvg = () => result.reduce((a, b) => a + b, 0) / result.length;

  // Try shifting up and down by octaves, pick closest to prevAvg
  let best = result, bestDist = Math.abs(resultAvg() - prevAvg);
  for (const dir of [-1, 1]) {
    let candidate = result.map(m => m + dir * 12);
    for (let tries = 0; tries < 3; tries++) {
      if (candidate.some(m => m < VOICE_MIN || m > VOICE_MAX)) break;
      const d = Math.abs(candidate.reduce((a, b) => a + b, 0) / n - prevAvg);
      if (d < bestDist) { bestDist = d; best = candidate; }
      else break;
      candidate = candidate.map(m => m + dir * 12);
    }
  }

  return best;
}

// ---- GLOBAL PEDAL ----

function getGlobalPedalFreq(firstSym, rootNote, degree) {
  if (!degree || degree === 'off') return null;
  const cd  = parseComplexChord(firstSym, rootNote);
  const ri  = NOTES.indexOf(cd.root);
  const defaultSeventh = cd.romanIsLower ? 10 : 11;
  const map = {
    root:    0,
    third:   cd.intervals.find(i => i===3||i===4) ?? (cd.romanIsLower ? 3 : 4),
    fifth:   cd.intervals.find(i => i===6||i===7) ?? 7,
    seventh: cd.intervals.find(i => i===10||i===11) ?? defaultSeventh,
  };
  const semi = map[degree];
  if (semi == null) return null;
  const noteIdx = ((ri + semi) % 12 + 12) % 12;
  return parseFloat(freqFromMidi(noteMidi(NOTES[noteIdx], 5)).toFixed(2));
}

// ---- SINGLE SOURCE OF TRUTH ----

const GRAVITY_CENTER = 64; // E4 - anchor for first chord placement

function generateVoicedNotes(chords, rootNote, style, exts, globalPedal) {
  const parsed = chords.map((sym, i) => {
    const cd  = parseComplexChord(sym, rootNote);
    const ext = exts[i] || {};
    return {...cd, intervals: resolveIntervals(cd, ext)};
  });

  const midiVoicings = [];
  let prevUpperMidi = null;

  for (let i = 0; i < parsed.length; i++) {
    const cd = parsed[i];
    // Always build shape at oct 4 - bestVoiceLeading shifts the whole block
    const shape = buildShapeAtOct(cd, style, 4);

    let finalUpper;
    if (i === 0) {
      // First chord: shift block so its average sits closest to GRAVITY_CENTER
      const avg = shape.upper.reduce((a, b) => a + b, 0) / shape.upper.length;
      const semitoneShift = Math.round((GRAVITY_CENTER - avg) / 12) * 12;
      finalUpper = shape.upper.map(m => m + semitoneShift);
    } else {
      finalUpper = bestVoiceLeading(shape.upper, prevUpperMidi);
    }

    midiVoicings.push({bass: shape.bass, upper: finalUpper});
    prevUpperMidi = finalUpper;
  }

  // Pedal: check pitch class on MIDI integers before any Hz conversion
  const pedalMidi = chords.length > 0
    ? (() => {
        const pf = getGlobalPedalFreq(chords[0], rootNote, globalPedal);
        return pf ? midiFromFreq(pf) : null;
      })()
    : null;
  const pedalPc = pedalMidi != null ? ((pedalMidi % 12) + 12) % 12 : null;

  return midiVoicings.map(v => {
    const upper = v.upper.map(m => parseFloat(freqFromMidi(m).toFixed(2)));
    if (pedalMidi != null) {
      const alreadyPresent = v.upper.some(m => ((m % 12) + 12) % 12 === pedalPc);
      if (!alreadyPresent) upper.push(parseFloat(freqFromMidi(pedalMidi).toFixed(2)));
    }
    return {bass: parseFloat(freqFromMidi(v.bass).toFixed(2)), upper};
  });
}

// ---- HELPERS ----

function rgba(hex,a){
  const r=parseInt(hex.slice(1,3),16),g=parseInt(hex.slice(3,5),16),b=parseInt(hex.slice(5,7),16);
  return `rgba(${r},${g},${b},${a})`;
}
function barDist(n){return n===3?[1,1,2]:[1,1,1,1];}
function freqToMidi(f){return Math.max(0,Math.min(127,Math.round(69+12*Math.log2(f/440))));}
function varLen(n){
  if(n===0)return[0];const b=[];let v=n;
  while(v>0){b.unshift(v&0x7F);v>>=7;}
  for(let i=0;i<b.length-1;i++)b[i]|=0x80;return b;
}
function buildMidi(voicedChords, bpmVal, dist) {
  const TPB=480, tempo=Math.round(60000000/bpmVal), evts=[];
  evts.push(0x00,0xFF,0x51,0x03,(tempo>>16)&0xFF,(tempo>>8)&0xFF,tempo&0xFF);
  voicedChords.forEach((v,i)=>{
    const dur=dist[i]*4*TPB;
    const notes=[v.bass,...v.upper].map(freqToMidi).filter(n=>n>=0&&n<=127);
    notes.forEach(n=>evts.push(...varLen(0),0x90,n,80));
    notes.forEach((n,ni)=>evts.push(...varLen(ni===0?dur:0),0x80,n,0));
  });
  evts.push(0x00,0xFF,0x2F,0x00);
  const tl=evts.length;
  const hdr=[0x4D,0x54,0x68,0x64,0,0,0,6,0,0,0,1,(TPB>>8)&0xFF,TPB&0xFF];
  const th=[0x4D,0x54,0x72,0x6B,(tl>>24)&0xFF,(tl>>16)&0xFF,(tl>>8)&0xFF,tl&0xFF];
  return new Uint8Array([...hdr,...th,...evts]);
}
function triggerMidiDownload(bytes,filename){
  const blob=new Blob([bytes],{type:'audio/midi'}),url=URL.createObjectURL(blob);
  const a=document.createElement('a');a.href=url;a.download=filename;
  document.body.appendChild(a);a.click();document.body.removeChild(a);
  setTimeout(()=>URL.revokeObjectURL(url),8000);
}
function makeMidiDragHandler(bytes,filename){
  return e=>{
    const url=URL.createObjectURL(new Blob([bytes],{type:'audio/midi'}));
    e.dataTransfer.effectAllowed='copy';
    e.dataTransfer.setData('DownloadURL',`audio/midi:${filename}:${url}`);
    setTimeout(()=>URL.revokeObjectURL(url),10000);
  };
}

function defaultExt(sym, rootNote) {
  const cd = parseComplexChord(sym, rootNote);
  return {
    seventh: cd.intervals.some(i=>i===10||i===11),
    ninth:   cd.intervals.some(i=>i===14||i===2),
  };
}
function defaultExts(chords, rootNote) {
  return chords.map(sym=>defaultExt(sym,rootNote));
}

// ---- EMOTIONS ----

const EMOTIONS = {
  bittersweet: {
    label: 'Bittersweet', sub: 'Nostalgic & tender', color: '#D47FA8',
    progs: [
      { chords: ['Iadd9',  'Imaj7',   'IVmaj7',    'iv(maj7)'], style: 1 }, // classic bittersweet
      { chords: ['VImaj7', 'IVmaj7',  'Imaj7',     'V7'],       style: 1 }, // nostalgic resolution
      { chords: ['Imaj7',  'vim7',    'IVmaj7',    'iv(maj7)'], style: 1 }, // tender minor iv
      { chords: ['VImaj7', 'Imaj7',   'IVmaj7',    'ivm'],      style: 1 }, // gentle yearning
      { chords: ['Imaj9',  'VImaj7',  'IVmaj7',    'Vsus4'],    style: 2 }, // floaty resolved
      { chords: ['im',     'bVII',    'bVI',        'bVII'],     style: 1 }, // sad neutral loop
      { chords: ['bVI',    'im',      'bVII',       'im'],       style: 1 }, // mega relaxed
      { chords: ['im',     'bVI',     'ivm',        'bVI'],      style: 1 }, // sorrow
      { chords: ['im',     'bVII',    'ivm',        'bVI'],      style: 1 }, // deep sad
      { chords: ['ivm',    'bVI',     'im',         'im'],       style: 1 }, // emotional resolve
      { chords: ['im',     'bIII',    'v',          'v'],        style: 1 }, // melancholic minor v
      { chords: ['bVI',    'im',      'bVII',       'v'],        style: 1 }, // bittersweet resolve
      { chords: ['bVI',    'im',      'bVII',       'bVII'],     style: 1 }, // language vibe / Porter Robinson
    ]
  },
  uplifting: {
    label: 'Uplifting', sub: 'Euphoric & progressive', color: '#F5C518',
    progs: [
      { chords: ['vim7',   'IVmaj7',  'Imaj7',     'V7'],       style: 2 }, // classic prog house
      { chords: ['Imaj7',  'V7',      'vim7',       'IVmaj7'],   style: 2 }, // I-V-vi-IV anthem
      { chords: ['IVmaj7', 'V7',      'Imaj7',      'vim7'],     style: 2 }, // IV-V-I lift
      { chords: ['Imaj9',  'VImaj9',  'IVmaj7',    'V9'],        style: 2 }, // lush prog house
      { chords: ['bVI',    'bIII',    'bVII',       'im'],        style: 2 }, // feel-good epic
      { chords: ['v',      'bVI',     'bVII',       'im'],        style: 2 }, // minor v uplifting
      { chords: ['vi',     'IV',      'I',          'V'],         style: 2 }, // pop euphoric
      { chords: ['vi',     'IV',      'I',          'ii'],        style: 1 }, // pure joy
      { chords: ['IV',     'V',       'I',          'I'],         style: 2 }, // cheerful resolve
      { chords: ['im',     'im',      'bIII',       'bVI'],       style: 2 }, // happy pump-up electric
      { chords: ['im',     'bIII',    'bVI',        'bVII'],      style: 2 }, // pump-up minor
      { chords: ['bVImaj7','bVII',    'im',         'ivm'],       style: 2 }, // anthemic rise
      { chords: ['V',      'V',       'bIII',       'bVI'],       style: 2 }, // breakaway stabs
      { chords: ['IVadd9', 'iim7',    'vim7',       'V'],         style: 1 }, // melodic glue
      { chords: ['I',      'vii',     'vi',         'V'],         style: 2 }, // Titanium / stand ground
      { chords: ['bVI',    'bVI',     'im',         'bVII'],      style: 2 }, // heroic pivot
      { chords: ['bVImaj7','bIII',    'bVII',       'im'],        style: 2 }, // epic resolve
    ]
  },
  dark: {
    label: 'Dark', sub: 'Trap & cinematic', color: '#9B6FD4',
    progs: [
      { chords: ['im',     'ivm',     'im',         'V7'],        style: 2 }, // standard dark loop
      { chords: ['im',     'im',      'bVI',        'bVII'],      style: 2 }, // natural minor open
      { chords: ['im',     'im',      'bII',        'bVII'],      style: 3 }, // phrygian open
      { chords: ['im7',    'bVII',    'bVI',        'V7'],        style: 1 }, // dark jazz
      { chords: ['im',     'bVI',     'im',         'bVII'],      style: 2 }, // cinematic pulse
      { chords: ['ivm',    'im',      'bVI',        'V7'],        style: 2 }, // iv descent
      { chords: ['im',     'bVII',    'bIII',       'ivm'],       style: 2 }, // light groove dark
      { chords: ['im',     'bVI',     'ivm',        'V7'],        style: 3 }, // dark serious
      { chords: ['im',     'bIII',    'IV',         'bVII'],      style: 2 }, // trap groove
      { chords: ['ivm',    'bVI',     'im',         'im'],        style: 2 }, // emotional resolve
      { chords: ['im',     'bVI',     'ivm',        'ivm'],       style: 2 }, // aggressive pump-up
      { chords: ['im',     'im',      'bVI',        'ivm'],       style: 2 }, // aggressive stab
      { chords: ['im',     'bIII',    'IV',         'IV'],        style: 2 }, // funk groove Dorian
    ]
  },
  deep: {
    label: 'Deep', sub: 'House & garage', color: '#4ECFA0',
    progs: [
      { chords: ['iim9',   'V9',      'Imaj7',      'vim7'],      style: 2 },
      { chords: ['Imaj7',  'vim7',    'iim7',       'V9'],        style: 2 },
      { chords: ['Imaj7',  'iiim7',   'VImaj7',     'iim9'],      style: 1 },
      { chords: ['iim9',   'Imaj7',   'vim7',       'V9'],        style: 2 },
      { chords: ['Imaj7',  'V7',      'vim7',       'IVmaj7'],    style: 2 },
      { chords: ['Imaj9',  'VImaj9',  'IVmaj7',    'V9'],         style: 2 },
    ]
  },
};

const VOICING_STYLES = [
  {id:1, label:'Block', sub:'Close'},
  {id:2, label:'EDM',   sub:'Open'},
  {id:3, label:'Wide',  sub:'Spread'},
];
const PEDAL_DEGREES  = ['off','root','third','fifth','seventh'];
const PEDAL_LABELS   = {off:'Off',root:'Root',third:'3rd',fifth:'5th',seventh:'7th'};

// ---- CSS ----

const CSS = `
  @import url('https://fonts.googleapis.com/css2?family=Bebas+Neue&family=Outfit:wght@300;400;500;600&family=JetBrains+Mono:wght@500;700&display=swap');
  *{box-sizing:border-box;margin:0;padding:0;}
  html,body{background:#12121E;min-height:100vh;}
  .root{min-height:100vh;background:radial-gradient(ellipse 140% 60% at 50% -10%,#1A1A38 0%,#12121E 60%);font-family:'Outfit',sans-serif;color:#C8C8E0;padding:32px 20px 80px;max-width:500px;margin:0 auto;}
  .title{font-family:'Bebas Neue',cursive;font-size:54px;letter-spacing:4px;color:#F0F0FF;line-height:1;text-shadow:0 2px 12px rgba(0,0,0,0.5);}
  .tagline{font-size:14px;font-weight:300;color:#8888B0;letter-spacing:2.5px;text-transform:uppercase;margin-bottom:36px;margin-top:4px;}
  .section-label{font-size:14px;font-weight:600;letter-spacing:2px;text-transform:uppercase;color:#8888B0;margin-bottom:14px;}

  /* Piano */
  .piano-outer{background:linear-gradient(160deg,#1C1C30,#141422);border:1px solid #0C0C1A;border-radius:14px;padding:16px 16px 14px;margin-bottom:30px;width:100%;box-shadow:0 8px 32px rgba(0,0,0,0.55);}
  .piano-row{position:relative;width:100%;display:flex;}
  .white-key{flex:1;height:90px;background:linear-gradient(180deg,#2A2A42,#1E1E32);border-right:1px solid #0C0C1A;border-bottom:4px solid #0A0A14;border-radius:7px;cursor:pointer;display:flex;align-items:flex-end;justify-content:center;padding-bottom:8px;transition:all 0.1s;position:relative;z-index:1;user-select:none;}
  .white-key:first-child{border-left:none;}.white-key:last-child{border-right:none;}
  .white-key:hover{background:linear-gradient(180deg,#323250,#26263C);}
  .white-key:active{background:linear-gradient(180deg,#1C1C2E,#14141E);box-shadow:inset 0 3px 6px rgba(0,0,0,0.5);}
  .white-key.wk-on{background:var(--pac);box-shadow:0 0 20px var(--pacg);}
  .wk-lbl{font-family:'JetBrains Mono',monospace;font-size:14px;font-weight:600;color:#505070;pointer-events:none;}
  .white-key.wk-on .wk-lbl{color:rgba(0,0,0,0.5);}
  .black-key{position:absolute;top:0;z-index:2;height:58px;background:linear-gradient(180deg,#181828,#0C0C18);border:1px solid #0A0A16;border-bottom:5px solid #06060E;border-radius:5px;cursor:pointer;transition:all 0.1s;user-select:none;box-shadow:3px 5px 10px rgba(0,0,0,0.7);display:flex;align-items:flex-end;justify-content:center;padding-bottom:5px;}
  .black-key:hover{background:linear-gradient(180deg,#222234,#141422);}
  .black-key:active{border-bottom-width:2px;transform:translateY(3px);}
  .black-key.bk-on{background:var(--pac);border-color:var(--pac);box-shadow:0 0 16px var(--pacg);}
  .bk-lbl{font-family:'JetBrains Mono',monospace;font-size:11px;font-weight:700;color:#404055;pointer-events:none;letter-spacing:-0.5px;}
  .black-key.bk-on .bk-lbl{color:rgba(0,0,0,0.5);}
  .piano-footer{display:flex;align-items:center;margin-top:10px;}
  .piano-footer-lbl{font-size:14px;color:#7070A0;font-family:'JetBrains Mono',monospace;}
  .piano-footer-lbl b{font-weight:700;font-size:16px;}

  /* Emotions */
  .emotions{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:20px;}
  .emotion{padding:16px 18px;border-radius:13px;border:1px solid #0E0E1E;background:linear-gradient(160deg,#1C1C30,#141422);cursor:pointer;transition:all 0.16s;text-align:left;box-shadow:0 6px 20px rgba(0,0,0,0.4);}
  .emotion:hover{background:linear-gradient(160deg,#22223A,#1A1A28);}
  .emotion:active{transform:translateY(2px);}
  .emotion.active{border-color:var(--ec);box-shadow:0 0 0 1px var(--ec),0 6px 28px var(--eg);}
  .emotion-name{font-family:'Bebas Neue',cursive;font-size:26px;letter-spacing:1px;line-height:1;margin-bottom:4px;color:#D0D0E8;transition:color 0.16s;}
  .emotion.active .emotion-name{color:var(--ec);}
  .emotion-sub{font-size:14px;color:#8080A8;line-height:1.3;}
  .emotion.active .emotion-sub{color:#B0B0CC;}

  /* Generate */
  .generate{width:100%;padding:18px;border-radius:12px;border:none;border-bottom:4px solid rgba(0,0,0,0.45);font-family:'Bebas Neue',cursive;font-size:22px;letter-spacing:3px;cursor:pointer;transition:all 0.12s;margin-bottom:26px;}
  .generate:disabled{background:linear-gradient(160deg,#1A1A2E,#121220);color:#383858;cursor:not-allowed;box-shadow:inset 0 2px 5px rgba(0,0,0,0.4);}
  .generate.ready{background:var(--ac);color:#000;box-shadow:0 6px 28px var(--acg),inset 0 1px 0 rgba(255,255,255,0.35);}
  .generate.ready:hover{filter:brightness(1.08);}
  .generate.ready:active{transform:translateY(3px);border-bottom-width:1px;box-shadow:0 2px 10px var(--acg);}
  @keyframes genFlash{0%{transform:scale(1);}15%{transform:scale(1.03);}30%{transform:scale(0.98);}100%{transform:scale(1);}}
  @keyframes chordSlotIn{0%{opacity:0;transform:translateY(12px) scale(0.92);}60%{opacity:1;transform:translateY(-2px) scale(1.02);}100%{opacity:1;transform:translateY(0) scale(1);}}
  @keyframes resultBounce{0%{transform:scale(1);}25%{transform:scale(1.012) translateY(-3px);}55%{transform:scale(0.994);}100%{transform:scale(1);}}
  .chord-entering{animation:chordSlotIn 0.38s cubic-bezier(0.34,1.56,0.64,1) both;}
  .generating{animation:genFlash 0.45s cubic-bezier(0.34,1.56,0.64,1);}

  /* Result */
  .result{background:linear-gradient(160deg,#1C1C30,#141422);border:1px solid #0C0C1A;border-radius:16px;padding:22px;margin-bottom:14px;box-shadow:0 10px 40px rgba(0,0,0,0.5);will-change:transform;}
  .result.generating-container{animation:resultBounce 0.45s cubic-bezier(0.34,1.56,0.64,1);}
  .result-head{display:flex;align-items:center;justify-content:space-between;margin-bottom:14px;gap:10px;flex-wrap:wrap;contain:layout;}
  .result-meta{font-size:14px;color:#8888B0;letter-spacing:1px;text-transform:uppercase;}
  .result-meta b{font-weight:600;}
  .result-actions{display:flex;gap:8px;align-items:center;flex-wrap:wrap;isolation:isolate;contain:layout style;}

  /* Voicing (3 buttons) */
  .voicing-row{display:flex;gap:6px;margin-bottom:10px;}
  .vs-btn{flex:1;height:32px;border-radius:8px;border:1px solid #1A1A2C;background:linear-gradient(160deg,#1A1A2C,#111120);color:#505070;cursor:pointer;transition:all 0.1s;font-family:'JetBrains Mono',monospace;font-size:12px;font-weight:700;display:flex;align-items:center;justify-content:center;gap:5px;user-select:none;box-shadow:0 2px 8px rgba(0,0,0,0.4);}
  .vs-btn:hover{color:#A0A0C8;filter:brightness(1.15);}
  .vs-btn:active{transform:translateY(1px);}
  .vs-btn.vs-on{border-color:var(--ac);background:var(--ac);color:#000;box-shadow:0 3px 14px var(--acg),inset 0 1px 0 rgba(255,255,255,0.3);}
  .vs-num{font-size:14px;font-weight:800;}

  /* Global pedal */
  .pedal-section{margin-bottom:14px;}
  .pedal-lbl{font-size:11px;color:#404060;letter-spacing:1.5px;text-transform:uppercase;font-family:'Outfit',sans-serif;font-weight:600;margin-bottom:5px;}
  .pedal-row{display:flex;gap:4px;}
  .ped-btn{flex:1;height:26px;border-radius:6px;border:1px solid #1A1A2C;background:linear-gradient(160deg,#1A1A2C,#111120);color:#505070;cursor:pointer;transition:all 0.12s;font-family:'JetBrains Mono',monospace;font-size:11px;font-weight:700;display:flex;align-items:center;justify-content:center;user-select:none;box-shadow:0 2px 6px rgba(0,0,0,0.4);}
  .ped-btn:hover{color:#A0A0C8;filter:brightness(1.15);}
  .ped-btn:active{transform:translateY(1px);}
  .ped-btn.ped-on{border-color:var(--ac);color:var(--ac);box-shadow:0 0 10px var(--acg),inset 0 0 14px var(--acg);}

  /* BPM + transport */
  .bpm-row{display:flex;align-items:center;gap:5px;}
  .bpm-btn{width:32px;height:32px;border-radius:9px;border:1px solid #0C0C1A;border-bottom:3px solid #0A0A14;background:linear-gradient(160deg,#242438,#181828);color:#C8C8E0;cursor:pointer;font-size:18px;display:flex;align-items:center;justify-content:center;transition:all 0.1s;font-family:'Outfit',sans-serif;box-shadow:0 3px 10px rgba(0,0,0,0.45);}
  .bpm-btn:hover{color:var(--ac);}
  .bpm-btn:active{transform:translateY(2px);border-bottom-width:1px;}
  .bpm-val{font-family:'JetBrains Mono',monospace;font-size:16px;font-weight:700;color:#F0F0FF;min-width:38px;text-align:center;}
  .bpm-unit{font-size:14px;color:#8080A8;letter-spacing:1px;text-transform:uppercase;}
  .play-btn{font-size:16px;font-weight:700;letter-spacing:2px;text-transform:uppercase;padding:10px 22px;border-radius:11px;border:none;border-bottom:4px solid rgba(0,0,0,0.45);background:var(--ac);color:#000;cursor:pointer;transition:all 0.1s;font-family:'Bebas Neue',cursive;display:flex;align-items:center;gap:8px;box-shadow:0 6px 24px var(--acg),inset 0 1px 0 rgba(255,255,255,0.45);position:relative;will-change:transform;transform:translateZ(0);}
  .play-btn:hover{filter:brightness(1.1);}
  .play-btn:active{transform:translateY(3px) translateZ(0);border-bottom-width:1px;margin-bottom:3px;}
  .play-btn.is-playing{filter:brightness(0.82);}
  .midi-btn{font-size:13px;font-weight:600;letter-spacing:1px;text-transform:uppercase;padding:8px 14px;border-radius:9px;border:1px solid #0C0C1A;border-bottom:3px solid #0A0A14;background:linear-gradient(160deg,#222238,#181826);color:#A0A0C8;cursor:grab;transition:all 0.12s;font-family:'Outfit',sans-serif;display:flex;align-items:center;gap:6px;box-shadow:0 4px 12px rgba(0,0,0,0.45);user-select:none;}
  .midi-btn:hover{color:var(--ac);filter:brightness(1.1);}
  .midi-btn:active{cursor:grabbing;transform:translateY(2px);border-bottom-width:1px;}
  .play-tri{width:0;height:0;border-top:5px solid transparent;border-bottom:5px solid transparent;border-left:9px solid currentColor;flex-shrink:0;}
  .stop-sq{width:9px;height:9px;background:currentColor;border-radius:2px;flex-shrink:0;}
  .pulse{animation:blink 0.55s ease-in-out infinite alternate;}
  @keyframes blink{from{opacity:0.35;}to{opacity:1;}}

  /* Chord tiles */
  .chords{display:flex;flex-direction:row;gap:6px;will-change:contents;}
  .chord{flex:1;min-width:0;display:flex;flex-direction:column;align-items:center;gap:5px;background:linear-gradient(170deg,#1E1E34,#141422);border:1px solid #0C0C1A;border-top-color:#2C2C44;border-bottom:3px solid #0A0A12;border-radius:14px;padding:12px 6px 10px;cursor:pointer;transition:transform 0.1s ease,box-shadow 0.1s ease,border-bottom-width 0.1s ease;box-shadow:0 6px 22px rgba(0,0,0,0.45);user-select:none;-webkit-user-select:none;will-change:transform;position:relative;}
  .chord:not(.lit):hover{background:linear-gradient(170deg,#26263E,#1A1A2C);}
  .chord:active{transform:translateY(1.5px);box-shadow:0 3px 10px rgba(0,0,0,0.5),inset 0 2px 5px rgba(0,0,0,0.25);}
  .chord.lit{border-color:var(--ac) !important;border-bottom:1px solid var(--ac) !important;background:linear-gradient(170deg,#1E1E3A,#141428);transform:translateY(1.5px);box-shadow:0 0 28px var(--acg),inset 0 2px 5px rgba(0,0,0,0.25);}
  .chord.lit:hover{transform:translateY(1.5px);background:linear-gradient(170deg,#1E1E3A,#141428);}
  .chord-num{position:absolute;top:6px;left:8px;font-family:'JetBrains Mono',monospace;font-size:10px;font-weight:700;color:#303050;pointer-events:none;}
  .chord.lit .chord-num{color:rgba(255,255,255,0.2);}
  .chord-name{font-family:'JetBrains Mono',monospace;font-size:15px;font-weight:700;color:#F0F0FF;line-height:1;text-align:center;max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;padding:0 2px;}
  .chord.lit .chord-name{color:var(--ac);}

  /* Ext buttons */
  .ext-row{display:flex;gap:3px;width:100%;}
  .ext-btn{flex:1;font-family:'JetBrains Mono',monospace;font-size:13px;font-weight:700;padding:6px 0;border-radius:6px;border:1px solid #0C0C1A;border-bottom:2px solid #0A0A14;background:linear-gradient(170deg,#1C1C30,#121220);color:#606080;cursor:pointer;transition:all 0.1s;text-align:center;user-select:none;line-height:1;box-shadow:0 2px 6px rgba(0,0,0,0.4);}
  .ext-btn:hover{color:#B0B0D8;}
  .ext-btn:active{transform:translateY(1px);border-bottom-width:1px;}
  .ext-btn.ext-on{background:var(--ac);border-color:var(--ac);border-bottom-color:rgba(0,0,0,0.4);color:#000;box-shadow:0 3px 12px var(--acg),inset 0 1px 0 rgba(255,255,255,0.4);}

  /* Per-chord action row */
  .chord-regen{flex:1;height:26px;border-radius:5px;border:1px solid #0C0C1A;border-bottom:2px solid #0A0A14;background:linear-gradient(170deg,#1A1A2C,#101018);color:#505070;cursor:pointer;transition:all 0.12s;display:flex;align-items:center;justify-content:center;user-select:none;box-shadow:0 2px 5px rgba(0,0,0,0.35);}
  .chord-regen:hover{border-color:var(--ac);color:var(--ac);}
  .chord-regen:active{transform:translateY(1px) rotate(180deg);border-bottom-width:1px;}
  .chord-midi{flex:1;height:26px;border-radius:5px;border:1px solid #0C0C1A;border-bottom:2px solid #0A0A14;background:linear-gradient(170deg,#1A1A2C,#101018);cursor:grab;transition:all 0.12s;display:flex;align-items:center;justify-content:center;color:#6060A0;user-select:none;box-shadow:0 2px 5px rgba(0,0,0,0.35);}
  .chord-midi:hover{color:var(--ac);filter:brightness(1.1);}
  .chord-midi:active{cursor:grabbing;transform:translateY(1px);border-bottom-width:1px;}

  .bar-blocks{display:flex;gap:3px;margin-top:1px;}
  .bar-block{height:3px;width:9px;border-radius:2px;background:#1E1E30;}
  .chord.lit .bar-block{background:var(--ac);}

  /* Ruler */
  .ruler-wrap{margin-top:16px;}
  .ruler-bars{display:flex;gap:4px;}
  .ruler-bar{flex:1;height:5px;border-radius:3px;background:#0C0C18;overflow:hidden;box-shadow:inset 0 2px 4px rgba(0,0,0,0.6);}
  .ruler-fill{height:100%;border-radius:3px;background:var(--ac);box-shadow:0 0 6px var(--ac);}

  .key-hint{text-align:center;font-family:'JetBrains Mono',monospace;font-size:11px;color:#2A2A44;margin-top:8px;letter-spacing:1px;}

  /* History */
  .divider{height:1px;background:#1A1A28;margin:24px 0;}
  .hist-label{font-size:14px;font-weight:600;letter-spacing:2px;text-transform:uppercase;color:#6060A0;margin-bottom:12px;}
  .hist-item{display:flex;align-items:center;gap:12px;padding:12px 16px;border-radius:12px;border:1px solid #0E0E1C;background:linear-gradient(160deg,#181826,#111120);margin-bottom:8px;cursor:pointer;transition:all 0.14s;box-shadow:0 4px 14px rgba(0,0,0,0.45);}
  .hist-item:hover{background:linear-gradient(160deg,#1E1E2E,#161624);filter:brightness(1.08);}
  .hist-dot{width:8px;height:8px;border-radius:50%;flex-shrink:0;box-shadow:0 0 8px currentColor;}
  .hist-chords{font-family:'JetBrains Mono',monospace;font-size:11px;color:#C8C8E0;flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
  .hist-meta{font-size:13px;color:#6060A0;white-space:nowrap;}
  .empty-state{text-align:center;padding:40px 20px;}
  .empty-big{font-family:'Bebas Neue',cursive;font-size:40px;color:#1C1C2C;letter-spacing:2px;margin-bottom:12px;}
  .empty-sub{font-size:16px;color:#6060A0;}
`;

// ---- COMPONENT ----

export default function ChordForge() {
  const [root,         setRoot]         = useState('C');
  const [emotion,      setEmotion]      = useState(null);
  const [ps,           setPs]           = useState({current:null,history:[]});
  const [lastIdx,      setLastIdx]      = useState(-1);
  const [voicingStyle, setVoicingStyle] = useState(2);
  const [exts,         setExts]         = useState([]); // [{seventh,ninth},...]
  const [globalPedal,  setGlobalPedal]  = useState('off');
  const [bpm,          setBpm]          = useState(120);
  const [playing,      setPlaying]      = useState(false);
  const [playIdx,      setPlayIdx]      = useState(-1);
  const [barFills,     setBarFills]     = useState([0,0,0,0]);
  const [generating,   setGenerating]   = useState(false);

  const audioCtxRef    = useRef(null);
  const oscsRef        = useRef([]);
  const timersRef      = useRef([]);
  const rafRef         = useRef(null);
  const loopRef        = useRef(false);
  const playStartRef   = useRef(0);
  const barDurRef      = useRef(0);
  const chordOscsRef   = useRef({});
  const chordTimesRef  = useRef({});
  const playIdxRef     = useRef(-1);
  const currentRef     = useRef(null);
  const extsRef        = useRef([]);
  const globalPedalRef = useRef('off');
  const voiceStyleRef  = useRef(2);
  const bpmRef         = useRef(120);
  const lastRulerBiRef = useRef(-1);
  const holdOscsRef    = useRef([]);
  const holdEnvsRef    = useRef([]);
  const holdStartCb    = useRef(null);
  const holdStopCb     = useRef(null);

  const {current, history} = ps;
  currentRef.current    = current;
  extsRef.current       = exts;
  globalPedalRef.current = globalPedal;
  voiceStyleRef.current = voicingStyle;
  bpmRef.current        = bpm;

  const em  = emotion ? EMOTIONS[emotion] : null;
  const ac  = em ? em.color : '#555570';
  const acg = em ? rgba(em.color,0.28) : 'transparent';
  const pac  = current ? current.color : ac;
  const pacg = current ? rgba(current.color,0.28) : acg;

  // ---- KEYBOARD 1-4 ----
  useEffect(() => {
    const active = new Set();
    const dn = e => {
      if (e.repeat) return;
      const i = parseInt(e.key) - 1;
      if (i>=0 && i<=3 && !active.has(i) && holdStartCb.current && currentRef.current && i < currentRef.current.chords.length) {
        active.add(i);
        holdStartCb.current(i);
      }
    };
    const up = e => {
      const i = parseInt(e.key) - 1;
      if (i>=0 && i<=3 && active.has(i) && holdStopCb.current) {
        active.delete(i);
        holdStopCb.current();
      }
    };
    window.addEventListener('keydown', dn);
    window.addEventListener('keyup', up);
    return () => { window.removeEventListener('keydown',dn); window.removeEventListener('keyup',up); };
  }, []);

  // ---- GENERATE ----
  const generate = () => {
    if (!emotion) return;
    const e = EMOTIONS[emotion];
    const n = e.progs.length;
    let idx;
    if (n<=1){idx=0;} else{do{idx=Math.floor(Math.random()*n);}while(idx===lastIdx);}
    const prog = e.progs[idx];
    let chords = [...prog.chords];
    if (chords.length===3) chords=[...chords,chords[chords.length-1]];
    const newExts = defaultExts(chords, root);
    const entry = {id:Date.now(),emotion,root,chords,color:e.color,label:e.label};
    setLastIdx(idx);
    setVoicingStyle(prog.style||2);
    setExts(newExts);
    setGlobalPedal('off');
    setGenerating(true);
    setTimeout(()=>setGenerating(false),600);
    setPs(prev=>({current:entry,history:prev.current?[prev.current,...prev.history].slice(0,10):prev.history}));
    stopPlay();
  };

  const restore = item => {
    setPs(prev=>({current:item,history:[...(prev.current?[prev.current]:[]),...prev.history.filter(h=>h.id!==item.id)].slice(0,10)}));
    setExts(defaultExts(item.chords,item.root));
    setVoicingStyle(2);
    setGlobalPedal('off');
    stopPlay();
  };

  const regenChord = ci => {
    if (!current) return;
    const e = EMOTIONS[current.emotion];
    if (!e) return;
    const pool = [...new Set(e.progs.flatMap(p=>p.chords))];
    const cur = current.chords[ci];
    let nc=cur; let tries=0;
    do{nc=pool[Math.floor(Math.random()*pool.length)];tries++;}while(nc===cur&&tries<20);
    const newChords = current.chords.map((c,i)=>i===ci?nc:c);
    const entry = {...current,id:Date.now(),chords:newChords};
    setPs(prev=>({current:entry,history:prev.current?[prev.current,...prev.history].slice(0,10):prev.history}));
    setExts(prev=>prev.map((ex,i)=>i===ci?defaultExt(nc,current.root):ex));
  };

  const toggleExt = (ci, type) => {
    setExts(prev => {
      const next = prev.map((ex,i)=>i===ci?{...ex,[type]:!ex[type]}:ex);
      extsRef.current = next;
      if (loopRef.current && chordTimesRef.current[ci]) {
        const ctx = getCtx();
        const {when,dur} = chordTimesRef.current[ci];
        if (when > ctx.currentTime+0.05) {
          (chordOscsRef.current[ci]||[]).forEach(o=>{try{o.stop();}catch(_){}});
          const oldSet = new Set(chordOscsRef.current[ci]||[]);
          oscsRef.current = oscsRef.current.filter(o=>!oldSet.has(o));
          const v = generateVoicedNotes([currentRef.current.chords[ci]],currentRef.current.root,voiceStyleRef.current,[next[ci]],globalPedalRef.current)[0];
          chordOscsRef.current[ci] = scheduleChord(v,when,dur);
        }
      }
      return next;
    });
  };

  const changeBpm = d => setBpm(b=>Math.max(60,Math.min(220,b+d)));
  const dist = current ? barDist(current.chords.length) : [];

  // ---- AUDIO ----
  function getCtx() {
    if (!audioCtxRef.current || audioCtxRef.current.state==='closed') {
      const ctx = new(window.AudioContext||window.webkitAudioContext)();
      const comp = ctx.createDynamicsCompressor();
      comp.threshold.value=-18;comp.knee.value=8;comp.ratio.value=4;
      comp.attack.value=0.004;comp.release.value=0.1;
      comp.connect(ctx.destination);ctx._comp=comp;ctx._reverb=null;
      audioCtxRef.current=ctx;
    }
    return audioCtxRef.current;
  }
  function getReverb(ctx) {
    if (ctx._reverb) return ctx._reverb;
    const sr=ctx.sampleRate,len=Math.floor(sr*2.5),ir=ctx.createBuffer(2,len,sr);
    for(let ch=0;ch<2;ch++){const d=ir.getChannelData(ch);for(let i=0;i<len;i++)d[i]=(Math.random()*2-1)*Math.pow(1-i/len,2.4);}
    const conv=ctx.createConvolver();conv.buffer=ir;conv.connect(ctx._comp);ctx._reverb=conv;return conv;
  }
  function scheduleChord(voiced,when,dur) {
    const ctx=getCtx(),rev=getReverb(ctx);
    const mo=ctx.createGain();mo.gain.value=0.85;mo.connect(ctx._comp);
    const rs=ctx.createGain();rs.gain.value=0.4;rs.connect(rev);
    const keyUp=when+dur,lo=[];
    [voiced.bass,...voiced.upper].forEach(freq=>{
      const filt=ctx.createBiquadFilter();filt.type='lowpass';filt.frequency.value=900;filt.Q.value=0.3;
      const env=ctx.createGain();
      env.gain.setValueAtTime(0,when);env.gain.linearRampToValueAtTime(0.38,when+0.012);
      env.gain.setValueAtTime(0.38,keyUp);env.gain.linearRampToValueAtTime(0.0001,keyUp+0.08);
      filt.connect(env);env.connect(mo);env.connect(rs);
      [{type:'sine',mult:1,gain:0.6},{type:'triangle',mult:2.005,gain:0.18},{type:'sine',mult:3.01,gain:0.05}].forEach(({type,mult,gain})=>{
        const g=ctx.createGain();g.gain.value=gain;g.connect(filt);
        const osc=ctx.createOscillator();osc.type=type;osc.frequency.value=freq*mult;
        osc.connect(g);osc.start(when);osc.stop(keyUp+0.12);oscsRef.current.push(osc);lo.push(osc);
      });
    });
    return lo;
  }
  function startRAF() {
    if(rafRef.current)cancelAnimationFrame(rafRef.current);
    const tick=()=>{
      if(!loopRef.current){rafRef.current=null;return;}
      const ctx=audioCtxRef.current;
      if(!ctx){rafRef.current=requestAnimationFrame(tick);return;}
      const bd=barDurRef.current;
      if(bd>0){
        const total=bd*4,elapsed=Math.max(0,(ctx.currentTime-playStartRef.current)%total);
        setBarFills([0,1,2,3].map(bi=>{const s=bi*bd,e=s+bd;if(elapsed<s)return 0;if(elapsed>=e)return 100;return((elapsed-s)/bd)*100;}));
        lastRulerBiRef.current=Math.floor(elapsed/bd);
      }
      rafRef.current=requestAnimationFrame(tick);
    };
    rafRef.current=requestAnimationFrame(tick);
  }
  function scheduleIteration(startTime) {
    if(!loopRef.current||!currentRef.current)return;
    const ctx=getCtx();
    const barDur=(60/bpmRef.current)*4;
    const {chords,root:r}=currentRef.current;
    const d=barDist(chords.length),durs=d.map(b=>b*barDur),total=durs.reduce((a,b)=>a+b,0);
    playStartRef.current=startTime;barDurRef.current=barDur;
    chordOscsRef.current={};chordTimesRef.current={};
    const voiced=generateVoicedNotes(chords,r,voiceStyleRef.current,extsRef.current,globalPedalRef.current);
    let offset=0;
    chords.forEach((_,i)=>{
      const when=startTime+offset,dur=durs[i];
      chordTimesRef.current[i]={when,dur};
      chordOscsRef.current[i]=scheduleChord(voiced[i],when,dur);
      const delay=Math.max(0,(when-ctx.currentTime)*1000);
      timersRef.current.push(setTimeout(()=>{if(loopRef.current){setPlayIdx(i);playIdxRef.current=i;}},delay));
      offset+=dur;
    });
    const endDelay=Math.max(0,(startTime-ctx.currentTime+total)*1000+60);
    timersRef.current.push(setTimeout(()=>{
      if(!loopRef.current)return;
      setPlayIdx(-1);playIdxRef.current=-1;setBarFills([0,0,0,0]);
      chordOscsRef.current={};chordTimesRef.current={};
      scheduleIteration(getCtx().currentTime+0.04);
    },endDelay));
  }
  function stopPlay() {
    loopRef.current=false;
    oscsRef.current.forEach(o=>{try{o.stop();}catch(_){}});
    oscsRef.current=[];timersRef.current.forEach(clearTimeout);timersRef.current=[];
    if(rafRef.current){cancelAnimationFrame(rafRef.current);rafRef.current=null;}
    setPlaying(false);setPlayIdx(-1);setBarFills([0,0,0,0]);lastRulerBiRef.current=-1;
  }
  async function togglePlay() {
    if(!current)return;
    if(playing){stopPlay();return;}
    const ctx=getCtx();
    if(ctx.state==='suspended')await ctx.resume();
    setPlaying(true);oscsRef.current=[];timersRef.current=[];loopRef.current=true;
    scheduleIteration(ctx.currentTime+0.05);startRAF();
  }
  async function holdStart(ci) {
    if(loopRef.current){
      loopRef.current=false;
      oscsRef.current.forEach(o=>{try{o.stop();}catch(_){}});
      oscsRef.current=[];timersRef.current.forEach(clearTimeout);timersRef.current=[];
      if(rafRef.current){cancelAnimationFrame(rafRef.current);rafRef.current=null;}
      setPlaying(false);setBarFills([0,0,0,0]);
    }
    holdStop();
    const ctx=getCtx();if(ctx.state==='suspended')await ctx.resume();
    const rev=getReverb(ctx);
    const {chords,root:r}=currentRef.current;

    // Voice the FULL progression so gravity context is identical to the loop,
    // then extract the voicing for the chord that was clicked/triggered.
    // Pedal is excluded here and added manually from chords[0] (same as loop).
    const allVoiced=generateVoicedNotes(chords,r,voiceStyleRef.current,extsRef.current,'off');
    const v={...allVoiced[ci],upper:[...allVoiced[ci].upper]};
    const pedalFreq=getGlobalPedalFreq(chords[0],r,globalPedalRef.current);
    if(pedalFreq) v.upper.push(pedalFreq);

    const when=ctx.currentTime+0.02,LONG=9999;
    const mo=ctx.createGain();mo.gain.value=0.85;mo.connect(ctx._comp);
    const rs=ctx.createGain();rs.gain.value=0.4;rs.connect(rev);
    [v.bass,...v.upper].forEach(freq=>{
      const filt=ctx.createBiquadFilter();filt.type='lowpass';filt.frequency.value=900;filt.Q.value=0.3;
      const env=ctx.createGain();env.gain.setValueAtTime(0,when);env.gain.linearRampToValueAtTime(0.38,when+0.015);
      filt.connect(env);env.connect(mo);env.connect(rs);holdEnvsRef.current.push(env);
      [{type:'sine',mult:1,gain:0.6},{type:'triangle',mult:2.005,gain:0.18},{type:'sine',mult:3.01,gain:0.05}].forEach(({type,mult,gain})=>{
        const g=ctx.createGain();g.gain.value=gain;g.connect(filt);
        const osc=ctx.createOscillator();osc.type=type;osc.frequency.value=freq*mult;
        osc.connect(g);osc.start(when);osc.stop(when+LONG);holdOscsRef.current.push(osc);
      });
    });
    setPlayIdx(ci);
  }
  function holdStop() {
    const ctx=audioCtxRef.current,RELEASE=0.08;
    if(ctx&&holdEnvsRef.current.length){
      const now=ctx.currentTime;
      holdEnvsRef.current.forEach(env=>{try{env.gain.cancelScheduledValues(now);env.gain.setValueAtTime(env.gain.value,now);env.gain.linearRampToValueAtTime(0.0001,now+RELEASE);}catch(_){}});
      const oscs=[...holdOscsRef.current];
      setTimeout(()=>oscs.forEach(o=>{try{o.stop();}catch(_){}}),RELEASE*1000+50);
    }
    holdOscsRef.current=[];holdEnvsRef.current=[];setPlayIdx(-1);
  }

  holdStartCb.current = holdStart;
  holdStopCb.current  = holdStop;

  // ---- RENDER ----
  return (
    <>
      <style>{CSS}</style>
      <div className="root" style={{'--ac':ac,'--acg':acg}}>
        <div className="title">CHORD FORGE</div>
        <div className="tagline">Pro Progression Tool &middot; EDM &amp; Trap</div>

        <div className="section-label">Root Key</div>
        <div className="piano-outer" style={{'--pac':pac,'--pacg':pacg}}>
          <div className="piano-row">
            {WHITE_KEYS.map(note=>(
              <div key={note} className={`white-key ${root===note?'wk-on':''}`} onClick={()=>setRoot(note)}>
                <span className="wk-lbl">{note}</span>
              </div>
            ))}
            {BK_DATA.map(({note,left})=>(
              <div key={note} className={`black-key ${root===note?'bk-on':''}`}
                style={{left,width:'calc(100% / 7 * 0.62)'}} onClick={()=>setRoot(note)}>
                <span className="bk-lbl">{note}</span>
              </div>
            ))}
          </div>
          <div className="piano-footer">
            <span className="piano-footer-lbl">Root: <b style={{color:pac}}>{root}</b></span>
          </div>
        </div>

        <div className="section-label">Mood</div>
        <div className="emotions">
          {Object.entries(EMOTIONS).map(([key,e])=>(
            <button key={key} className={`emotion ${emotion===key?'active':''}`}
              style={{'--ec':e.color,'--eg':rgba(e.color,0.18)}}
              onClick={()=>{setEmotion(key);setLastIdx(-1);}}>
              <div className="emotion-name">{e.label}</div>
              <div className="emotion-sub">{e.sub}</div>
            </button>
          ))}
        </div>

        <button className={`generate ${emotion?'ready':''} ${generating?'generating':''}`}
          disabled={!emotion} style={emotion?{'--ac':ac,'--acg':acg}:{}} onClick={generate}>
          {emotion?`GENERATE ${EMOTIONS[emotion].label.toUpperCase()}`:'SELECT A MOOD'}
        </button>

        {current?(
          <div className={`result ${generating?'generating-container':''}`}
            style={{'--ac':current.color,'--acg':rgba(current.color,0.22)}}>

            {/* Transport row */}
            <div className="result-head">
              <div className="result-meta">
                <b style={{color:current.color}}>{current.label}</b> &middot; {current.root}
              </div>
              <div className="result-actions">
                <div className="bpm-row" style={{'--ac':current.color}}>
                  <button className="bpm-btn" onClick={()=>changeBpm(-10)}>-</button>
                  <span className="bpm-val">{bpm}</span>
                  <button className="bpm-btn" onClick={()=>changeBpm(+10)}>+</button>
                  <span className="bpm-unit">bpm</span>
                </div>
                <button className={`play-btn ${playing?'is-playing':''}`}
                  style={{'--ac':current.color,'--acg':rgba(current.color,0.28)}} onClick={togglePlay}>
                  {playing?<span className="stop-sq pulse"/>:<span className="play-tri"/>}
                  {playing?'STOP':'PLAY'}
                </button>
                <button className="midi-btn" style={{'--ac':current.color}}
                  draggable
                  onDragStart={makeMidiDragHandler(
                    buildMidi(generateVoicedNotes(current.chords,current.root,voicingStyle,exts,globalPedal),bpm,barDist(current.chords.length)),
                    `${current.label}-${current.root}.mid`
                  )}
                  onClick={()=>triggerMidiDownload(
                    buildMidi(generateVoicedNotes(current.chords,current.root,voicingStyle,exts,globalPedal),bpm,barDist(current.chords.length)),
                    `${current.label}-${current.root}.mid`
                  )}>
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
                  MIDI
                </button>
              </div>
            </div>

            {/* Voicing selector */}
            <div className="voicing-row" style={{'--ac':current.color,'--acg':rgba(current.color,0.22)}}>
              {VOICING_STYLES.map(vs=>(
                <button key={vs.id} className={`vs-btn ${voicingStyle===vs.id?'vs-on':''}`}
                  onClick={()=>setVoicingStyle(vs.id)}>
                  <span className="vs-num">{vs.id}</span>
                  {vs.label}
                </button>
              ))}
            </div>

            {/* Global pedal */}
            <div className="pedal-section" style={{'--ac':current.color,'--acg':rgba(current.color,0.22)}}>
              <div className="pedal-lbl">Pedal Note</div>
              <div className="pedal-row">
                {PEDAL_DEGREES.map(deg=>(
                  <button key={deg} className={`ped-btn ${globalPedal===deg?'ped-on':''}`}
                    onClick={()=>setGlobalPedal(deg)}>
                    {deg==='off'
                      ? <svg width="9" height="9" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><line x1="1" y1="1" x2="9" y2="9"/><line x1="9" y1="1" x2="1" y2="9"/></svg>
                      : PEDAL_LABELS[deg]
                    }
                  </button>
                ))}
              </div>
            </div>

            {/* Chord tiles */}
            <div className="chords">
              {current.chords.map((chord,i)=>{
                const parsed = parseComplexChord(chord,current.root);
                const ext    = exts[i]||{};
                return(
                  <button key={i}
                    className={`chord ${playIdx===i?'lit':''} ${generating?'chord-entering':''}`}
                    style={{'--ac':current.color,'--acg':rgba(current.color,0.15),
                            animationDelay:generating?`${i*0.07}s`:'0s'}}
                    onMouseDown={e=>{e.preventDefault();holdStart(i);}}
                    onMouseUp={holdStop} onMouseLeave={holdStop}
                    onTouchStart={e=>{e.preventDefault();holdStart(i);}}
                    onTouchEnd={holdStop} onTouchCancel={holdStop}
                    onClick={e=>e.preventDefault()}>

                    <span className="chord-num">{i+1}</span>
                    <span className="chord-name">{parsed.displayName}</span>

                    {/* 7 / 9 toggles */}
                    <div className="ext-row"
                      onMouseDown={e=>e.stopPropagation()}
                      onTouchStart={e=>e.stopPropagation()}
                      onClick={e=>e.stopPropagation()}>
                      <button className={`ext-btn ${ext.seventh?'ext-on':''}`}
                        style={{'--ac':current.color}}
                        onClick={()=>toggleExt(i,'seventh')}>7</button>
                      <button className={`ext-btn ${ext.ninth?'ext-on':''}`}
                        style={{'--ac':current.color}}
                        onClick={()=>toggleExt(i,'ninth')}>9</button>
                    </div>

                    {/* MIDI + Regen */}
                    <div style={{display:'flex',gap:'3px',width:'100%'}}
                      onMouseDown={e=>e.stopPropagation()}
                      onTouchStart={e=>e.stopPropagation()}
                      onClick={e=>e.stopPropagation()}>
                      <span className="chord-midi" draggable
                        onDragStart={makeMidiDragHandler(
                          buildMidi(generateVoicedNotes([chord],current.root,voicingStyle,[ext],globalPedal),bpm,[2]),
                          `${parsed.displayName}.mid`
                        )}
                        onClick={()=>triggerMidiDownload(
                          buildMidi(generateVoicedNotes([chord],current.root,voicingStyle,[ext],globalPedal),bpm,[2]),
                          `${parsed.displayName}.mid`
                        )}>
                        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
                      </span>
                      <button className="chord-regen" style={{'--ac':current.color}}
                        onMouseDown={e=>e.stopPropagation()}
                        onTouchStart={e=>e.stopPropagation()}
                        onClick={e=>{e.stopPropagation();regenChord(i);}}>
                        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M1 4v6h6"/><path d="M3.51 15a9 9 0 1 0 .49-3.36"/></svg>
                      </button>
                    </div>

                    <div className="bar-blocks">
                      {Array.from({length:dist[i]||1}).map((_,bi)=><div key={bi} className="bar-block"/>)}
                    </div>
                  </button>
                );
              })}
            </div>

            <div className="ruler-wrap">
              <div className="ruler-bars">
                {[0,1,2,3].map(bi=>(
                  <div key={bi} className="ruler-bar">
                    <div className="ruler-fill" style={{width:`${barFills[bi]}%`}}/>
                  </div>
                ))}
              </div>
            </div>
            <div className="key-hint">KEYS 1 - 2 - 3 - 4 TO PLAY CHORDS</div>
          </div>
        ):(
          <div className="empty-state">
            <div className="empty-big">NO PROGRESSION YET</div>
            <div className="empty-sub">Pick a key and mood, then generate</div>
          </div>
        )}

        {history.length>0&&(
          <>
            <div className="divider"/>
            <div className="hist-label">Previous</div>
            {history.map(item=>(
              <div key={item.id} className="hist-item" onClick={()=>restore(item)}>
                <div className="hist-dot" style={{background:item.color}}/>
                <div className="hist-chords">{item.chords.join('  -  ')}</div>
                <div className="hist-meta">{item.label} &middot; {item.root}</div>
              </div>
            ))}
          </>
        )}
      </div>
    </>
  );
}
