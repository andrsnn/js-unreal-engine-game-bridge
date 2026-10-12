"""Generate matching finite Niagara effects. Run only in the isolated headless authoring project."""
import unreal as u,json,math,traceback,re
from pathlib import Path
ROOT=Path('G:/JsGameBridge/Tools/hardburn-vfx'); DEST='/JsGameBridge/HardBurn/VFX'; REPORT=Path('G:/hb-vfx-unreal/Reports/author.json')
fx=u.FXConverterUtilitiesLibrary; assets=u.AssetToolsHelpers.get_asset_tools(); lib=u.EditorAssetLibrary; edit=u.MaterialEditingLibrary; cat=u.ScriptExecutionCategory; kind=u.NiagaraScriptInputType
report={'ok':False,'systems':[],'materials':[]};contexts=[]
def prop(obj,**kw):
 for k,v in kw.items():obj.set_editor_property(k,v)
def require(x,msg):
 if not x:raise RuntimeError(msg)
 return x
def f(x):return fx.create_script_input_float(float(x))
def v(x):return fx.create_script_input_vector(u.Vector(*x))
def linked(n,k):return fx.create_script_input_linked_parameter('User.'+n,k)
def args(path,version=None):
 data=fx.create_asset_data(path);return u.CreateScriptContextArgs(data,version) if version else u.CreateScriptContextArgs(data)
def put(script,n,x):require(script.set_parameter(n,x),'Rejected Niagara input: '+n)
def dynamic(path,inputs,typ):
 s=fx.create_script_context(args(path))
 for n,x in inputs.items():put(s,n,x)
 return fx.create_script_input_dynamic(s,typ)
def maxfloat(base,name):return dynamic('/Niagara/DynamicInputs/Math/Max_Float.Max_Float',{'A':f(base),'B':linked(name,kind.FLOAT)},kind.FLOAT)
def mul(a,b):return dynamic('/Niagara/DynamicInputs/Multiply/Multiply_Float.Multiply_Float',{'A':a,'B':f(b)},kind.FLOAT)
def sizeinput(w,h,ratio=1):return dynamic('/Niagara/DynamicInputs/TypeConversions/MakeVector2D.MakeVector2D',{'X':mul(maxfloat(w/ratio,'WidthCm'),ratio),'Y':maxfloat(h,'LengthCm')},kind.VEC2)
def expr(mat,cls,**kw):
 e=edit.create_material_expression(mat,cls);prop(e,**kw);return e
def con(a,out,b,inp):require(edit.connect_material_expressions(a,out,b,inp),'Material connection '+inp)
def custom_input(name):
 i=u.CustomInput();i.set_editor_property("input_name",name);return i
def custom(mat,code,typ,inputs):
 node=expr(mat,u.MaterialExpressionCustom,code=code,output_type=typ,inputs=[custom_input(k) for k in inputs])
 for k,(e,out) in inputs.items():con(e,out,node,k)
 return node
def texture(name):
 path=DEST+'/Textures/T_'+name
 if lib.does_asset_exist(path):return lib.load_asset(path)
 t=u.AssetImportTask();prop(t,filename=str(ROOT/'Textures'/(name+'.png')),destination_path=DEST+'/Textures',destination_name='T_'+name,automated=True,replace_existing=False,save=True,factory=u.TextureFactory());assets.import_asset_tasks([t]);tex=require(lib.load_asset(path),'Import '+name);prop(tex,srgb=True,address_x=u.TextureAddress.TA_CLAMP,address_y=u.TextureAddress.TA_CLAMP);lib.save_loaded_asset(tex);return tex
