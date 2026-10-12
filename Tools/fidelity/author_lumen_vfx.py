"""Lumen mode's Niagara effects, authored into the fidelity host project (/Game/Fidelity/VFX) so they cook with the
override models. Runs in an editor commandlet (Tools/fidelity/author-lumen-vfx.mjs) and needs the
CascadeToNiagaraConverter plugin, whose Python library builds Niagara emitters. Report: JSGB_LUMEN_VFX_REPORT.

NS_LumenVapour: lit vapour for the game's hull vents (userData.vfxKey "venting.*"). It spawns for as long as the
game's vent object is in the scene, so it starts and stops with the game's own effect, and it sizes its puffs from
User.SizeCm (the vent's size, which the bridge sets). The game draws its vapour unlit; in Lumen mode it is lit by
the sun, the sky light and the ships' own lights, with a dark side away from the sun."""
import unreal as u, json, os, traceback
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1] / 'hardburn-vfx'
DEST = '/Game/Fidelity/VFX'
REPORT = Path(os.environ.get('JSGB_LUMEN_VFX_REPORT', 'lumen-vfx.json'))
fx = u.FXConverterUtilitiesLibrary; assets = u.AssetToolsHelpers.get_asset_tools(); lib = u.EditorAssetLibrary
edit = u.MaterialEditingLibrary; cat = u.ScriptExecutionCategory; kind = u.NiagaraScriptInputType
report = {'ok': False, 'assets': []}


def prop(obj, **kw):
    for k, v in kw.items(): obj.set_editor_property(k, v)


def require(x, msg):
    if not x: raise RuntimeError(msg)
    return x


def f(x): return fx.create_script_input_float(float(x))
def vec(x): return fx.create_script_input_vector(u.Vector(*x))
def linked(name, k): return fx.create_script_input_linked_parameter('User.' + name, k)
def args(path, version=None):
    data = fx.create_asset_data(path)
    return u.CreateScriptContextArgs(data, version) if version else u.CreateScriptContextArgs(data)
def put(script, n, x): require(script.set_parameter(n, x), 'Rejected Niagara input: ' + n)
def dynamic(path, inputs, typ):
    s = fx.create_script_context(args(path))
    for n, x in inputs.items(): put(s, n, x)
    return fx.create_script_input_dynamic(s, typ)
def mul(a, b): return dynamic('/Niagara/DynamicInputs/Multiply/Multiply_Float.Multiply_Float', {'A': a, 'B': f(b)}, kind.FLOAT)
def ranged(lo, hi): return dynamic('/Niagara/DynamicInputs/UniformRange/UniformRangedFloat.UniformRangedFloat', {'Minimum': f(lo), 'Maximum': f(hi)}, kind.FLOAT)
def ranged3(lo, hi): return dynamic('/Niagara/DynamicInputs/UniformRange/UniformRangedVector.UniformRangedVector', {'Minimum': vec(lo), 'Maximum': vec(hi)}, kind.VEC3)


def expr(mat, cls, **kw):
    e = edit.create_material_expression(mat, cls); prop(e, **kw); return e
def con(a, out, b, inp): require(edit.connect_material_expressions(a, out, b, inp), 'Material connection ' + inp)
def custom(mat, code, typ, inputs):
    ins = []
    for k in inputs:
        i = u.CustomInput(); i.set_editor_property('input_name', k); ins.append(i)
    node = expr(mat, u.MaterialExpressionCustom, code=code, output_type=typ, inputs=ins)
    for k, (e, out) in inputs.items(): con(e, out, node, k)
    return node


def texture(name):
    path = f'{DEST}/Textures/T_Lumen_{name}'
    if lib.does_asset_exist(path): return lib.load_asset(path)
    t = u.AssetImportTask()
    prop(t, filename=str(ROOT / 'Textures' / f'{name}.png'), destination_path=f'{DEST}/Textures', destination_name=f'T_Lumen_{name}',
         automated=True, replace_existing=True, save=True, factory=u.TextureFactory())
    assets.import_asset_tasks([t])
    tex = require(lib.load_asset(path), 'Import ' + name)
    prop(tex, srgb=True, address_x=u.TextureAddress.TA_CLAMP, address_y=u.TextureAddress.TA_CLAMP)
    lib.save_loaded_asset(tex)
    return tex


