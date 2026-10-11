# Imports prepared glTF models into the host project as Nanite static meshes with PBR materials.
# Runs inside the Unreal editor (commandlet):
#   UnrealEditor-Cmd.exe <project> -run=pythonscript -script="Tools/fidelity/import_assets.py" -unattended
# JSGB_FIDELITY_JOBS names a JSON file: {"root": "/Game/Fidelity/HardBurn", "studio": "<studio.hdr>",
#   "rebuildMaster": false, "materialsOnly": false, "assets": [<prepare-glb.mjs output>, ...]}.
# Writes <jobs>.result.json with each asset's mesh path, material path and imported bounds (Unreal units).
import json
import os
import unreal

JOBS = os.environ['JSGB_FIDELITY_JOBS']
jobs = json.load(open(JOBS, encoding='utf-8'))
root = jobs.get('root', '/Game/Fidelity')
materials_only = jobs.get('materialsOnly', False)
tools = unreal.AssetToolsHelpers.get_asset_tools()
mel = unreal.MaterialEditingLibrary
eal = unreal.EditorAssetLibrary
log = lambda *a: unreal.log('JSGB-FIDELITY ' + ' '.join(str(x) for x in a))


def import_file(path, dest, name):
    task = unreal.AssetImportTask()
    task.filename = path
    task.destination_path = dest
    task.destination_name = name
    task.automated = True
    task.replace_existing = True
    task.save = False
    tools.import_asset_tasks([task])
    return [eal.load_asset(p) for p in task.imported_object_paths]


def studio_cube():
    """The studio environment for reflections (Tools/fidelity/studio_env.py), as a cube texture."""
    path = root + '/T_JsgbStudio'
    if eal.does_asset_exist(path) and not jobs.get('rebuildMaster'):
        return eal.load_asset(path)
    cube = [t for t in import_file(jobs['studio'], root, 'T_JsgbStudio') if isinstance(t, unreal.TextureCube)][0]
    eal.save_loaded_asset(cube)
    return cube


