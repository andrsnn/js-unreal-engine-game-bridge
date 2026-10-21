# Creates the generic materials the JsGameBridge scene mirror draws Three.js materials with.
# Adapted from the Unlit Worlds port's Tools/JsHost/make_materials.py.
# Run: UnrealEditor-Cmd.exe G:/JsgbTest/JsgbTest.uproject -run=pythonscript -script=G:/JsGameBridge/Tools/materials/make_materials.py -unattended
import unreal

AT = unreal.AssetToolsHelpers.get_asset_tools()
MEL = unreal.MaterialEditingLibrary
EAL = unreal.EditorAssetLibrary
ROOT = '/JsGameBridge/Mirror'
MPC_PARAMS = ['Ambient', 'HemiSky', 'HemiGround', 'Background', 'FogColor', 'FogParams', 'CameraParams', 'ViewParams', 'ViewCol0', 'ViewCol1', 'ViewCol2', 'ViewCol3', 'ProjCol0', 'ProjCol1', 'ProjCol2', 'ProjCol3', 'CameraPos', 'CamCol0', 'CamCol1', 'CamCol2', 'CamCol3', 'ProjInvCol0', 'ProjInvCol1', 'ProjInvCol2', 'ProjInvCol3', 'CamRight', 'CamUp']


def fresh(name, cls, factory):
    # The asset registry may not have scanned plugin content yet, so load by path to find old copies.
    path = f'{ROOT}/{name}'
    old = unreal.load_asset(path)
    if old:
        EAL.delete_loaded_asset(old)
    return AT.create_asset(name, ROOT, cls, factory)


def make_mpc():
    # Materials reference the collection, so an existing one is updated in place.
    path = f'{ROOT}/MPC_JsgbScene'
    mpc = unreal.load_asset(path) or AT.create_asset('MPC_JsgbScene', ROOT, unreal.MaterialParameterCollection, unreal.MaterialParameterCollectionFactoryNew())
    params = []
    for n in MPC_PARAMS:
        p = unreal.CollectionVectorParameter()
        p.set_editor_property('parameter_name', n)
        p.set_editor_property('default_value', unreal.LinearColor(0, 0, 0, 0))
        params.append(p)
    mpc.set_editor_property('vector_parameters', params)
    EAL.save_loaded_asset(mpc)
    return mpc


class Graph:
    def __init__(self, mat):
        self.m = mat
        self.y = 0

    def node(self, cls, **props):
        e = MEL.create_material_expression(self.m, cls, -900, self.y)
        self.y += 140
        for k, v in props.items():
            e.set_editor_property(k, v)
        return e

    def link(self, a, out, b, inp):
        MEL.connect_material_expressions(a, out, b, inp)

    def scalar(self, name, default):
        return self.node(unreal.MaterialExpressionScalarParameter, parameter_name=name, default_value=default)

    def vector(self, name, default):
        return self.node(unreal.MaterialExpressionVectorParameter, parameter_name=name, default_value=default)

    def const3(self, r, g, b):
        return self.node(unreal.MaterialExpressionConstant3Vector, constant=unreal.LinearColor(r, g, b, 1))

    def const(self, v):
        return self.node(unreal.MaterialExpressionConstant, r=v)

    def op(self, cls, a, b, aout='', bout=''):
        e = self.node(cls)
        self.link(a, aout, e, 'A')
        self.link(b, bout, e, 'B')
        return e

    def mul(self, a, b, aout='', bout=''):
        return self.op(unreal.MaterialExpressionMultiply, a, b, aout, bout)

    def add(self, a, b, aout='', bout=''):
        return self.op(unreal.MaterialExpressionAdd, a, b, aout, bout)

    def lerp(self, a, b, alpha, aout='', bout='', alphaout=''):
        e = self.node(unreal.MaterialExpressionLinearInterpolate)
        self.link(a, aout, e, 'A')
        self.link(b, bout, e, 'B')
        self.link(alpha, alphaout, e, 'Alpha')
        return e

    def mask(self, a, r=False, g=False, b=False, al=False, aout=''):
        e = self.node(unreal.MaterialExpressionComponentMask, r=r, g=g, b=b, a=al)
        self.link(a, aout, e, '')
        return e

    def append(self, a, b, aout='', bout=''):
        return self.op(unreal.MaterialExpressionAppendVector, a, b, aout, bout)

    def collection(self, mpc, name, rgb=True):
        # Scene-wide values (ambient, fog, camera) are ordinary parameters the host pushes to every
        # instance when they change. Collections made from Python get zero parameter ids.
        e = self.vector(name, unreal.LinearColor(0, 0, 0, 0))
        if rgb:
            return e
        return self.append(e, e, bout='A')



