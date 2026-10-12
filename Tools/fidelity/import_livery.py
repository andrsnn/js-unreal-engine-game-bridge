"""Imports the livery textures Tools/fidelity/bake-livery.mjs painted (one PNG per override hull) as
T_<name>_Livery beside each hull's original colour texture, and points the hull's material instance at it.
The original T_<name>_BaseColor stays, so the paint can be switched off by pointing BaseColorMap back at it.
Jobs: JSGB_LIVERY_JOBS, a JSON file {root, report, hulls: [{name, png}]}."""
import json, os, traceback
import unreal

jobs = json.load(open(os.environ['JSGB_LIVERY_JOBS'], encoding='utf-8'))
eal, mel = unreal.EditorAssetLibrary, unreal.MaterialEditingLibrary
report = {'done': [], 'failed': {}}
for h in jobs['hulls']:
    name, dest = h['name'], jobs['root'] + '/' + h['name']
    try:
        mi_path = dest + '/MI_' + name
        if not eal.does_asset_exist(mi_path):
            raise RuntimeError('no material instance ' + mi_path)
        base_path = dest + '/T_' + name + '_BaseColor'
        base = eal.load_asset(base_path) if eal.does_asset_exist(base_path) else None
        task = unreal.AssetImportTask()
        for k, v in dict(filename=h['png'], destination_path=dest, destination_name='T_' + name + '_Livery', automated=True, replace_existing=True, save=False).items():
            task.set_editor_property(k, v)
        unreal.AssetToolsHelpers.get_asset_tools().import_asset_tasks([task])
        tex = eal.load_asset(dest + '/T_' + name + '_Livery')
        if not isinstance(tex, unreal.Texture2D):
            raise RuntimeError('the import made no texture')
        tex.set_editor_property('srgb', True)
        # The same size limit as the original colour texture.
        if base:
            tex.set_editor_property('max_texture_size', base.get_editor_property('max_texture_size'))
        eal.save_loaded_asset(tex)
        mi = eal.load_asset(mi_path)
        mel.set_material_instance_texture_parameter_value(mi, 'BaseColorMap', tex)
        mel.update_material_instance(mi)
        eal.save_loaded_asset(mi)
        report['done'].append(name)
        unreal.log('JSGB livery ' + name)
    except Exception:
        report['failed'][name] = traceback.format_exc()[-600:]
    with open(jobs['report'], 'w', encoding='utf-8') as f:
        json.dump(report, f, indent=1)
