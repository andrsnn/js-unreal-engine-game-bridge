"""Reload, simulate and capture authored Niagara systems in the real offscreen D3D renderer."""
import unreal as u,json,traceback,time,math
from pathlib import Path
ROOT=Path('G:/JsGameBridge/Tools/hardburn-vfx');OUT=Path('C:/UnlitWorldsCaptures/judge/hardburn-vfx-expanse/niagara');OUT.mkdir(parents=True,exist_ok=True)
report={'ok':False,'mode':'offscreen D3D12; isolated content authoring project','systems':[],'captures':[]};handle=None;component=None;niagaraActor=None;queue=[];current=None;frame=0;stage=0;started=time.monotonic()

def prop(obj,**kw):
 for k,v in kw.items():obj.set_editor_property(k,v)
def finish(error=None):
 global handle
 report['ok']=error is None;report['seconds']=time.monotonic()-started
 if error:report['error']=error;u.log_error(error)
 (OUT/'report.json').write_text(json.dumps(report,indent=2))
 if handle:u.unregister_slate_post_tick_callback(handle);handle=None
 u.EditorPythonScripting.set_keep_python_script_alive(False)
 u.SystemLibrary.quit_editor()
try:
 u.EditorPythonScripting.set_keep_python_script_alive(True)
 u.EditorLoadingAndSavingUtils.new_blank_map(False);world=u.get_editor_subsystem(u.UnrealEditorSubsystem).get_editor_world()
 u.SystemLibrary.execute_console_command(world,'fx.Niagara.ForceWaitForCompilationOnActivate 0')
 u.SystemLibrary.execute_console_command(world,'r.PSOPrecaching 0')
 capture=u.EditorLevelLibrary.spawn_actor_from_class(u.SceneCapture2D,u.Vector(0,-900,60));capture.set_actor_rotation(u.MathLibrary.find_look_at_rotation(capture.get_actor_location(),u.Vector(0,0,0)),False)
 captureComponent=capture.get_component_by_class(u.SceneCaptureComponent2D);target=u.RenderingLibrary.create_render_target2d(world,1280,720,u.TextureRenderTargetFormat.RTF_RGBA8,u.LinearColor(0,0,0,1),False)
 prop(captureComponent,texture_target=target,capture_every_frame=False,capture_on_movement=False,capture_source=u.SceneCaptureSource.SCS_FINAL_COLOR_LDR,fov_angle=50.)
 settings=[]
 for name in ['Niagara','Particles','Translucency','SeparateTranslucency','Materials']:
  flag=u.EngineShowFlagsSetting();prop(flag,show_flag_name=name,enabled=True);settings.append(flag)
 prop(captureComponent,show_flag_settings=settings)
 light=u.EditorLevelLibrary.spawn_actor_from_class(u.PointLight,u.Vector(100,-250,300));light.get_component_by_class(u.PointLightComponent).set_intensity(80000.);light.get_component_by_class(u.PointLightComponent).set_attenuation_radius(2000.)
 profiles=json.loads((ROOT/'profiles.json').read_text())['profiles'];keys=list(profiles)+[list(profiles)[0]]
 for path in u.EditorAssetLibrary.list_assets('/JsGameBridge/HardBurn/VFX/Materials',False,False):u.EditorAssetLibrary.load_asset(path)
 warmupUntil=time.monotonic()+20
 for key in keys:
  # Capture early and expanded stages for each category, plus late heavy cooling.
  times=[.025] if profiles[key]['category']=='weapon' else [.08] if profiles[key]['category']=='plume' else [.15] if profiles[key]['category']=='venting' else [.025]
  if profiles[key].get('heavy'):times.extend([.75])
  for age in times:queue.append((key,age))
 def tick(delta):
  global frame,stage,component,current,niagaraActor
  try:
   if time.monotonic()-started>600:raise RuntimeError('Preview timed out')
   frame+=1
   if frame<30 or time.monotonic()<warmupUntil:return
   if stage==0:
    if not queue:finish();return
    key,age=queue.pop(0);current=(key,age);p=profiles[key];u.log('HBVFX loading '+key);system=u.EditorAssetLibrary.load_asset('/JsGameBridge/HardBurn/VFX/Systems/NS_'+key.replace('.','_')+'_r3')
    if not system:raise RuntimeError('Missing saved system '+key)
    u.log('HBVFX loaded '+key)
    # An editor capture needs a visible actor owner; SpawnSystemAtLocation uses
    # editor-hidden WorldSettings, which incorrectly hides valid effects in this harness.
    niagaraActor=u.EditorLevelLibrary.spawn_actor_from_class(u.NiagaraActor,u.Vector(0,0,0))
    component=niagaraActor.get_component_by_class(u.NiagaraComponent);component.set_asset(system)
    if not component:raise RuntimeError('Cannot spawn '+key)
    owner=component.get_owner()
    if owner:owner.set_actor_hidden_in_game(False);owner.set_is_temporarily_hidden_in_editor(False)
    # Defaults must be visible; only these two keys also exercise dynamic seating.
    if p['category'] in ['weapon','plume']:component.set_variable_float('User.WidthCm',max(5.,p['widthPx']*1.2));component.set_variable_float('User.LengthCm',max(60.,p['lengthPx']*3))
    component.set_hidden_in_game(False);component.set_hidden_in_scene_capture(False);component.set_visibility(True);component.set_rendering_enabled(True);component.set_system_fixed_bounds(u.Box(u.Vector(-3000,-3000,-3000),u.Vector(3000,3000,3000)));component.set_force_solo(True);u.log('HBVFX activate '+key);component.activate(True);u.log('HBVFX activated '+key+' active='+str(component.is_active()));stage=2;frame=0
   elif stage==2 and frame>=30:
    key,age=current;system=component.get_asset();u.log('HBVFX simulate '+key);component.activate(True);component.advance_simulation(max(1,round(age*60)),1/60)
    report['lastActivation']={'key':key,'active':component.is_active(),'forceSolo':component.get_force_solo(),'visible':component.is_visible(),'hiddenGame':component.get_editor_property('hidden_in_game'),'hiddenCapture':component.get_editor_property('hidden_in_scene_capture')}
    cache=u.NiagaraSimCacheFunctionLibrary.create_niagara_sim_cache(world);result=u.NiagaraSimCacheFunctionLibrary.capture_niagara_sim_cache_immediate(cache,u.NiagaraSimCacheCreateParameters(),component,False,1/60)
    if result is None:
     if frame<300:return
     raise RuntimeError('Simulation cache failed '+key)
    counts={str(name):len(cache.read_position_attribute('Position',name,False,0)) for name in cache.get_emitter_names()}
    detail={}
    for n in cache.get_emitter_names():
     detail[str(n)]={'size':[str(v) for v in cache.read_vector2_attribute('SpriteSize',n,0)],'color':[str(v) for v in cache.read_color_attribute('Color',n,0)],'age':list(cache.read_float_attribute('NormalizedAge',n,0)),'position':[str(v) for v in cache.read_position_attribute('Position',n,False,0)]}
    if not sum(counts.values()):raise RuntimeError('No living particles '+key+' at '+str(age))
    row={'key':key,'age':age,'asset':system.get_path_name(),'class':system.get_class().get_name(),'particles':counts,'frames':cache.get_num_frames(),'attributes':detail,'camera':str(capture.get_actor_location()),'cameraRotation':str(capture.get_actor_rotation())};report['systems'].append(row)
    component.set_paused(True);component.set_render_in_main_pass(False);component.set_render_in_main_pass(True);stage=3;frame=0;tick.renderReady=time.monotonic()+2
   elif stage==3 and frame>=3 and time.monotonic()>=tick.renderReady:
    key,age=current;u.log('HBVFX render '+key);captureComponent.capture_scene();u.log('HBVFX rendered '+key);stage=1;frame=0
   elif stage==1 and frame>=3:
    key,age=current;name=key.replace('.','_')+'_'+str(round(age*100)).zfill(3)+'.png';u.RenderingLibrary.export_render_target(world,target,str(OUT),name)
    report['captures'].append({'key':key,'age':age,'file':name})
    component.set_paused(False);component.advance_simulation(max(1,math.ceil((profiles[key]['life']+.6-age)*60)),1/60)
    if component.is_active():raise RuntimeError('Finite system did not finish '+key)
    report['systems'][-1]['finiteCompletion']=True
    u.EditorLevelLibrary.destroy_actor(niagaraActor);niagaraActor=None;component=None;stage=0;frame=30
    (OUT/'report.json').write_text(json.dumps(report,indent=2))
  except:finish(traceback.format_exc())
 handle=u.register_slate_post_tick_callback(tick)
except:finish(traceback.format_exc())