def master_material(default_base, default_mr):
    """M_JsgbFidelityPBR: glTF metal/roughness PBR lit by Unreal's lights, plus what three.js adds and Unreal has
    no light for: the scene's ambient and hemisphere light (Ambient, set by the host each frame) and a studio
    environment map (StudioCube x EnvIntensity), as Hard Burn's hulls use. Pale paint (PaintedHull) reads as a
    rough dielectric, as in the game's hull shader. GlowColor lights base colour brighter than GlowThreshold."""
    path = root + '/M_JsgbFidelityPBR'
    if eal.does_asset_exist(path) and not jobs.get('rebuildMaster'):
        return eal.load_asset(path)
    cube = studio_cube()
    if eal.does_asset_exist(path):
        eal.delete_asset(path)
    m = tools.create_asset('M_JsgbFidelityPBR', root, unreal.Material, unreal.MaterialFactoryNew())
    row = [0]

    def E(cls, x=-600):
        row[0] += 70
        return mel.create_material_expression(m, cls, x, row[0])

    def C(a, b, pin_a='', pin_b=''):
        if not mel.connect_material_expressions(a, pin_a, b, pin_b):
            raise RuntimeError(f'cannot connect {a.get_name()}.{pin_a} -> {b.get_name()}.{pin_b}')

    def scalar(name, value):
        e = E(unreal.MaterialExpressionScalarParameter, -1400)
        e.set_editor_property('parameter_name', name)
        e.set_editor_property('default_value', value)
        return e

    def vector(name, value):
        e = E(unreal.MaterialExpressionVectorParameter, -1400)
        e.set_editor_property('parameter_name', name)
        e.set_editor_property('default_value', unreal.LinearColor(*value))
        return e

    def const(v):
        e = E(unreal.MaterialExpressionConstant, -1200)
        e.set_editor_property('r', v)
        return e

    def op(cls, a, b, pa='', pb=''):
        e = E(cls)
        C(a, e, pa, 'A')
        C(b, e, pb, 'B')
        return e

    def lerp(a, b, alpha):
        e = E(unreal.MaterialExpressionLinearInterpolate)
        C(a, e, '', 'A'); C(b, e, '', 'B'); C(alpha, e, '', 'Alpha')
        return e

    def saturate(a):
        e = E(unreal.MaterialExpressionSaturate)
        C(a, e)
        return e

    mul, add, sub, div = unreal.MaterialExpressionMultiply, unreal.MaterialExpressionAdd, unreal.MaterialExpressionSubtract, unreal.MaterialExpressionDivide

    base = E(unreal.MaterialExpressionTextureSampleParameter2D, -1400)
    base.set_editor_property('parameter_name', 'BaseColorMap')
    base.set_editor_property('sampler_type', unreal.MaterialSamplerType.SAMPLERTYPE_COLOR)
    # A texture parameter needs a default texture of the right kind, or the material doesn't compile.
    base.set_editor_property('texture', default_base)
    mr = E(unreal.MaterialExpressionTextureSampleParameter2D, -1400)
    mr.set_editor_property('parameter_name', 'MetalRoughMap')
    mr.set_editor_property('sampler_type', unreal.MaterialSamplerType.SAMPLERTYPE_MASKS)
    mr.set_editor_property('texture', default_mr)
    source = op(mul, base, vector('Tint', (1, 1, 1, 1)), 'RGB', 'RGB')
    weights = E(unreal.MaterialExpressionConstant3Vector, -1200)
    weights.set_editor_property('constant', unreal.LinearColor(0.2126, 0.7152, 0.0722, 1))
    lum = op(unreal.MaterialExpressionDotProduct, base, weights, 'RGB', '')
    # Hard Burn's hull livery (scene/hull-livery.js): faction paint replaces the generator's colours, and the source
    # texture stays as panel relief (its luminance against a blurred copy keeps narrow seams, not broad stains).
    blurred = E(unreal.MaterialExpressionTextureSampleParameter2D, -1400)
    blurred.set_editor_property('parameter_name', 'BaseColorMap')
    blurred.set_editor_property('texture', default_base)
    blurred.set_editor_property('mip_value_mode', unreal.TextureMipValueMode.TMVM_MIP_BIAS)
    if not any(mel.connect_material_expressions(const(2.0), '', blurred, pin) for pin in ('Mip Bias', 'MipBias', 'MipValue', 'Mip Value', 'Bias')):
        raise RuntimeError('no mip input on the blurred sample')
    blur_lum = op(unreal.MaterialExpressionDotProduct, blurred, weights, 'RGB', '')
    relief = E(unreal.MaterialExpressionClamp, -500)
    C(op(div, op(add, lum, const(0.005)), op(add, blur_lum, const(0.005))), relief, '', '')
    relief.set_editor_property('min_default', 0.5); relief.set_editor_property('max_default', 1.02)
    shading = op(mul, const(0.94), lerp(const(1.0), relief, const(0.65)))
    livery = scalar('LiveryWeight', 0.0)
    paint = op(mul, vector('LiveryPaint', (0.34, 0.43, 0.46, 1)), shading, 'RGB', '')
    color = lerp(source, paint, op(mul, livery, const(0.85)))
    mel.connect_material_property(color, '', unreal.MaterialProperty.MP_BASE_COLOR)
    # Painted hull: smoothstep(0.32, 0.62, luminance) raises roughness to 0.64 and caps metalness at 0.18.
    t = saturate(op(div, op(sub, lum, const(0.32)), const(0.30)))
    smooth = op(mul, op(mul, t, t), op(sub, const(3.0), op(mul, t, const(2.0))))
    painted = op(mul, smooth, scalar('PaintedHull', 1.0))
    rough0 = op(unreal.MaterialExpressionMax, op(mul, mr, scalar('RoughnessScale', 1.0), 'G', ''), op(mul, painted, const(0.64)))
    rough_clamped = E(unreal.MaterialExpressionClamp, -500)
    C(rough0, rough_clamped, '', '')
    rough_clamped.set_editor_property('min_default', 0.68); rough_clamped.set_editor_property('max_default', 0.90)
    rough = lerp(rough0, rough_clamped, livery)
    mel.connect_material_property(rough, '', unreal.MaterialProperty.MP_ROUGHNESS)
    metal0 = op(mul, mr, scalar('MetalScale', 1.0), 'B', '')
    metal1 = lerp(metal0, op(unreal.MaterialExpressionMin, metal0, const(0.18)), painted)
    metal = lerp(metal1, op(unreal.MaterialExpressionMin, metal1, const(0.20)), livery)
    mel.connect_material_property(metal, '', unreal.MaterialProperty.MP_METALLIC)

    # Studio environment: specular along the reflection (blurrier when rough), diffuse along the normal.
    def cube_sample(direction, mip):
        e = E(unreal.MaterialExpressionTextureSampleParameterCube, -900)
        e.set_editor_property('parameter_name', 'StudioCube')
        e.set_editor_property('texture', cube)
        e.set_editor_property('mip_value_mode', unreal.TextureMipValueMode.TMVM_MIP_LEVEL)
        C(direction, e, '', 'UVs')
        # The mip input's pin name depends on the engine version.
        if not any(mel.connect_material_expressions(mip, '', e, pin) for pin in ('Mip Level', 'MipLevel', 'MipValue', 'Mip Value', 'Level')):
            raise RuntimeError('no mip input on the cube sample')
        return e

    spec_s = cube_sample(E(unreal.MaterialExpressionReflectionVectorWS, -1400), op(mul, rough, const(8.0)))
    diff_s = cube_sample(E(unreal.MaterialExpressionPixelNormalWS, -1400), const(9.0))
    f0 = lerp(const(0.04), color, metal)
    gloss = op(sub, const(1.0), op(mul, rough, const(0.6)))
    spec = op(mul, op(mul, spec_s, f0, 'RGB', ''), gloss)
    diff = op(mul, op(mul, diff_s, color, 'RGB', ''), op(sub, const(1.0), metal))
    env = op(mul, op(add, spec, diff), scalar('EnvIntensity', 0.18))
    amb = op(mul, color, vector('Ambient', (0, 0, 0, 0)), '', 'RGB')
    glow = op(mul, saturate(op(sub, lum, scalar('GlowThreshold', 2.0))), vector('GlowColor', (0, 0, 0, 0)), '', 'RGB')
    em = op(add, op(add, amb, env), glow)
    mel.connect_material_property(em, '', unreal.MaterialProperty.MP_EMISSIVE_COLOR)
    m.set_editor_property('used_with_nanite', True)
    m.set_editor_property('used_with_instanced_static_meshes', True)
    mel.recompile_material(m)
    eal.save_loaded_asset(m)
    return m