def vapour_material(tex):
    """Lit, translucent, soft-edged vapour: base colour from the particle colour, opacity from the smoke texture,
    fading in fast and out slowly, each puff growing as it ages."""
    path = f'{DEST}/Materials/M_LumenVapour'
    mat = lib.load_asset(path) if lib.does_asset_exist(path) else assets.create_asset('M_LumenVapour', f'{DEST}/Materials', u.Material, u.MaterialFactoryNew())
    edit.delete_all_material_expressions(mat)
    prop(mat, blend_mode=u.BlendMode.BLEND_TRANSLUCENT, shading_model=u.MaterialShadingModel.MSM_DEFAULT_LIT, two_sided=True,
         translucency_lighting_mode=u.TranslucencyLightingMode.TLM_VOLUMETRIC_DIRECTIONAL)
    edit.set_base_material_usage(mat, u.MaterialUsage.MATUSAGE_NIAGARA_SPRITES)
    uv = expr(mat, u.MaterialExpressionTextureCoordinate); age = expr(mat, u.MaterialExpressionParticleRelativeTime)
    color = expr(mat, u.MaterialExpressionParticleColor)
    sample = expr(mat, u.MaterialExpressionTextureSample, texture=tex, sampler_type=u.MaterialSamplerType.SAMPLERTYPE_COLOR)
    con(uv, '', sample, 'UVs')
    base = custom(mat, 'return Color * lerp(.72, 1., saturate(RGB.r));', u.CustomMaterialOutputType.CMOT_FLOAT3, {'Color': (color, 'RGB'), 'RGB': (sample, 'RGB')})
    require(edit.connect_material_property(base, '', u.MaterialProperty.MP_BASE_COLOR), 'Base colour')
    rough = expr(mat, u.MaterialExpressionConstant, r=1.0)
    require(edit.connect_material_property(rough, '', u.MaterialProperty.MP_ROUGHNESS), 'Roughness')
    opacity = custom(mat, 'float l = saturate(dot(RGB, float3(.2126, .7152, .0722)));'
                          'return smoothstep(.03, .55, l) * A * saturate(Age * 10.) * pow(saturate(1. - Age), 1.6);',
                     u.CustomMaterialOutputType.CMOT_FLOAT1, {'RGB': (sample, 'RGB'), 'A': (color, 'A'), 'Age': (age, '')})
    require(edit.connect_material_property(opacity, '', u.MaterialProperty.MP_OPACITY), 'Opacity')
    world = expr(mat, u.MaterialExpressionWorldPosition); centre = expr(mat, u.MaterialExpressionParticlePositionWS)
    grow = custom(mat, 'return (World - Centre) * (1.6 * sqrt(saturate(Age)));', u.CustomMaterialOutputType.CMOT_FLOAT3,
                  {'World': (world, ''), 'Centre': (centre, ''), 'Age': (age, '')})
    require(edit.connect_material_property(grow, '', u.MaterialProperty.MP_WORLD_POSITION_OFFSET), 'Growth')
    edit.recompile_material(mat); lib.save_loaded_asset(mat); report['assets'].append(path)
    return mat


def module(e, path, category, version=None):
    return require(e.find_or_add_module_script(path.split('/')[-1].split('.')[0], args(path, version), category), 'Module ' + path)