# Points and sprites: quads whose corners share one position, spread along the camera's axes.
# Custom primitive data 0-3: size x, size y (cm or pixels), rotation (radians), mode
# (0 world size, 1 pixel size, 2 size times distance, as three.js does without size attenuation).
BILLBOARD_HLSL = r"""
float2 c = (UV - 0.5) * float2(1.0, -1.0);
float s = sin(Data.z), k = cos(Data.z);
c = float2(c.x * k - c.y * s, c.x * s + c.y * k);
float2 size = Data.xy;
float dist = length(WorldPos - CamPos);
if (Data.w > 1.5) size *= dist;
else if (Data.w > 0.5) size *= 2.0 * dist * View.x / max(View.y, 1.0);
return Right * (c.x * size.x) + Up * (c.y * size.y);
"""


def billboard_offset(g):
    custom = g.node(unreal.MaterialExpressionCustom)
    custom.set_editor_property('code', BILLBOARD_HLSL)
    custom.set_editor_property('output_type', unreal.CustomMaterialOutputType.CMOT_FLOAT3)
    inputs = []
    for n in ['UV', 'Data', 'Right', 'Up', 'WorldPos', 'CamPos', 'View']:
        ci = unreal.CustomInput()
        ci.set_editor_property('input_name', n)
        inputs.append(ci)
    custom.set_editor_property('inputs', inputs)
    g.link(g.node(unreal.MaterialExpressionTextureCoordinate), '', custom, 'UV')
    data = []
    for i, default in enumerate([100.0, 100.0, 0.0, 0.0]):
        p = g.scalar(['SizeX', 'SizeY', 'Rotation', 'SizeMode'][i], default)
        p.set_editor_property('use_custom_primitive_data', True)
        p.set_editor_property('primitive_data_index', i)
        data.append(p)
    g.link(g.append(g.append(data[0], data[1]), g.append(data[2], data[3])), '', custom, 'Data')
    # Camera axes in Unreal world space, written by the host each frame.
    g.link(g.collection(MPC, 'CamRight'), '', custom, 'Right')
    g.link(g.collection(MPC, 'CamUp'), '', custom, 'Up')
    g.link(g.node(unreal.MaterialExpressionWorldPosition), '', custom, 'WorldPos')
    g.link(g.node(unreal.MaterialExpressionCameraPositionWS), '', custom, 'CamPos')
    g.link(g.collection(MPC, 'ViewParams', rgb=False), '', custom, 'View')
    MEL.connect_material_property(custom, '', unreal.MaterialProperty.MP_WORLD_POSITION_OFFSET)


# S: the surface colour (linear), A: its opacity, D: the opaque scene behind it (linear). Translucent: the colour C with
# A*C + (1-A)*D = decode(A*encode(S) + (1-A)*encode(D)). Additive (three.js: source times alpha, plus destination): the
# colour to add, decode(A*encode(S) + encode(D)) - D. encode and decode are the exact sRGB curves three.js uses.
SRGB_BLEND = '''
float3 s = max(S, 0), d = max(D, 0);
float3 es = lerp(1.055 * pow(s, 1.0 / 2.4) - 0.055, s * 12.92, step(s, 0.0031308));
float3 ed = lerp(1.055 * pow(d, 1.0 / 2.4) - 0.055, d * 12.92, step(d, 0.0031308));
float a = saturate(A);
float3 o = ADDITIVE ? a * es + ed : a * es + (1 - a) * ed;
float3 f = lerp(pow((o + 0.055) / 1.055, 2.4), o / 12.92, step(o, 0.04045));
return ADDITIVE ? max(f - d, 0) : (a < 0.002 ? s : max((f - (1 - a) * d) / a, 0));
'''


