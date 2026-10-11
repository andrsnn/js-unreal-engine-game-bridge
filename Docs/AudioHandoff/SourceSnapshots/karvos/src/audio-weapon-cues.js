/** Bolt/cartridge motion is separate from magazine reload completion. */
export function playWeaponCycle(audio,profile,position){
 if(profile.melee||profile.kind==='energy')return false;
 return audio.play('reloadLatch',{event:'weaponCycle',bus:'weapons',position,volume:(profile.kind==='shotgun'?.075:.055)*Math.min(1,profile.noise??1),delay:profile.kind==='shotgun'?.085:.045,variation:.065,cutoff:1800,maxDuration:.11,priority:35,tail:false});
}