def material(name,tex,atlas=False,expand=0,gas=False,mesh=False):
 assetname=name+'_r4';path=DEST+'/Materials/M_'+assetname
 result=(lib.load_asset(path) if lib.does_asset_exist(path) else None) or assets.create_asset('M_'+assetname,DEST+'/Materials',u.Material,u.MaterialFactoryNew());edit.delete_all_material_expressions(result)
 prop(result,blend_mode=u.BlendMode.BLEND_TRANSLUCENT if gas else u.BlendMode.BLEND_ADDITIVE,shading_model=u.MaterialShadingModel.MSM_UNLIT,two_sided=True)
 edit.set_base_material_usage(result,u.MaterialUsage.MATUSAGE_NIAGARA_MESH_PARTICLES if mesh else u.MaterialUsage.MATUSAGE_NIAGARA_SPRITES)
 uv=expr(result,u.MaterialExpressionTextureCoordinate);age=expr(result,u.MaterialExpressionParticleRelativeTime);color=expr(result,u.MaterialExpressionParticleColor)
 sample=expr(result,u.MaterialExpressionTextureSample,texture=tex,sampler_type=u.MaterialSamplerType.SAMPLERTYPE_COLOR)
 if atlas:
  uv0=custom(result,'float n=floor(min(15.,pow(saturate(Age),.74)*15.)); return (float2(fmod(n,4.),floor(n/4.))*256.+10.+saturate(UV)*236.)/1024.;',u.CustomMaterialOutputType.CMOT_FLOAT2,{'UV':(uv,''),'Age':(age,'')});con(uv0,'',sample,'UVs')
  sample2=expr(result,u.MaterialExpressionTextureSample,texture=tex,sampler_type=u.MaterialSamplerType.SAMPLERTYPE_COLOR)
  uv1=custom(result,'float n=min(15.,floor(min(15.,pow(saturate(Age),.74)*15.))+1.); return (float2(fmod(n,4.),floor(n/4.))*256.+10.+saturate(UV)*236.)/1024.;',u.CustomMaterialOutputType.CMOT_FLOAT2,{'UV':(uv,''),'Age':(age,'')});con(uv1,'',sample2,'UVs')
  blend=custom(result,'return frac(min(15.,pow(saturate(Age),.74)*15.));',u.CustomMaterialOutputType.CMOT_FLOAT1,{'Age':(age,'')})
  rgb=expr(result,u.MaterialExpressionLinearInterpolate);alpha=expr(result,u.MaterialExpressionLinearInterpolate)
  for node,out in [(rgb,'RGB'),(alpha,'A')]:con(sample,out,node,'A');con(sample2,out,node,'B');con(blend,'',node,'Alpha')
 else:
  if name in ['Tracer','Drive']:
   # The shared textures have a narrow central strand; crop their black margins
   # so User.WidthCm describes the visible ribbon rather than empty texels.
   cropped=custom(result,'return float2('+('.83' if name=='Tracer' else '.59')+'+(UV.x-.5)*'+('.24' if name=='Tracer' else '.35')+(',lerp(.12,.8,UV.y));' if name=='Tracer' else ',UV.y);'),u.CustomMaterialOutputType.CMOT_FLOAT2,{'UV':(uv,'')});con(cropped,'',sample,'UVs')
  rgb=sample;alpha=sample
 if atlas:rgb=custom(result,'float cold=saturate((Color.b/max(.001,Color.r)-1.3)*.9);return lerp(RGB,dot(RGB,float3(.2126,.7152,.0722)).xxx,cold);',u.CustomMaterialOutputType.CMOT_FLOAT3,{'RGB':(rgb,''),'Color':(color,'RGB')})
 emit=expr(result,u.MaterialExpressionMultiply);con(rgb,'' if atlas else 'RGB',emit,'A');con(color,'',emit,'B');require(edit.connect_material_property(emit,'',u.MaterialProperty.MP_EMISSIVE_COLOR),'Emissive')
 if gas:alpha=custom(result,'return saturate(dot(RGB,float3(.2126,.7152,.0722)));',u.CustomMaterialOutputType.CMOT_FLOAT1,{'RGB':(sample,'RGB')})
 fade=custom(result,('return saturate((1.-Age)/.4);' if name=='ExpanseFlash' else 'return pow(max(0.,1.-Age),1.4);'),u.CustomMaterialOutputType.CMOT_FLOAT1,{'Age':(age,'')})
 if name=='ExpanseFlash':alpha=custom(result,'float2 p=UV*2.-1.;return exp(-dot(p,p)*10.);',u.CustomMaterialOutputType.CMOT_FLOAT1,{'UV':(uv,'')})
 opacity=expr(result,u.MaterialExpressionMultiply);con(alpha,'' if atlas or gas or name=='ExpanseFlash' else 'A',opacity,'A');con(color,'A',opacity,'B');opacity2=expr(result,u.MaterialExpressionMultiply);con(opacity,'',opacity2,'A');con(fade,'',opacity2,'B');require(edit.connect_material_property(opacity2,'',u.MaterialProperty.MP_OPACITY),'Opacity')
 if expand:
  world=expr(result,u.MaterialExpressionWorldPosition);center=expr(result,u.MaterialExpressionParticlePositionWS)
  wpo=custom(result,'return (World-Center)*('+str(float(expand))+'*sqrt(saturate(Age)));',u.CustomMaterialOutputType.CMOT_FLOAT3,{'World':(world,''),'Center':(center,''),'Age':(age,'')});require(edit.connect_material_property(wpo,'',u.MaterialProperty.MP_WORLD_POSITION_OFFSET),'Expansion')
 edit.recompile_material(result);lib.save_loaded_asset(result);report['materials'].append(path);return result
