"""Run inside UE PythonScript commandlet; import/verify shared bridge audio.

Uses only the content-only tooling project. No native modules or game projects.
Manifest, receipts and PCM caches stay on G:. Existing foreign assets are never
overwritten: only assets tagged as this importer's output may be updated.
"""
import hashlib
import json
import math
import os
from pathlib import Path
import re
import subprocess
import traceback

import unreal

OWNER = 'JsGameBridge.AudioImporter.v1'
ROOT = Path(__file__).resolve().parent
ASSET_PATH = re.compile(r'^/JsGameBridge/Audio/[A-Za-z0-9_]+(?:/[A-Za-z0-9_]+)*$')
META = unreal.EditorAssetLibrary
TOOLS = unreal.AssetToolsHelpers.get_asset_tools()
MODE = os.environ.get('JSGAME_AUDIO_MODE', 'import')
REPORT = Path(os.environ.get('JSGAME_AUDIO_REPORT', str(ROOT/'reports/last-result.json')))
FFMPEG = os.environ.get('JSGAME_AUDIO_FFMPEG', r'C:\ProgramData\chocolatey\bin\ffmpeg.exe')
receipt = {'version': 1, 'mode': MODE, 'ok': False, 'importedWaves': [], 'createdCues': [], 'skippedWaves': [], 'skippedCues': [], 'verified': [], 'errors': []}

def digest(value):
    return hashlib.sha256(json.dumps(value, sort_keys=True, separators=(',', ':')).encode()).hexdigest()

def file_hash(path):
    h = hashlib.sha256()
    with path.open('rb') as stream:
        for block in iter(lambda: stream.read(1024*1024), b''): h.update(block)
    return h.hexdigest()

def safe_path(value):
    if not isinstance(value, str): raise ValueError('Asset path must be text')
    package,sep,obj=value.partition('.')
    if not ASSET_PATH.fullmatch(package) or (sep and obj!=package.rsplit('/',1)[1]): raise ValueError('Unsafe/non-audio asset path: '+str(value))
    return package

def load_if_exists(path):
    return META.load_asset(path) if META.does_asset_exist(path) else None

def get(asset, key): return asset.get_editor_property(key)
def setprop(asset, key, value): asset.set_editor_property(key, value)

def owned(asset):
    if asset and META.get_metadata_tag(asset, 'AudioImporterOwner') != OWNER:
        raise RuntimeError('Refusing to overwrite foreign asset '+asset.get_path_name())

def metadata(asset, content_hash, fields):
    META.set_metadata_tag(asset, 'AudioImporterOwner', OWNER)
    META.set_metadata_tag(asset, 'AudioImporterHash', content_hash)
    META.set_metadata_tag(asset, 'AudioImporterManifest', json.dumps(fields, sort_keys=True, ensure_ascii=False))

def save(asset):
    if not META.save_loaded_asset(asset, only_if_is_dirty=False): raise RuntimeError('Save failed '+asset.get_path_name())

def normalize(manifest):
    if manifest.get('version') != 1 or not isinstance(manifest.get('games'), dict): raise ValueError('Expected version:1 and games object')
    waves = {}; cues = []
    for game, group in manifest['games'].items():
        for key, cue in group.get('cues', {}).items():
            safe_path(cue['sound']); variants = cue['variants']
            if not variants or len(variants)>32: raise ValueError('UE Random supports 1..32 variants: '+str(key))
            if not isinstance(cue.get('loop'), bool) or not isinstance(cue.get('spatial'), bool): raise ValueError('Explicit bool loop/spatial required: '+str(key))
            max_dist=float(cue.get('maxDistance', 100000)); min_dist=float(cue.get('minDistance', max_dist*.1))
            if not math.isfinite(max_dist) or not math.isfinite(min_dist) or not 0<=min_dist<max_dist: raise ValueError('Invalid distance range '+str(key))
            for variant in variants:
                path=safe_path(variant['wave']); source=Path(variant['source'])
                if not source.is_absolute() or not source.is_file(): raise ValueError('Missing absolute source '+str(source))
                actual=file_hash(source)
                if actual != variant['sha256'].lower(): raise ValueError('Source SHA-256 mismatch '+str(source))
                previous=waves.get(path)
                if previous and previous['sha256']!=actual: raise ValueError('Conflicting sources for wave '+path)
                waves[path] = dict(variant, sha256=actual)
            if any(item[2]['sound']==cue['sound'] for item in cues): raise ValueError('Duplicate cue asset path '+cue['sound'])
            cues.append((game,key,cue))
    return waves,cues