def make_surface(name, mpc, shading='lit', blend='opaque', two_sided=False, billboard=False):
    mat = fresh(name, unreal.Material, unreal.MaterialFactoryNew())
    g = Graph(mat)
    mat.set_editor_property('two_sided', two_sided or blend != 'opaque')
    mat.set_editor_property('blend_mode', {'opaque': unreal.BlendMode.BLEND_OPAQUE, 'masked': unreal.BlendMode.BLEND_MASKED,
                                           'translucent': unreal.BlendMode.BLEND_TRANSLUCENT, 'additive': unreal.BlendMode.BLEND_ADDITIVE}[blend])
    mat.set_editor_property('shading_model', unreal.MaterialShadingModel.MSM_UNLIT if shading == 'unlit' else unreal.MaterialShadingModel.MSM_DEFAULT_LIT)
    mat.set_editor_property('used_with_instanced_static_meshes', True)
    if blend == 'translucent' and shading == 'lit':
        mat.set_editor_property('translucency_lighting_mode', unreal.TranslucencyLightingMode.TLM_SURFACE)

    # UVs: three.js repeat/offset, then a V flip for textures uploaded with flipY.
    uv = g.node(unreal.MaterialExpressionTextureCoordinate)
    xf = g.vector('UVXform', unreal.LinearColor(1, 1, 0, 0))
    uvt = g.add(g.mul(uv, g.mask(xf, r=True, g=True)), g.append(xf, xf, aout='B', bout='A'))
    u = g.mask(uvt, r=True)
    v = g.mask(uvt, g=True)
    one_minus = g.node(unreal.MaterialExpressionOneMinus)
    g.link(v, '', one_minus, '')
    vflip = g.lerp(v, one_minus, g.scalar('FlipV', 0))
    uvf = g.append(u, vflip)
    tex = g.node(unreal.MaterialExpressionTextureSampleParameter2D, parameter_name='Map',
                 texture=unreal.load_asset('/Engine/EngineResources/WhiteSquareTexture'))
    g.link(uvf, '', tex, 'UVs')

    white = g.const3(1, 1, 1)
    one = g.const(1)
    color = g.vector('Color', unreal.LinearColor(1, 1, 1, 1))
    vc = g.mask(g.node(unreal.MaterialExpressionVertexColor), r=True, g=True, b=True)
    vc_lin = g.node(unreal.MaterialExpressionPower)
    g.link(vc, '', vc_lin, 'Base')
    vc_lin.set_editor_property('const_exponent', 2.2)
    vc_rgb = g.lerp(vc, vc_lin, g.scalar('VCDecode', 1))
    vcm = g.lerp(white, vc_rgb, g.scalar('VertexColorMix', 0))
    mapm = g.lerp(white, tex, g.scalar('MapMix', 0), bout='RGB')
    ic = g.append(g.append(g.node(unreal.MaterialExpressionPerInstanceCustomData, data_index=0, const_default_value=1),
                           g.node(unreal.MaterialExpressionPerInstanceCustomData, data_index=1, const_default_value=1)),
                  g.node(unreal.MaterialExpressionPerInstanceCustomData, data_index=2, const_default_value=1))
    icm = g.lerp(white, ic, g.scalar('InstanceColorMix', 0))
    base = g.mul(g.mul(g.mul(color, vcm), mapm), icm)
    emissive = g.vector('Emissive', unreal.LinearColor(0, 0, 0, 1))
    alpha = g.mul(g.scalar('Opacity', 1), g.lerp(one, tex, g.scalar('MapMix', 0), bout='A'))

    if shading == 'unlit' and blend in ('translucent', 'additive'):
        # WebGL blends a transparent surface with what's behind it in sRGB values (three.js encodes the output
        # before blending); Unreal blends in linear light, so over a dark background the surface came out brighter.
        # The node reads the opaque scene behind the pixel and outputs the colour that, blended linearly with the
        # same opacity, gives WebGL's result. Two transparent layers over each other still blend linearly.
        sws = g.node(unreal.MaterialExpressionCustom, output_type=unreal.CustomMaterialOutputType.CMOT_FLOAT3,
                     description='sRGB blend', code=SRGB_BLEND.replace('ADDITIVE', '1' if blend == 'additive' else '0'))
        inputs = []
        for n in ('S', 'A', 'D'):
            ci = unreal.CustomInput()
            ci.set_editor_property('input_name', n)
            inputs.append(ci)
        sws.set_editor_property('inputs', inputs)
        g.link(g.add(base, emissive), '', sws, 'S')
        g.link(alpha, '', sws, 'A')
        g.link(g.node(unreal.MaterialExpressionSceneColor), '', sws, 'D')
        MEL.connect_material_property(sws, '', unreal.MaterialProperty.MP_EMISSIVE_COLOR)
    elif shading == 'unlit':
        MEL.connect_material_property(g.add(base, emissive), '', unreal.MaterialProperty.MP_EMISSIVE_COLOR)
    else:
        # Three.js ambient and hemisphere light have no occlusion: add BaseColor * irradiance / pi.
        nrm = g.node(unreal.MaterialExpressionVertexNormalWS)
        up = g.add(g.mul(g.mask(nrm, b=True), g.const(0.5)), g.const(0.5))
        hemi = g.lerp(g.collection(mpc, 'HemiGround'), g.collection(mpc, 'HemiSky'), up)
        amb = g.mul(base, g.add(g.collection(mpc, 'Ambient'), hemi))
        MEL.connect_material_property(base, '', unreal.MaterialProperty.MP_BASE_COLOR)
        MEL.connect_material_property(g.add(emissive, amb), '', unreal.MaterialProperty.MP_EMISSIVE_COLOR)
        MEL.connect_material_property(g.scalar('Roughness', 0.8), '', unreal.MaterialProperty.MP_ROUGHNESS)
        MEL.connect_material_property(g.scalar('Metallic', 0), '', unreal.MaterialProperty.MP_METALLIC)
        MEL.connect_material_property(g.scalar('Specular', 0.5), '', unreal.MaterialProperty.MP_SPECULAR)
    if blend == 'translucent':
        MEL.connect_material_property(alpha, '', unreal.MaterialProperty.MP_OPACITY)
    elif blend == 'masked':
        clip = g.add(g.op(unreal.MaterialExpressionSubtract, alpha, g.scalar('AlphaTest', 0.5)), g.const(0.5))
        MEL.connect_material_property(clip, '', unreal.MaterialProperty.MP_OPACITY_MASK)
    elif blend == 'additive' and shading != 'unlit':
        MEL.connect_material_property(g.mul(g.add(base, emissive), alpha), '', unreal.MaterialProperty.MP_EMISSIVE_COLOR)
    if billboard:
        billboard_offset(g)
    errors = MEL.recompile_material(mat)
    EAL.save_loaded_asset(mat)
    unreal.log_warning(f'JsGameBridge material {name} saved; compile messages: {list(errors)}')


