// Stable native event/bank names; performance variation never changes game rules.
export const COMBAT_BANKS = {
 'hb-rail':'rail', 'hb-mac':'mac', 'hb-pdc':'pdc', 'pdc-mechanism':'pdc', 'hb-flak':'flak',
 'energy-laser':'laser', 'energy-plasma':'plasma', 'hb-impact':'impact',
 'hb-armour':'armour', 'hb-breach':'breach', 'hb-intercept':'intercept',
 'hb-launch':'torpedo-launch', 'hb-missile-launch':'missile-launch',
 'torpedo-burn':'torpedo-burn', 'missile-burn':'missile-burn',
 'hb-small-blast':'small-blast', 'hb-large-blast':'ship-blast',
 'hb-reactor-blast':'reactor-blast', 'hb-vent':'vent',
 'rail-tail':'rail-tail', 'impact-tail':'impact-tail',
};
export const COMBAT_VARIANTS = 8;
export const GUIDED_BANKS = {
 'hb-swarm-cold':'swarm-cold', 'hb-swarm-ignition':'swarm-ignition',
 'hb-missile-cold':'missile-cold', 'hb-missile-ignition':'missile-ignition',
 'hb-torpedo-cold':'torpedo-cold', 'hb-torpedo-ignition':'torpedo-ignition',
 'swarm-burn':'swarm-burn',
};
const clamp = (value, lo, hi) => Math.min(hi, Math.max(lo, value));
export function combatVariation(size = 30, random = Math.random) {
 const scale = clamp(Number(size) || 30, 4, 500);
 return {
  pitch: .96 + random() * .08,
  gain: .92 + random() * .16,
  filter: .88 + random() * .12,
  offset: random() * .004,
  sizeGain: clamp(1 + Math.log2(scale / 30) * .045, .88, 1.15),
  sizePitch: clamp((30 / scale) ** .022, .94, 1.045),
  sizeFilter: clamp((30 / scale) ** .035, .90, 1.04),
 };
}
export function blastEvent(kind, size = 3) {
 if (kind === 'reactor' || kind === 'nuclear') return 'explosion-reactor';
 if (['capital','structure','magazine','fuel'].includes(kind) || size > 7) return 'explosion-large';
 return size < 2 || ['fighter','missile','flak'].includes(kind) ? 'explosion-small' : 'explosion';
}
export function guidedBank(weapon) {
 return weapon === 'swarm' ? 'swarm-burn' : weapon === 'missile' ? 'missile-burn' : 'torpedo-burn';
}
export function guidedType(weapon) {
 return weapon === 'swarm' ? 'swarm' : weapon === 'missile' ? 'missile' : 'torpedo';
}