SCRIPTS={'state':'/Niagara/Modules/Emitter/EmitterState.EmitterState','burst':'/Niagara/Modules/Emitter/SpawnBurst_Instantaneous.SpawnBurst_Instantaneous','initialize':'/Niagara/Modules/Spawn/Initialization/V2/InitializeParticle.InitializeParticle','life':'/Niagara/Modules/Update/Lifetime/ParticleState.ParticleState','solve':'/Niagara/Modules/Solvers/SolveForcesAndVelocity.SolveForcesAndVelocity'}
ENUMS={'life':'/Niagara/Enums/ENiagaraEmitterLifeCycleMode.ENiagaraEmitterLifeCycleMode','inactive':'/Niagara/Enums/ENiagaraInactiveMode.ENiagaraInactiveMode','loop':'/Niagara/Enums/ENiagara_EmitterStateOptions.ENiagara_EmitterStateOptions'}
def module(emitter,key,category,version=None):return require(emitter.find_or_add_module_script(key,args(SCRIPTS[key],version),category),'Module '+key)
def enum(n,val):return fx.create_script_input_enum(ENUMS[n],val)
def emitter(context,name,mat,size,color,life,delay=0,count=1,position=(0,0,0),speed=0,axial=False,dimension=False,ratio=1,anchor=False,mesh=False):
 e=context.add_empty_emitter(name);e.set_sim_target(u.NiagaraSimTarget.CPU_SIM);e.set_local_space(True);e.set_enabled(True)
 state=module(e,'state',cat.EMITTER_UPDATE,[1,0]);put(state,'Life Cycle Mode',enum('life','Self'));put(state,'Inactive Response',enum('inactive','Complete (Let Particles Finish then Kill Emitter)'));put(state,'Loop Behavior',enum('loop','Once'));put(state,'Loop Duration',f(life+delay+.05))
 burst=module(e,'burst',cat.EMITTER_UPDATE);put(burst,'Spawn Count',fx.create_script_input_int(count));put(burst,'Spawn Time',f(delay))
 # The converter pastes direct assignments before modules. Initialise explicitly so
 # InitializeParticle cannot overwrite profile colour, lobe offsets or velocity.
 for attribute,value in [('Lifetime',life),('Age',0),('NormalizedAge',0),('Mass',1),('SpriteRotation',0)]:e.set_parameter_directly('Particles.'+attribute,f(value),cat.PARTICLE_SPAWN)
 e.set_parameter_directly('Particles.SpriteFacing',v((0,1,0)),cat.PARTICLE_SPAWN)
 e.set_parameter_directly('Particles.SpriteAlignment',v((0,0,1)),cat.PARTICLE_SPAWN)
 ps=module(e,'life',cat.PARTICLE_UPDATE,[1,1]);put(ps,'Kill Particles When Lifetime Has Elapsed',fx.create_script_input_bool(True))
 e.set_parameter_directly('Particles.SpriteSize',sizeinput(*size,ratio=ratio) if dimension else fx.create_script_input_vec2(u.Vector2D(*size)),cat.PARTICLE_SPAWN)
 e.set_parameter_directly('Particles.Color',fx.create_script_input_linear_color(u.LinearColor(*color)),cat.PARTICLE_SPAWN)
 position_input=dynamic('/Niagara/DynamicInputs/TypeConversions/MakeVector.MakeVector',{'X':f(0),'Y':f(0),'Z':mul(maxfloat(size[1],'LengthCm'),-.5)},kind.VEC3) if anchor else v(position)
 pos=dynamic('/Niagara/DynamicInputs/Transforms/ConvertVectorToPosition.ConvertVectorToPosition',{'Input Position':position_input},kind.POSITION);e.set_parameter_directly('Particles.Position',pos,cat.PARTICLE_SPAWN)
 radial=dynamic('/Niagara/DynamicInputs/UniformRange/UniformRangedVector.UniformRangedVector',{'Minimum':v((-speed,)*3),'Maximum':v((speed,)*3)},kind.VEC3) if speed else v((0,0,0))
 vel=dynamic('/Niagara/DynamicInputs/Add/Add_Vector.Add_Vector',{'A':radial,'B':linked('VelocityLocalCm',kind.VEC3)},kind.VEC3)
 e.set_parameter_directly('Particles.Velocity',vel,cat.PARTICLE_SPAWN);module(e,'solve',cat.PARTICLE_UPDATE)
 if mesh:
  e.set_parameter_directly('Particles.Scale',v((1,1,1)),cat.PARTICLE_SPAWN)
  q=u.Quat4f();prop(q,x=0.,y=0.,z=0.,w=1.);e.set_parameter_directly('Particles.MeshOrientation',fx.create_script_input_quat(q),cat.PARTICLE_SPAWN)
  renderer=u.NiagaraMeshRendererProperties();entry=u.NiagaraMeshRendererMeshProperties();prop(entry,mesh=metalmesh);prop(renderer,meshes=[entry],override_materials=[]);e.add_renderer('Mesh',renderer)
 else:
  renderer=u.NiagaraSpriteRendererProperties();prop(renderer,material=mat,facing_mode=u.NiagaraSpriteFacingMode.FACE_CAMERA_POSITION,alignment=u.NiagaraSpriteAlignment.VELOCITY_ALIGNED if name=='Ejecta' else u.NiagaraSpriteAlignment.CUSTOM_ALIGNMENT if axial else u.NiagaraSpriteAlignment.UNALIGNED)
  if axial:e.set_parameter_directly('Particles.SpriteAlignment',v((0,0,1)),cat.PARTICLE_SPAWN)
  e.add_renderer('Sprite',renderer)
 return e