def planet_material(default_base, default_normal):
    """M_JsgbFidelityPlanet: a planet's colour map (Tint) with an optional normal map, a rough surface lit by Unreal's
    sun, the scene's ambient light (Ambient, from the host) and a faint night-side fill (NightFill), as the game's
    planet shader keeps the dark side readable."""
    path = root + '/M_JsgbFidelityPlanet'
    if eal.does_asset_exist(path) and (not jobs.get('rebuildMaster') or path in built):
        return eal.load_asset(path)
    built.add(path)
    if eal.does_asset_exist(path):
        eal.delete_asset(path)
    m = tools.create_asset('M_JsgbFidelityPlanet', root, unreal.Material, unreal.MaterialFactoryNew())
    E = lambda cls, x, y: mel.create_material_expression(m, cls, x, y)
    base = E(unreal.MaterialExpressionTextureSampleParameter2D, -900, -300)
    base.set_editor_property('parameter_name', 'BaseColorMap')
    base.set_editor_property('texture', default_base)
    nrm = E(unreal.MaterialExpressionTextureSampleParameter2D, -900, 100)
    nrm.set_editor_property('parameter_name', 'NormalMap')
    nrm.set_editor_property('sampler_type', unreal.MaterialSamplerType.SAMPLERTYPE_NORMAL)
    nrm.set_editor_property('texture', default_normal)
    tint = E(unreal.MaterialExpressionVectorParameter, -900, -500)
    tint.set_editor_property('parameter_name', 'Tint')
    tint.set_editor_property('default_value', unreal.LinearColor(1, 1, 1, 1))
    color = E(unreal.MaterialExpressionMultiply, -600, -350)
    mel.connect_material_expressions(base, 'RGB', color, 'A')
    mel.connect_material_expressions(tint, 'RGB', color, 'B')
    mel.connect_material_property(color, '', unreal.MaterialProperty.MP_BASE_COLOR)
    mel.connect_material_property(nrm, 'RGB', unreal.MaterialProperty.MP_NORMAL)

    def scalar(name, value, y):
        e = E(unreal.MaterialExpressionScalarParameter, -600, y)
        e.set_editor_property('parameter_name', name)
        e.set_editor_property('default_value', value)
        return e

    mel.connect_material_property(scalar('Roughness', 0.92, 300), '', unreal.MaterialProperty.MP_ROUGHNESS)
    mel.connect_material_property(scalar('Specular', 0.25, 400), '', unreal.MaterialProperty.MP_SPECULAR)
    amb = E(unreal.MaterialExpressionVectorParameter, -900, -700)
    amb.set_editor_property('parameter_name', 'Ambient')
    amb.set_editor_property('default_value', unreal.LinearColor(0, 0, 0, 0))
    fill = E(unreal.MaterialExpressionAdd, -450, -650)
    mel.connect_material_expressions(amb, 'RGB', fill, 'A')
    mel.connect_material_expressions(scalar('NightFill', 0.0, -800), '', fill, 'B')
    em = E(unreal.MaterialExpressionMultiply, -250, -500)
    mel.connect_material_expressions(color, '', em, 'A')
    mel.connect_material_expressions(fill, '', em, 'B')
    mel.connect_material_property(em, '', unreal.MaterialProperty.MP_EMISSIVE_COLOR)
    m.set_editor_property('used_with_nanite', True)
    m.set_editor_property('used_with_instanced_static_meshes', True)
    mel.recompile_material(m)
    eal.save_loaded_asset(m)
    return m