SKY = '''
float3 d = -V;
float3 t = float3(d.x, d.z, d.y);
float3 r = normalize(float3(dot(R0.xyz, t), dot(R1.xyz, t), dot(R2.xyz, t)));
float u = atan2(r.z, r.x) * 0.15915494 + 0.5;
float v = asin(clamp(r.y, -1.0, 1.0)) * 0.31830989 + 0.5;
if (Flip > 0.5) v = 1.0 - v;
return Tex.SampleLevel(TexSampler, float2(u, v), 0).rgb * I;
'''


def make_sky():
    """scene.background as an equirectangular texture: drawn on a sphere around the camera, as a sky (behind everything).
    The direction is converted to three.js axes (Y up), rotated by scene.backgroundRotation, and looked up as three.js's
    equirectUv does."""
    mat = fresh('M_JsgbSky', unreal.Material, unreal.MaterialFactoryNew())
    g = Graph(mat)
    mat.set_editor_property('shading_model', unreal.MaterialShadingModel.MSM_UNLIT)
    mat.set_editor_property('two_sided', True)
    mat.set_editor_property('is_sky', True)
    node = g.node(unreal.MaterialExpressionCustom, output_type=unreal.CustomMaterialOutputType.CMOT_FLOAT3, description='equirect sky', code=SKY)
    inputs = []
    for n in ('V', 'R0', 'R1', 'R2', 'I', 'Flip', 'Tex'):
        ci = unreal.CustomInput()
        ci.set_editor_property('input_name', n)
        inputs.append(ci)
    node.set_editor_property('inputs', inputs)
    g.link(g.node(unreal.MaterialExpressionCameraVectorWS), '', node, 'V')
    g.link(g.vector('Rot0', unreal.LinearColor(1, 0, 0, 0)), '', node, 'R0')
    g.link(g.vector('Rot1', unreal.LinearColor(0, 1, 0, 0)), '', node, 'R1')
    g.link(g.vector('Rot2', unreal.LinearColor(0, 0, 1, 0)), '', node, 'R2')
    g.link(g.scalar('Intensity', 1), '', node, 'I')
    g.link(g.scalar('FlipV', 0), '', node, 'Flip')
    tex = g.node(unreal.MaterialExpressionTextureObjectParameter, parameter_name='Map', texture=unreal.load_asset('/Engine/EngineResources/WhiteSquareTexture'))
    g.link(tex, '', node, 'Tex')
    MEL.connect_material_property(node, '', unreal.MaterialProperty.MP_EMISSIVE_COLOR)
    errors = MEL.recompile_material(mat)
    EAL.save_loaded_asset(mat)
    unreal.log_warning(f'JsGameBridge material M_JsgbSky saved; compile messages: {list(errors)}')