def import_wave(path, variant):
    existing=load_if_exists(path)
    if existing:
        owned(existing)
        if not isinstance(existing, unreal.SoundWave): raise RuntimeError('Expected SoundWave '+path)
        if META.get_metadata_tag(existing,'AudioImporterHash')==variant['sha256']:
            receipt['skippedWaves'].append(path); return existing
    cache=ROOT/'pcm'/(variant['sha256']+'.wav')
    if not cache.exists():
        cache.parent.mkdir(parents=True,exist_ok=True)
        temporary=cache.with_name(cache.stem+'.pending.wav')
        subprocess.run([FFMPEG,'-y','-hide_banner','-loglevel','error','-i',variant['source'],'-ar','48000','-ac','2','-c:a','pcm_s16le',str(temporary)],check=True,timeout=90)
        temporary.replace(cache)
    folder,name=path.rsplit('/',1); task=unreal.AssetImportTask(); factory=unreal.SoundFactory()
    setprop(factory,'auto_create_cue',False)
    for key,value in {'filename':str(cache),'destination_path':folder,'destination_name':name,'automated':True,'replace_existing':True,'save':True,'factory':factory}.items(): setprop(task,key,value)
    TOOLS.import_asset_tasks([task]); wave=META.load_asset(path)
    if not isinstance(wave,unreal.SoundWave): raise RuntimeError('Wave import failed '+path)
    setprop(wave,'volume',1.0); setprop(wave,'pitch',1.0); setprop(wave,'looping',False)
    metadata(wave,variant['sha256'],variant); save(wave); receipt['importedWaves'].append(path)
    return wave

def players(cue):
    root=get(cue,'first_node')
    if isinstance(root,unreal.SoundNodeRandom): return root,list(get(root,'child_nodes'))
    if isinstance(root,unreal.SoundNodeWavePlayer): return root,[root]
    raise RuntimeError('Unexpected cue root '+str(root))

def configure(cue, spec):
    setprop(cue,'volume_multiplier',1.0); setprop(cue,'pitch_multiplier',1.0)
    setprop(cue,'exclude_from_random_node_branch_culling',True)
    root,nodes=players(cue)
    if isinstance(root,unreal.SoundNodeRandom):
        setprop(root,'randomize_without_replacement',True); setprop(root,'preselect_at_level_load',0)
        setprop(root,'should_exclude_from_branch_culling',True); setprop(root,'weights',[1.0]*len(nodes))
    for node in nodes:
        if not isinstance(node,unreal.SoundNodeWavePlayer): raise RuntimeError('Non-WavePlayer child')
        setprop(node,'looping',spec['loop'])
    setprop(cue,'override_attenuation',True)
    attenuation=unreal.SoundAttenuationSettings()
    setprop(attenuation,'attenuate',spec['spatial']); setprop(attenuation,'spatialize',spec['spatial'])
    setprop(attenuation,'attenuation_shape',unreal.AttenuationShape.SPHERE)
    maximum=float(spec.get('maxDistance',100000)); minimum=float(spec.get('minDistance',maximum*.1))
    setprop(attenuation,'attenuation_shape_extents',unreal.Vector(minimum,0,0)); setprop(attenuation,'falloff_distance',maximum-minimum)
    setprop(cue,'attenuation_overrides',attenuation)
    if spec['loop']: setprop(cue,'virtualization_mode',unreal.VirtualizationMode.PLAY_WHEN_SILENT)
    if spec.get('soundClass'):
        sound_class=META.load_asset(spec['soundClass'])
        if not isinstance(sound_class,unreal.SoundClass): raise RuntimeError('Missing supplied SoundClass '+spec['soundClass'])
        setprop(cue,'sound_class_object',sound_class)

