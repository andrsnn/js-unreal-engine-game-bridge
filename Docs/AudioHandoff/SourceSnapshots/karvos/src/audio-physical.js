// Source calibration follows the actual v4 ride capture (−25.4 LUFS before adjustment).
export const PHYSICAL_CALIBRATION=Object.freeze({engineBus:.72,ambienceBus:.42,foleyBus:.46,makeup:1.35,outputGain:.72,threshold:-12,knee:8,ratio:3.5,attack:.012,release:.22});
export function physicalDriveLevels(speed){
 const fraction=Math.max(0,Math.min(1,Number(speed)||0));
 return {engine:Math.min(1,.58+fraction*.50),turbine:.18+fraction*.34};
}

/** Physical reports retain attack detail while removing synthetic top-end fizz. */
export function combatCutoff(key,bus){
 return {rifle:4800,heavy:3300,pistol:6200,shotgun:3900,energy:4200,rocket:1800,explosion:1500,impactMetal:3500,impactRock:2800,thunder:1400}[key]??(bus==='reflections'?2400:17000);
}

/** Transparent quiet passages, then a smooth symmetric ceiling. */
export function physicalOutputCurve(){
 const curve=new Float32Array(4096);
 for(let i=0;i<curve.length;i++){const x=i/(curve.length-1)*2-1,a=Math.abs(x);curve[i]=Math.sign(x)*(a<=.70?a:.70+.12*Math.tanh((a-.70)/.12));}
 return curve;
}

export function creatureReactionKey(family,kind){
 const suffix=kind==='warning'||kind==='charge'?'Threat':kind==='attack'?'Attack':kind==='hit'?'Pain':kind==='death'?'Fall':'';
 return family+suffix;
}