def make_post(mpc):
    mat = fresh('M_JsgbScenePost', unreal.Material, unreal.MaterialFactoryNew())
    g = Graph(mat)
    mat.set_editor_property('material_domain', unreal.MaterialDomain.MD_POST_PROCESS)
    mat.set_editor_property('blendable_location', unreal.BlendableLocation.BL_SCENE_COLOR_BEFORE_DOF)
    scene = g.node(unreal.MaterialExpressionSceneTexture, scene_texture_id=unreal.SceneTextureId.PPI_POST_PROCESS_INPUT0)
    depth = g.node(unreal.MaterialExpressionSceneTexture, scene_texture_id=unreal.SceneTextureId.PPI_SCENE_DEPTH)
    d = g.mask(depth, r=True, aout='Color')
    fogp = g.collection(mpc, 'FogParams', rgb=False)        # near cm, far cm, density per cm, mode
    fogc = g.collection(mpc, 'FogColor', rgb=False)         # rgb, mode
    bg = g.collection(mpc, 'Background', rgb=False)         # rgb, enabled
    cam = g.collection(mpc, 'CameraParams', rgb=False)      # near cm, empty-pixel depth cm, sky depth cm
    near = g.mask(fogp, r=True)
    far = g.mask(fogp, g=True)
    dens = g.mask(fogp, b=True)
    mode = g.mask(fogp, al=True)
    # Linear fog: smoothstep(near, far, depth). Exp2 fog: 1 - exp(-(density * depth)^2).
    div = g.op(unreal.MaterialExpressionDivide, g.op(unreal.MaterialExpressionSubtract, d, near), g.op(unreal.MaterialExpressionSubtract, far, near))
    sat = g.node(unreal.MaterialExpressionSaturate)
    g.link(div, '', sat, '')
    smooth = g.mul(g.mul(sat, sat), g.op(unreal.MaterialExpressionSubtract, g.const(3), g.mul(sat, g.const(2))))
    dd = g.mul(dens, d)
    ex = g.node(unreal.MaterialExpressionExponential)
    g.link(g.mul(g.mul(dd, dd), g.const(-1)), '', ex, '')
    exp2 = g.op(unreal.MaterialExpressionSubtract, g.const(1), ex)
    is_exp = g.node(unreal.MaterialExpressionSaturate)
    g.link(g.op(unreal.MaterialExpressionSubtract, mode, g.const(1)), '', is_exp, '')
    has_fog = g.node(unreal.MaterialExpressionSaturate)
    g.link(mode, '', has_fog, '')
    # Pixels out at the sky dome (CameraParams.b cm and beyond) are sky, which three.js never fogs.
    sky_mask = g.node(unreal.MaterialExpressionSaturate)
    g.link(g.op(unreal.MaterialExpressionSubtract, d, g.mask(cam, b=True)), '', sky_mask, '')
    not_sky = g.node(unreal.MaterialExpressionOneMinus)
    g.link(sky_mask, '', not_sky, '')
    # Surfaces drawn with fog: false write custom stencil 1 (JsgbSceneMirror). Skip fog where such a
    # surface is the one in front, i.e. its custom depth matches the scene depth.
    stencil = g.node(unreal.MaterialExpressionSceneTexture, scene_texture_id=unreal.SceneTextureId.PPI_CUSTOM_STENCIL)
    cdepth = g.node(unreal.MaterialExpressionSceneTexture, scene_texture_id=unreal.SceneTextureId.PPI_CUSTOM_DEPTH)
    marked = g.node(unreal.MaterialExpressionSaturate)
    g.link(g.mask(stencil, r=True, aout='Color'), '', marked, '')
    gap = g.node(unreal.MaterialExpressionAbs)
    g.link(g.op(unreal.MaterialExpressionSubtract, g.mask(cdepth, r=True, aout='Color'), d), '', gap, '')
    in_front = g.node(unreal.MaterialExpressionSaturate)
    g.link(g.op(unreal.MaterialExpressionSubtract, g.const(1), g.op(unreal.MaterialExpressionDivide, gap, g.op(unreal.MaterialExpressionAdd, g.mul(d, g.const(0.002)), g.const(2)))), '', in_front, '')
    fog_on = g.node(unreal.MaterialExpressionOneMinus)
    g.link(g.mul(marked, in_front), '', fog_on, '')
    factor = g.mul(g.mul(g.mul(g.lerp(smooth, exp2, is_exp), has_fog), not_sky), fog_on)
    fogged = g.lerp(g.mask(scene, r=True, g=True, b=True, aout='Color'), g.mask(fogc, r=True, g=True, b=True), factor)
    # Nothing nearer than the three.js far plane: show the scene background colour.
    camfar = g.mask(cam, g=True)
    beyond = g.node(unreal.MaterialExpressionSaturate)
    g.link(g.mul(g.op(unreal.MaterialExpressionSubtract, d, g.mul(camfar, g.const(0.999))), g.const(1.0)), '', beyond, '')
    bg_on = g.mul(beyond, g.mask(bg, al=True))
    out = g.lerp(fogged, g.mask(bg, r=True, g=True, b=True), bg_on)
    MEL.connect_material_property(out, '', unreal.MaterialProperty.MP_EMISSIVE_COLOR)
    errors = MEL.recompile_material(mat)
    EAL.save_loaded_asset(mat)
    unreal.log_warning(f'JsGameBridge material M_JsgbScenePost saved; compile messages: {list(errors)}')



MPC = make_mpc()
make_surface('M_JsgbLit', MPC)
make_surface('M_JsgbLit2S', MPC, two_sided=True)
make_surface('M_JsgbMasked', MPC, blend='masked', two_sided=True)
make_surface('M_JsgbTrans', MPC, blend='translucent')
make_surface('M_JsgbUnlit', MPC, shading='unlit', two_sided=True)
make_surface('M_JsgbUnlitTrans', MPC, shading='unlit', blend='translucent')
make_surface('M_JsgbAdditive', MPC, shading='unlit', blend='additive')
make_surface('M_JsgbUnlitMasked', MPC, shading='unlit', blend='masked', two_sided=True)
make_surface('M_JsgbBillboard', MPC, shading='unlit', blend='translucent', billboard=True)
make_surface('M_JsgbBillboardAdd', MPC, shading='unlit', blend='additive', billboard=True)
make_post(MPC)
make_sky()
unreal.log('JsGameBridge materials done')