def import_cue(game,key,spec,waves):
    path=safe_path(spec['sound']); fingerprint=digest(spec); cue=load_if_exists(path)
    if cue:
        owned(cue)
        if META.get_metadata_tag(cue,'AudioImporterHash')==fingerprint:
            receipt['skippedCues'].append(path); return
        # These packages are generated output only; recreate through the
        # official factory so the visual graph and runtime tree remain aligned.
        if not META.delete_asset(path): raise RuntimeError('Cannot replace generated cue '+path)
        cue=None
        unreal.SystemLibrary.collect_garbage()
        # UE's force-delete can leave the junction-backed package on disk in
        # an unattended commandlet. Only this verified-owned exact audio cue
        # is removed; no directory or foreign package is touched.
        package_file=ROOT.parents[1]/'Content'/Path(path.removeprefix('/JsGameBridge/')).with_suffix('.uasset')
        if package_file.exists(): package_file.unlink()
        unreal.AssetRegistryHelpers.get_asset_registry().scan_paths_synchronous(['/JsGameBridge/Audio'],force_rescan=True)
    folder,name=path.rsplit('/',1); factory=unreal.SoundCueFactoryNew()
    setprop(factory,'initial_sound_waves',[waves[safe_path(v['wave'])] for v in spec['variants']])
    setprop(factory,'edit_after_new',False)
    cue=TOOLS.create_asset(name,folder,unreal.SoundCue,factory)
    if not cue: raise RuntimeError('Cue factory failed '+path)
    configure(cue,spec); metadata(cue,fingerprint,dict(spec,game=game,eventKey=key)); save(cue)
    receipt['createdCues'].append(path)

