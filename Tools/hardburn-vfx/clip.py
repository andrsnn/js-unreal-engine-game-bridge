"""Short before/after clip from real saved Niagara systems; no game host or gameplay."""
import unreal as u,json,time,traceback
from pathlib import Path
OUT=Path('C:/UnlitWorldsCaptures/judge/hardburn-vfx-native/raw-clip');OUT.mkdir(parents=True,exist_ok=True)
report={'ok':False,'kind':'isolated saved Niagara first draft versus registered r2 systems; shared final materials','segments':[]};handle=None;actors=[];components=[];stage=0;frame=0;segment=0;wait=0;started=time.monotonic()
shots=[('explosion.capital',90),('explosion.reactor',90),('nuclear',120),('plume.main',60)]
def prop(obj,**kw):
 for key,value in kw.items():obj.set_editor_property(key,value)
def finish(error=None):
 global handle
 report['ok']=error is None;report['seconds']=time.monotonic()-started
 if error:report['error']=error;u.log_error(error)
 (OUT.parent/'native-clip-report.json').write_text(json.dumps(report,indent=2))
 if handle:u.unregister_slate_post_tick_callback(handle);handle=None
 u.EditorPythonScripting.set_keep_python_script_alive(False);u.SystemLibrary.quit_editor()
try:
 u.EditorPythonScripting.set_keep_python_script_alive(True);u.EditorLoadingAndSavingUtils.new_blank_map(False);world=u.get_editor_subsystem(u.UnrealEditorSubsystem).get_editor_world()
 u.SystemLibrary.execute_console_command(world,'fx.Niagara.ForceWaitForCompilationOnActivate 0');u.SystemLibrary.execute_console_command(world,'r.PSOPrecaching 0')
 captures=[];targets=[]
 for x in [-500,500]:
  actor=u.EditorLevelLibrary.spawn_actor_from_class(u.SceneCapture2D,u.Vector(x,-850,60));actor.set_actor_rotation(u.MathLibrary.find_look_at_rotation(actor.get_actor_location(),u.Vector(x,0,0)),False)
  cap=actor.get_component_by_class(u.SceneCaptureComponent2D);target=u.RenderingLibrary.create_render_target2d(world,960,1080,u.TextureRenderTargetFormat.RTF_RGBA8,u.LinearColor(0,0,0,1),False)
  flags=[]
  for name in ['Niagara','Particles','Translucency','SeparateTranslucency','Materials']:
   flag=u.EngineShowFlagsSetting();prop(flag,show_flag_name=name,enabled=True);flags.append(flag)
  prop(cap,texture_target=target,capture_every_frame=False,capture_on_movement=False,capture_source=u.SceneCaptureSource.SCS_FINAL_COLOR_LDR,fov_angle=50.,show_flag_settings=flags)
  light=u.EditorLevelLibrary.spawn_actor_from_class(u.PointLight,u.Vector(x+100,-250,300));lc=light.get_component_by_class(u.PointLightComponent);lc.set_intensity(12000.);lc.set_attenuation_radius(1200.)
  captures.append(cap);targets.append(target)
 for asset in u.EditorAssetLibrary.list_assets('/JsGameBridge/HardBurn/VFX/Materials',False,False):u.EditorAssetLibrary.load_asset(asset)
 ready=time.monotonic()+20
 def tick(delta):
  global stage,frame,segment,wait,ready,actors,components
  try:
   if time.monotonic()-started>240:raise RuntimeError('Clip timeout')
   if time.monotonic()<ready:return
   if stage==0:
    if segment==len(shots):finish();return
    key,frames=shots[segment];actors=[];components=[];base='NS_'+key.replace('.','_')
    for x,suffix in [(-500,''),(500,'_r2')]:
     system=u.EditorAssetLibrary.load_asset('/JsGameBridge/HardBurn/VFX/Systems/'+base+suffix)
     if not system:raise RuntimeError('Missing clip asset '+base+suffix)
     actor=u.EditorLevelLibrary.spawn_actor_from_class(u.NiagaraActor,u.Vector(x,0,0));comp=actor.get_component_by_class(u.NiagaraComponent);comp.set_asset(system);comp.set_hidden_in_game(False);comp.set_hidden_in_scene_capture(False);comp.set_force_solo(True);comp.set_system_fixed_bounds(u.Box(u.Vector(-3000,-3000,-3000),u.Vector(3000,3000,3000)))
     if key=='plume.main':comp.set_variable_float('User.WidthCm',22.);comp.set_variable_float('User.LengthCm',180.)
     actors.append(actor);components.append(comp)
    for i,cap in enumerate(captures):cap.clear_hidden_components();cap.hide_actor_components(actors[1-i])
    report['segments'].append({'key':key,'frames':frames,'before':components[0].get_asset().get_path_name(),'after':components[1].get_asset().get_path_name()});frame=0;stage=1;ready=time.monotonic()+1;return
   if stage==1:
    key,frames=shots[segment]
    if frame==frames:
     for actor in actors:u.EditorLevelLibrary.destroy_actor(actor)
     actors=[];components=[];segment+=1;stage=0;return
    for comp in components:
     comp.set_paused(False)
     if frame==0 or (key=='plume.main' and frame%3==0):comp.activate(True)
     comp.advance_simulation(2,1/60);comp.set_paused(True)
    for cap in captures:cap.capture_scene()
    wait=3;stage=2;return
   if stage==2:
    wait-=1
    if wait>0:return
    for i,target in enumerate(targets):u.RenderingLibrary.export_render_target(world,target,str(OUT),('left' if i==0 else 'right')+'-'+str(segment)+'-'+str(frame).zfill(4)+'.png')
    frame+=1;stage=1
  except:finish(traceback.format_exc())
 handle=u.register_slate_post_tick_callback(tick)
except:finish(traceback.format_exc())
