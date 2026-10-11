from pathlib import Path
import hashlib,json,sys
root=Path('/mnt/g/JsGameBridge');name=sys.argv[1];assert name.startswith('audio-cues-v') and name.endswith('.json')
p=root/'Registry'/name;data=p.read_bytes();manifest=json.loads(data);sha=hashlib.sha256(data).hexdigest();reports=root/'Tools/AudioImporter/reports';base=p.stem
imports=json.loads((reports/(base+'-import.json')).read_text());verify=json.loads((reports/(base+'-verify.json')).read_text())
for receipt in (imports,verify):assert receipt['ok'] and not receipt['errors'] and receipt['manifestSha256']==sha
previousVersion=6 if name=='audio-cues-v7.json' else 5
previous=json.loads((root/f'Registry/audio-cues-v{previousVersion}.json').read_text())
for game,entry in previous['games'].items():
 current=manifest['games'][game];assert set(entry['cues'])<=set(current['cues']) and set(entry['aliases'])<=set(current['aliases'])
 for key,cue in entry['cues'].items():assert current['cues'][key]['sound']==cue['sound'],(game,key,'existing cue path changed')
verified={(v['game'],v['key']):v for v in verify['verified']};games={};waves=set();refs=loops=spatial=0
for game,entry in manifest['games'].items():
 registry=json.loads((root/'Registry'/(game+'-sounds.json')).read_text());runtime=json.loads((root/'JavaScript'/(game+'-assets.json')).read_text());assets=registry['assets']
 for key,spec in assets.items():assert runtime['assets'][key]['sound']==spec['sound'],(game,key)
 for key,cue in entry['cues'].items():
  v=verified.pop((game,key));assert v['sound']==cue['sound'] and v['variants']==len(cue['variants']);assert set(v['references'])==set(w['wave'] for w in cue['variants'])
  waves.update(w['wave'] for w in cue['variants']);refs+=len(cue['variants']);loops+=cue['loop'];spatial+=cue['spatial']
  package=root/'Content'/Path(cue['sound'].split('.')[0].removeprefix('/JsGameBridge/')).with_suffix('.uasset');assert package.is_file()
 games[game]={'audioPass':entry['audioPass'],'canonicalCues':len(entry['cues']),'aliases':len(entry['aliases']),'registeredKeys':len(assets),'sourceCommit':entry.get('sourceCommit'),'registryKeysVerified':len(assets),'runtimeRegistry':'JavaScript/'+game+'-assets.json','mixerMetadataAvailable':bool(registry.get('mix'))}
assert not verified
out={'version':1,'ok':True,'engine':'Unreal 5.8.2','manifest':'Registry/'+name,'manifestSha256':sha,'games':games,'freshProcessVerified':True,'waveAssetsInManifest':len(waves),'cueAssets':sum(v['canonicalCues'] for v in games.values()),'variantReferences':refs,'loops':loops,'spatialCues':spatial,'incrementalImportedWaves':len(imports['importedWaves']),'incrementalCreatedCues':len(imports['createdCues']),'nativeGameplayExecuted':False,'gameCookOrPackageExecuted':False,'previousAssetPathsDeleted':False}
(reports/(base+'-acceptance.json')).write_text(json.dumps(out,indent=2)+'\n');print(json.dumps(out,indent=2))