def vapour_system(mat):
    path = f'{DEST}/Systems/NS_LumenVapour'
    if lib.does_asset_exist(path): lib.delete_asset(path)
    system = require(assets.create_asset('NS_LumenVapour', f'{DEST}/Systems', u.NiagaraSystem, u.NiagaraSystemFactoryNew()), 'Create NS_LumenVapour')
    context = fx.create_system_conversion_context(system); context.set_warmup_time(0.)
    try:
        e = context.add_empty_emitter('Vapour'); e.set_sim_target(u.NiagaraSimTarget.CPU_SIM); e.set_local_space(True); e.set_enabled(True)
        state = module(e, '/Niagara/Modules/Emitter/EmitterState.EmitterState', cat.EMITTER_UPDATE, [1, 0])
        put(state, 'Life Cycle Mode', fx.create_script_input_enum('/Niagara/Enums/ENiagaraEmitterLifeCycleMode.ENiagaraEmitterLifeCycleMode', 'Self'))
        put(state, 'Inactive Response', fx.create_script_input_enum('/Niagara/Enums/ENiagaraInactiveMode.ENiagaraInactiveMode', 'Complete (Let Particles Finish then Kill Emitter)'))
        put(state, 'Loop Behavior', fx.create_script_input_enum('/Niagara/Enums/ENiagara_EmitterStateOptions.ENiagara_EmitterStateOptions', 'Infinite'))
        rate = module(e, '/Niagara/Modules/Emitter/SpawnRate.SpawnRate', cat.EMITTER_UPDATE)
        put(rate, 'SpawnRate', f(22))
        for attribute, value in [('Age', 0), ('NormalizedAge', 0), ('Mass', 1)]:
            e.set_parameter_directly('Particles.' + attribute, f(value), cat.PARTICLE_SPAWN)
        e.set_parameter_directly('Particles.Lifetime', ranged(.9, 1.5), cat.PARTICLE_SPAWN)
        e.set_parameter_directly('Particles.SpriteRotation', ranged(0, 360), cat.PARTICLE_SPAWN)
        # Puffs about 1.2 vent sizes across at birth, growing to about 3 (the material's growth).
        width = mul(dynamic('/Niagara/DynamicInputs/Math/Max_Float.Max_Float', {'A': f(30), 'B': linked('SizeCm', kind.FLOAT)}, kind.FLOAT), 1.2)
        e.set_parameter_directly('Particles.SpriteSize', dynamic('/Niagara/DynamicInputs/TypeConversions/MakeVector2D.MakeVector2D', {'X': width, 'Y': width}, kind.VEC2), cat.PARTICLE_SPAWN)
        e.set_parameter_directly('Particles.Color', fx.create_script_input_linear_color(u.LinearColor(.86, .88, .9, .55)), cat.PARTICLE_SPAWN)
        pos = dynamic('/Niagara/DynamicInputs/Transforms/ConvertVectorToPosition.ConvertVectorToPosition', {'Input Position': ranged3((-12, -12, 0), (12, 12, 20))}, kind.POSITION)
        e.set_parameter_directly('Particles.Position', pos, cat.PARTICLE_SPAWN)
        # Local space, so the component's scale (the vent's size) scales the jet's speed: about two sizes a second out of the vent.
        e.set_parameter_directly('Particles.Velocity', ranged3((-45, -45, 150), (45, 45, 240)), cat.PARTICLE_SPAWN)
        life = module(e, '/Niagara/Modules/Update/Lifetime/ParticleState.ParticleState', cat.PARTICLE_UPDATE, [1, 1])
        put(life, 'Kill Particles When Lifetime Has Elapsed', fx.create_script_input_bool(True))
        module(e, '/Niagara/Modules/Solvers/SolveForcesAndVelocity.SolveForcesAndVelocity', cat.PARTICLE_UPDATE)
        renderer = u.NiagaraSpriteRendererProperties()
        prop(renderer, material=mat, facing_mode=u.NiagaraSpriteFacingMode.FACE_CAMERA_POSITION, alignment=u.NiagaraSpriteAlignment.UNALIGNED)
        e.add_renderer('Sprite', renderer)
        context.finalize()
        require(lib.save_loaded_asset(system, only_if_is_dirty=False), 'Save NS_LumenVapour')
    finally:
        context.cleanup()
    report['assets'].append(system.get_path_name())


try:
    vapour_system(vapour_material(texture('smoke')))
    report['ok'] = True
except Exception:
    report['error'] = traceback.format_exc(); u.log_error(report['error'])
finally:
    REPORT.write_text(json.dumps(report, indent=2))
    # The converter needs Slate, so this runs in a full editor (off screen): quit once the editor has finished starting
    # up, since quitting inside the startup Python hook can fail during shutdown.
    u.EditorPythonScripting.set_keep_python_script_alive(True)
    _frames = 0; _handle = None
    def _quit(delta):
        global _frames, _handle
        _frames += 1
        if _frames < 30: return
        u.unregister_slate_post_tick_callback(_handle); u.EditorPythonScripting.set_keep_python_script_alive(False); u.SystemLibrary.quit_editor()
    _handle = u.register_slate_post_tick_callback(_quit)
