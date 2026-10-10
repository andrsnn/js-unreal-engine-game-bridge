import fs from 'node:fs';import crypto from 'node:crypto';import path from 'node:path';import {fileURLToPath} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const profiles=JSON.parse(fs.readFileSync(path.join(root,'Tools/hardburn-vfx/profiles.json'),'utf8')).profiles;
const assets={};
for(const [key,p]of Object.entries(profiles)){
 const name='NS_'+key.replaceAll('.','_')+'_r4',file=path.join(root,'Content/HardBurn/VFX/Systems',name+'.uasset');
 if(!fs.existsSync(file)||fs.statSync(file).size<1000)throw Error('Missing saved Niagara system '+key);
 assets[key]={niagara:`/JsGameBridge/HardBurn/VFX/Systems/${name}.${name}`,vfxProfile:p,finiteLifeSeconds:p.life+(['weapon','plume','venting'].includes(p.category)?.05:.13)};
}
const registry={version:1,assets};fs.mkdirSync(path.join(root,'Registries'),{recursive:true});fs.writeFileSync(path.join(root,'Registries/hardburn-vfx.json'),JSON.stringify(registry,null,2)+'\n');
const retired=['weapon.laser','weapon.plasma','impact.laser','impact.plasma'];
const main=path.join(root,'JavaScript/hardburn-assets.json'),before=fs.readFileSync(main),combined=JSON.parse(before);for(const [key,value]of Object.entries(assets)){if(combined.assets[key]?.mesh&&!combined.assets[key]?.niagara)throw Error('Conflicting existing mesh '+key);if(combined.assets[key]?.niagara&&!combined.assets[key].niagara.startsWith('/JsGameBridge/HardBurn/VFX/'))throw Error('Conflicting existing Niagara '+key);combined.assets[key]={...combined.assets[key],...value};}
for(const key of retired){const entry=combined.assets[key];if(entry?.niagara?.startsWith('/JsGameBridge/HardBurn/VFX/')){delete entry.niagara;delete entry.vfxProfile;delete entry.finiteLifeSeconds;if(!Object.keys(entry).length)delete combined.assets[key];}}
const sha=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');if(sha(fs.readFileSync(main))!==sha(before))throw Error('Registry changed while merging; retry');
fs.writeFileSync(main+'.hb-vfx-tmp',JSON.stringify(combined,null,2)+'\n');fs.renameSync(main+'.hb-vfx-tmp',main);console.log(`Registered ${Object.keys(assets).length} saved Niagara systems; retained ${Object.keys(combined.assets).length-Object.keys(assets).length} existing entries`);
