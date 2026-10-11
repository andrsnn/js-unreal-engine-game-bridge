import type {VoiceKind} from './soundBank';
export const REACTION_VOICE_COUNTS:Partial<Record<VoiceKind,number>>={humanHurt:3,humanDeath:3};

/** Edited Stable Audio 3 Medium assets; variants are independent generated takes. */
export const GENERATED_VOICE_COUNTS:Partial<Record<VoiceKind,number>>={
 rifle:2,smg:2,lmg:2,pistol:2,shotgun:2,sniper:2,rotary:2,
 suppressed:1,bow:1,pulse:2,arc:1,plasma:2,rail:2,defense:1,missile:3,
 armor:2,shield:1,body:2,stone:1,eject:1,insert:1,bolt:1,cell:1,nock:1,
 chest:1,read:1,pickup:1,level:1,explosion:1,enemyHurt:2,enemyDeath:1,bossDeath:1,
 creatureIdle:1,creatureAlert:1,creatureCombat:1,creatureAttack:1,sentinelCall:1,charge:1,kick:1,dialogue:1,
 step:6,stepSand:6,stepStone:6,stepSnow:6,swim:2,swing:2,dive:1,worm:1,spit:1,arrival:1,refit:1,
};
export const GENERATED_AUDIO_REVISION='ace-b-production-20260911';
/** Real firearm reports and mechanical Foley; baked offline to one mono voice per shot. */
export const PHYSICAL_AUDIO_REVISION='physical-v1';
export const PHYSICAL_VOICE_COUNTS:Partial<Record<VoiceKind,number>>={
 rifle:4,smg:4,lmg:4,pistol:4,shotgun:4,sniper:4,suppressed:4,
 pulse:4,rotary:4,defense:4,rail:4,plasma:4,arc:4,missile:4,explosion:4,armor:4,
 eject:1,insert:1,bolt:1,
};
export const PHYSICAL_AUDIO=new Set(Object.entries(PHYSICAL_VOICE_COUNTS).flatMap(([kind,count])=>Array.from({length:count!},(_,i)=>`${kind}-${i}`)));
export const PRODUCTION_AUDIO=new Set([...Object.entries(GENERATED_VOICE_COUNTS).flatMap(([kind,count])=>Array.from({length:count!},(_,i)=>`${kind}-${i}`)),'engine-rebuilt','engine-azure','engine-vulcan','engine-boost','beam-loop','charge-loop']);
export const CONTEXT_VOICES=new Set(['rifle','smg','lmg','pistol','shotgun','sniper','pulse','rotary','plasma','rail']);

export const REFINED_VOICES=new Set(['step','stepSand','stepStone','stepSnow','pulse','rotary','plasma','rail','missile']);

/** Layered CC0 field Foley, four edited variations from recorded sources per frequent event. */
export const FIELD_AUDIO_REVISION='field-v2';
export const FIELD_VOICE_COUNTS:Partial<Record<VoiceKind,number>>=Object.fromEntries([
 'uiTick','uiConfirm','uiPurchase','uiReveal','uiCapture','lampClick','pickup','read','chest','refit',
 'body','fleshImpact','fleshDeath','stone','metalImpact','metalDeath','shield','landThud',
 'stepDeck','stepStone','stepSnow','step','gunMechanism','eject','insert','bolt','shellRack',
 'gunCrack','gunTail','kick','launchThump','missileCrump','deathCrash','bossDeath','chargeRumble',
 'warnNest','warnFoundry','warnSettlement','contactHorn','missileAlert','provokeAlarm','objectiveDone','level',
].map(kind=>[kind,4]));
export const FIELD_AUDIO=new Set([...Object.entries(FIELD_VOICE_COUNTS).flatMap(([kind,count])=>Array.from({length:count!},(_,i)=>`${kind}-${i}`)),...['rebuilt','azure','vulcan','boost'].map(id=>`engine-${id}`)]);