def import_planet(a):
    name, dest = a['name'], root + '/' + a['name']
    tx = a.get('textures', {})
    mi_path = dest + '/MI_' + name
    mi = eal.load_asset(mi_path) if eal.does_asset_exist(mi_path) else tools.create_asset('MI_' + name, dest, unreal.MaterialInstanceConstant, unreal.MaterialInstanceConstantFactoryNew())
    base = texture(tx['baseColor']['file'], dest, 'T_' + name + '_BaseColor', True)
    normal = texture(tx['normal']['file'], dest, 'T_' + name + '_Normal', False, normal=True)
    mi.set_editor_property('parent', planet_material(base, normal))
    mel.set_material_instance_texture_parameter_value(mi, 'BaseColorMap', base)
    mel.set_material_instance_texture_parameter_value(mi, 'NormalMap', normal)
    mel.update_material_instance(mi)
    eal.save_loaded_asset(mi)
    return {'name': name, 'material': mi.get_path_name()}


def import_mesh_only(a):
    name, dest = a['name'], root + '/' + a['name']
    mesh = find_mesh(dest, name) if materials_only else None
    if not mesh:
        mesh = [o for o in import_file(a['glb'], dest, 'SM_' + name) if isinstance(o, unreal.StaticMesh)][0]
        nanite = mesh.get_editor_property('nanite_settings')
        nanite.set_editor_property('enabled', True)
        mesh.set_editor_property('nanite_settings', nanite)
        eal.save_loaded_asset(mesh)
    for p in eal.list_assets(dest, recursive=True):
        obj = eal.load_asset(p)
        if obj is not mesh and isinstance(obj, (unreal.MaterialInterface, unreal.Texture)):
            eal.delete_asset(p)
    box = mesh.get_bounding_box()
    return {'name': name, 'mesh': mesh.get_path_name(), 'unrealBounds': [[box.min.x, box.min.y, box.min.z], [box.max.x, box.max.y, box.max.z]]}