def verify_cue(game,key,spec):
    cue=META.load_asset(spec['sound'])
    if not isinstance(cue,unreal.SoundCue): raise RuntimeError('Cue reload failed '+spec['sound'])
    owned(cue); root,nodes=players(cue)
    if len(nodes)!=len(spec['variants']): raise RuntimeError('Lost variant branch '+spec['sound'])
    if len(nodes)>1 and (not isinstance(root,unreal.SoundNodeRandom) or not get(root,'randomize_without_replacement')): raise RuntimeError('Missing random bag '+spec['sound'])
    actual=[]
    for node in nodes:
        if get(node,'looping')!=spec['loop']: raise RuntimeError('Loop mismatch '+spec['sound'])
        wave=get(node,'sound_wave_asset_ptr')
        # SoftObjectPath may wrap the property; string contains its package.
        value=wave.get_path_name() if isinstance(wave,unreal.Object) else str(wave)
        actual.append(value)
    for variant in spec['variants']:
        if not any(variant['wave'] in path for path in actual): raise RuntimeError('Missing saved wave reference '+variant['wave']+' actual '+str(actual))
        wave=META.load_asset(variant['wave'])
        if not isinstance(wave,unreal.SoundWave) or abs(get(wave,'sample_rate')-48000)>1: raise RuntimeError('Bad wave/sample rate '+variant['wave'])
        if META.get_metadata_tag(wave,'AudioImporterHash')!=variant['sha256']: raise RuntimeError('Wave metadata hash mismatch')
        owned(wave)
        if json.loads(META.get_metadata_tag(wave,'AudioImporterManifest'))!=variant: raise RuntimeError('Wave source metadata mismatch')
        if get(wave,'volume')!=1 or get(wave,'pitch')!=1 or get(wave,'looping'): raise RuntimeError('Non-unity wave gain/pitch or wave-level looping')
    if get(cue,'volume_multiplier')!=1 or get(cue,'pitch_multiplier')!=1: raise RuntimeError('Non-unity cue gain/pitch')
    settings=get(cue,'attenuation_overrides')
    if bool(get(settings,'spatialize'))!=spec['spatial'] or bool(get(settings,'attenuate'))!=spec['spatial']: raise RuntimeError('Spatial mismatch')
    if META.get_metadata_tag(cue,'AudioImporterHash')!=digest(spec): raise RuntimeError('Cue metadata hash mismatch')
    if json.loads(META.get_metadata_tag(cue,'AudioImporterManifest'))!=dict(spec,game=game,eventKey=key): raise RuntimeError('Cue licence/source metadata mismatch')
    minimum=float(spec.get('minDistance',float(spec.get('maxDistance',100000))*.1)); maximum=float(spec.get('maxDistance',100000))
    if not get(cue,'override_attenuation') or abs(get(settings,'attenuation_shape_extents').x-minimum)>.01 or abs(get(settings,'falloff_distance')-(maximum-minimum))>.01: raise RuntimeError('Attenuation range mismatch')
    if spec['loop'] and get(cue,'virtualization_mode')!=unreal.VirtualizationMode.PLAY_WHEN_SILENT: raise RuntimeError('Loop virtualization mismatch')
    if isinstance(root,unreal.SoundNodeRandom) and (get(root,'preselect_at_level_load')!=0 or any(weight!=1 for weight in get(root,'weights'))): raise RuntimeError('Random weight/preselection mismatch')
    package=safe_path(spec['sound']); dependencies=unreal.AssetRegistryHelpers.get_asset_registry().get_dependencies(package,unreal.AssetRegistryDependencyOptions(include_soft_package_references=True,include_hard_package_references=True)) or []
    dependency_paths=[str(p) for p in dependencies]
    for variant in spec['variants']:
        if safe_path(variant['wave']) not in dependency_paths: raise RuntimeError('Missing cook package dependency '+variant['wave']+' in '+str(dependency_paths))
    receipt['verified'].append({'game':game,'key':key,'sound':spec['sound'],'package':package,'variants':len(nodes),'loop':spec['loop'],'spatial':spec['spatial'],'references':actual,'packageDependencies':dependency_paths})

try:
    if MODE not in ['import','verify']: raise ValueError('Mode must be import or verify')
    manifest_path=Path(os.environ['JSGAME_AUDIO_MANIFEST']); manifest=json.loads(manifest_path.read_text(encoding='utf-8-sig'))
    receipt['manifest']=str(manifest_path); receipt['manifestSha256']=file_hash(manifest_path)
    wave_specs,cues=normalize(manifest)
    registry=unreal.AssetRegistryHelpers.get_asset_registry()
    registry.scan_paths_synchronous(['/JsGameBridge/Audio'],force_rescan=True)
    if MODE=='import':
        waves={path:import_wave(path,spec) for path,spec in wave_specs.items()}
        for game,key,spec in cues: import_cue(game,key,spec,waves)
        registry.scan_paths_synchronous(['/JsGameBridge/Audio'],force_rescan=True)
    for game,key,spec in cues: verify_cue(game,key,spec)
    receipt['ok']=True
    unreal.log('JSGAME_AUDIO_RESULT '+json.dumps({'ok':True,'wavesImported':len(receipt['importedWaves']),'cuesCreated':len(receipt['createdCues']),'verified':len(receipt['verified'])}))
except Exception:
    receipt['errors'].append(traceback.format_exc()); unreal.log_error(receipt['errors'][-1])
finally:
    REPORT.parent.mkdir(parents=True,exist_ok=True); REPORT.write_text(json.dumps(receipt,indent=2,ensure_ascii=False)+'\n',encoding='utf-8')
if not receipt['ok']: raise RuntimeError('Audio import/verification failed; see '+str(REPORT))
