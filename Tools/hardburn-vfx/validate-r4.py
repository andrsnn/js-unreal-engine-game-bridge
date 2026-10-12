"""Fresh CPU Niagara reload/finite check without GPU or host recompilation."""
import unreal as u,json,time,traceback,math
from pathlib import Path
ROOT=Path('G:/JsGameBridge/Tools/hardburn-vfx')
OUT=Path('C:/UnlitWorldsCaptures/judge/hardburn-vfx-expanse-2/native-cpu-proof.json')
report={'ok':False,'scope':'Fresh NullRHI reload and actual CPU Niagara simulation/finite completion. No r4 pixel or whole-native-game acceptance is claimed.','systems':[]}
handle=None;actor=None;component=None;current=None;frame=0;stage=0;started=time.monotonic()
def finish(error=None):
 global handle
 report['ok']=error is None;report['seconds']=time.monotonic()-started
 if error:report['error']=error;u.log_error(error)
 OUT.write_text(json.dumps(report,indent=2))
 if handle:u.unregister_slate_post_tick_callback(handle);handle=None
 u.EditorPythonScripting.set_keep_python_script_alive(False);u.SystemLibrary.quit_editor()
try:
 u.EditorPythonScripting.set_keep_python_script_alive(True)
 u.EditorLoadingAndSavingUtils.new_blank_map(False)
 world=u.get_editor_subsystem(u.UnrealEditorSubsystem).get_editor_world()
 profiles=json.loads((ROOT/'profiles.json').read_text())['profiles'];queue=list(profiles)
 def tick(delta):
  global actor,component,current,frame,stage
  try:
   if time.monotonic()-started>150:raise RuntimeError('CPU probe timed out')
   frame+=1
   if stage==0:
    if not queue:finish();return
    current=queue.pop(0);system=u.EditorAssetLibrary.load_asset('/JsGameBridge/HardBurn/VFX/Systems/NS_'+current.replace('.','_')+'_r4')
    if not system:raise RuntimeError('Missing '+current)
    actor=u.EditorLevelLibrary.spawn_actor_from_class(u.NiagaraActor,u.Vector(0,0,0));component=actor.get_component_by_class(u.NiagaraComponent);component.set_asset(system);component.set_force_solo(True)
    if profiles[current]['category'] in ['weapon','plume']:component.set_variable_float('User.WidthCm',5.);component.set_variable_float('User.LengthCm',60.)
    component.activate(True);stage=1;frame=0
   elif stage==1 and frame>=10:
    p=profiles[current];age=.15 if p['category']=='venting' else 1/30
    component.activate(True);component.advance_simulation(max(1,round(age*60)),1/60)
    cache=u.NiagaraSimCacheFunctionLibrary.create_niagara_sim_cache(world)
    result=u.NiagaraSimCacheFunctionLibrary.capture_niagara_sim_cache_immediate(cache,u.NiagaraSimCacheCreateParameters(),component,False,1/60)
    if result is None:
     if frame<300:return
     raise RuntimeError('No simulation cache '+current)
    counts={str(name):len(cache.read_position_attribute('Position',name,False,0)) for name in cache.get_emitter_names()}
    if not sum(counts.values()):raise RuntimeError('No living CPU particles '+current)
    if any(n in counts for n in ['FireLobe','CoolingGlow','Wave','Halo','Nozzle']):raise RuntimeError('Forbidden emitter '+current)
    component.advance_simulation(math.ceil((p['life']+.6-age)*60),1/60)
    if component.is_active():raise RuntimeError('Unbounded lifetime '+current)
    report['systems'].append({'key':current,'asset':system.get_path_name() if False else component.get_asset().get_path_name(),'particles':counts,'finiteCompletion':True})
    u.EditorLevelLibrary.destroy_actor(actor);actor=None;component=None;stage=0;frame=0
  except:finish(traceback.format_exc())
 handle=u.register_slate_post_tick_callback(tick)
except:finish(traceback.format_exc())