try:
 textures={n:texture(n) for n in ['explosion','flare','shockwave','smoke','drive','tracer','sparks','debris']}
 mats={n:material(n,textures[t],gas=gas) for n,t,gas in [('ExpanseFlash','flare',False),('Gas','smoke',True),('Drive','drive',False),('Tracer','tracer',False),('Metal','debris',True)]}
 # A genuine three-dimensional cold metal shard, independent of the sprite atlas.
 metalpath=DEST+'/Meshes/SM_MetalShard_r4';metalmesh=lib.load_asset(metalpath) if lib.does_asset_exist(metalpath) else None
 if not metalmesh:
  task=u.AssetImportTask();opts=u.FbxImportUI();prop(opts,import_mesh=True,import_materials=False,import_textures=False,mesh_type_to_import=u.FBXImportType.FBXIT_STATIC_MESH);prop(task,filename=str(ROOT/'metal-shard.obj'),destination_path=DEST+'/Meshes',destination_name='SM_MetalShard_r4',automated=True,replace_existing=False,save=True,options=opts);assets.import_asset_tasks([task]);metalmesh=require(lib.load_asset(metalpath),'Import actual 3D metal shard')
 metalmat=assets.create_asset('M_ColdMetal_r4',DEST+'/Materials',u.Material,u.MaterialFactoryNew()) if not lib.does_asset_exist(DEST+'/Materials/M_ColdMetal_r4') else lib.load_asset(DEST+'/Materials/M_ColdMetal_r4');edit.delete_all_material_expressions(metalmat);edit.set_base_material_usage(metalmat,u.MaterialUsage.MATUSAGE_NIAGARA_MESH_PARTICLES)
 cold=expr(metalmat,u.MaterialExpressionConstant3Vector,constant=u.LinearColor(.22,.28,.34));edit.connect_material_property(cold,'',u.MaterialProperty.MP_BASE_COLOR);age=expr(metalmat,u.MaterialExpressionParticleRelativeTime);worldpos=expr(metalmat,u.MaterialExpressionWorldPosition);center=expr(metalmat,u.MaterialExpressionParticlePositionWS)
 heat=custom(metalmat,'return float3(.12,.15,.18)+float3(.7,.3,.08)*pow(max(0.,1.-Age*18.),2.);',u.CustomMaterialOutputType.CMOT_FLOAT3,{'Age':(age,'')});edit.connect_material_property(heat,'',u.MaterialProperty.MP_EMISSIVE_COLOR)
 tumble=custom(metalmat,'float3 p=World-Center;float s=sin(Age*17.),c=cos(Age*17.);float3 q=float3(p.x,c*p.y-s*p.z,s*p.y+c*p.z);s=sin(Age*11.);c=cos(Age*11.);return float3(c*q.x-s*q.y,s*q.x+c*q.y,q.z)-p;',u.CustomMaterialOutputType.CMOT_FLOAT3,{'World':(worldpos,''),'Center':(center,''),'Age':(age,'')});edit.connect_material_property(tumble,'',u.MaterialProperty.MP_WORLD_POSITION_OFFSET)
 edit.recompile_material(metalmat);lib.save_loaded_asset(metalmat);metalmesh.set_material(0,metalmat);lib.save_loaded_asset(metalmesh)
 data=json.loads((ROOT/'profiles.json').read_text());filterfile=ROOT/'only-keys.json';keys=json.loads(filterfile.read_text()) if filterfile.exists() else list(data['profiles'])
 for key in keys:
  p=data['profiles'][key];name='NS_'+key.replace('.','_')+'_r4';path=DEST+'/Systems/'+name
  recreating=key in (json.loads((ROOT/'recreate.json').read_text()) if (ROOT/'recreate.json').exists() else [])
  if recreating and lib.does_asset_exist(path):raise RuntimeError('Replacement candidates already exist: '+key)
  if lib.does_asset_exist(path) and not recreating:
   report['systems'].append({'key':key,'asset':lib.load_asset(path).get_path_name(),'preserved':True});continue
  system=require(assets.create_asset(name,DEST+'/Systems',u.NiagaraSystem,u.NiagaraSystemFactoryNew()),'Create '+key);context=fx.create_system_conversion_context(system);contexts.append(context);context.set_warmup_time(0.)
  c=p['color'];category=p['category'];parts=[]
  def layer(n,m,s,col,l,**kw):emitter(context,n,mats[m],s,col,l,**kw);parts.append(n)
  if category in ['weapon','plume']:
   w=2 if category=='weapon' else 5;length=110 if category=='plume' else 60;life=p['life'];guided=p.get('style')=='thin-drive'
   layer('ThinDrive' if category=='plume' or guided else 'Tracer','Drive' if category=='plume' or guided else 'Tracer',(w,length),[*c,1],life,axial=True,dimension=True,anchor=category=='plume' or guided)
  elif category=='venting':
   layer('Vapor','Gas',(30,30),[*c,.35],p['life'],count=6,speed=20)
   layer('ColdCondensate','Gas',(15,15),[*c,.18],p['life']*.65,count=5,speed=45)
  else:
   heavy=p['heavy'];d=200 if heavy else 70;life=p['life'];energy=p.get('flashEnergy',48 if key=='nuclear' else 24 if heavy else 16)
   layer('InitialFlash','ExpanseFlash',(d*.6,d*.6),[energy,energy,energy*.96,1],p['flashLife'])
   layer('VacuumGas','Gas',(d*.34,d*.25),[.65,.69,.72,.3],life,delay=.08,count=3 if heavy else 1,speed=d*.12)
   layer('Ejecta','Tracer',(.8,8),[1.1,.8,.45,.55],p['sparkLife'],count=p['sparks'],speed=d*.3,axial=False)
   layer('ColdMetal','Metal',(5,8),[.5,.6,.7,.8],life,count=p['sparks'],speed=d*.3,mesh=True)
  context.finalize();require(lib.save_loaded_asset(system,only_if_is_dirty=False),'Save '+key);context.cleanup();contexts.remove(context);report['systems'].append({'key':key,'asset':system.get_path_name(),'emitters':parts});REPORT.write_text(json.dumps(report,indent=2));u.log('HBVFX authored '+key)
 world=u.get_editor_subsystem(u.UnrealEditorSubsystem).get_editor_world();u.SystemLibrary.execute_console_command(world,'Editor.AsyncAssetCompilationFinishAll');report['ok']=True
except:report['error']=traceback.format_exc();u.log_error(report['error'])
finally:
 for context in contexts:context.cleanup()
 REPORT.write_text(json.dumps(report,indent=2))
 # Quit after editor startup finishes; quitting inside the startup Python hook
 # can try to initialise ModeManager tools during UObject shutdown.
 u.EditorPythonScripting.set_keep_python_script_alive(True)
 _exit_frames=0;_exit_handle=None
 def _deferred_exit(delta):
  global _exit_frames,_exit_handle
  _exit_frames+=1
  if _exit_frames<30:return
  u.unregister_slate_post_tick_callback(_exit_handle);u.EditorPythonScripting.set_keep_python_script_alive(False);u.SystemLibrary.quit_editor()
 _exit_handle=u.register_slate_post_tick_callback(_deferred_exit)