def texture(file, dest, name, srgb, normal=False):
    path = dest + '/' + name
    if materials_only and eal.does_asset_exist(path):
        return eal.load_asset(path)
    tex = import_file(file, dest, name)
    tex = [t for t in tex if isinstance(t, unreal.Texture2D)][0]
    tex.set_editor_property('srgb', srgb)
    if normal:
        tex.set_editor_property('compression_settings', unreal.TextureCompressionSettings.TC_NORMALMAP)
    elif not srgb:
        tex.set_editor_property('compression_settings', unreal.TextureCompressionSettings.TC_MASKS)
    tex.set_editor_property('max_texture_size', jobs.get('maxTexture', 0))
    eal.save_loaded_asset(tex)
    return tex


def find_mesh(dest, name):
    for p in eal.list_assets(dest, recursive=True):
        obj = eal.load_asset(p)
        if isinstance(obj, unreal.StaticMesh) and obj.get_name() == 'SM_' + name:
            return obj
    return None


results = []
master = None
built = set()
for a in jobs['assets']:
    name, dest = a['name'], root + '/' + a['name']
    if a.get('kind') == 'planet':
        results.append(import_planet(a)); log('done', name, results[-1]); continue
    if a.get('kind') == 'mesh':
        results.append(import_mesh_only(a)); log('done', name, results[-1]); continue
    tx = a.get('textures', {})
    base_tex = texture(tx['baseColor']['file'], dest, 'T_' + name + '_BaseColor', True) if 'baseColor' in tx else None
    mr_tex = texture(tx['metallicRoughness']['file'], dest, 'T_' + name + '_MetalRough', False) if 'metallicRoughness' in tx else None
    if master is None:
        if not (base_tex and mr_tex):
            results.append({'name': name, 'error': 'the first asset needs both PBR textures'})
            continue
        master = master_material(base_tex, mr_tex)
    log('importing', name)
    mesh = find_mesh(dest, name) if materials_only else None
    if not mesh:
        imported = import_file(a['glb'], dest, 'SM_' + name)
        meshes = [o for o in imported if isinstance(o, unreal.StaticMesh)]
        if not meshes:
            log('no static mesh from', a['glb'], [str(o) for o in imported])
            results.append({'name': name, 'error': 'no static mesh'})
            continue
        mesh = meshes[0]
        nanite = mesh.get_editor_property('nanite_settings')
        nanite.set_editor_property('enabled', True)
        mesh.set_editor_property('nanite_settings', nanite)
    mi_path = dest + '/MI_' + name
    mi = eal.load_asset(mi_path) if eal.does_asset_exist(mi_path) else tools.create_asset('MI_' + name, dest, unreal.MaterialInstanceConstant, unreal.MaterialInstanceConstantFactoryNew())
    mi.set_editor_property('parent', master)
    if base_tex:
        mel.set_material_instance_texture_parameter_value(mi, 'BaseColorMap', base_tex)
    if mr_tex:
        mel.set_material_instance_texture_parameter_value(mi, 'MetalRoughMap', mr_tex)
    mel.update_material_instance(mi)
    eal.save_loaded_asset(mi)
    for i in range(len(mesh.static_materials)):
        mesh.set_material(i, mi)
    eal.save_loaded_asset(mesh)
    # Drop whatever materials and textures the glTF importer made beside the mesh.
    for p in eal.list_assets(dest, recursive=True):
        obj = eal.load_asset(p)
        if obj not in (mesh, mi) and not obj.get_name().startswith('T_' + name) and isinstance(obj, (unreal.MaterialInterface, unreal.Texture)):
            eal.delete_asset(p)
    box = mesh.get_bounding_box()
    results.append({'name': name, 'mesh': mesh.get_path_name(), 'material': mi.get_path_name(),
                    'unrealBounds': [[box.min.x, box.min.y, box.min.z], [box.max.x, box.max.y, box.max.z]],
                    'nanite': mesh.get_editor_property('nanite_settings').enabled, 'triangles': a.get('triangles')})
    log('done', name, results[-1])
json.dump(results, open(JOBS + '.result.json', 'w'), indent=1)
log('all done', len(results))
