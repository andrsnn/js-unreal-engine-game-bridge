import unreal as u,json,traceback
from pathlib import Path
ROOT=Path('G:/JsGameBridge/Tools/hardburn-vfx');report={'ok':False,'systems':[]};actor=None
try:
 world=u.get_editor_subsystem(u.UnrealEditorSubsystem).get_editor_world();u.SystemLibrary.execute_console_command(world,'Editor.AsyncAssetCompilationFinishAll')
 report['api']={'capture':u.NiagaraSimCacheFunctionLibrary.capture_niagara_sim_cache_immediate.__doc__,'positions':u.NiagaraSimCache.read_position_attribute.__doc__,'spawn':u.NiagaraFunctionLibrary.spawn_system_at_location.__doc__,'users':u.NiagaraFunctionLibrary.get_all_user_parameters.__doc__}
 keys=json.loads((ROOT/'only-keys.json').read_text()) if (ROOT/'only-keys.json').exists() else list(json.loads((ROOT/'profiles.json').read_text())['profiles'])
 for key in keys:
  path='/JsGameBridge/HardBurn/VFX/Systems/NS_'+key.replace('.','_');system=u.EditorAssetLibrary.load_asset(path)
  if not system:raise RuntimeError('Missing '+path)
  row={'key':key,'class':system.get_class().get_name(),'asset':system.get_path_name(),'emitters':[str(x) for x in u.NiagaraFunctionLibrary.get_all_emitters(system)],'users':[str(x) for x in u.NiagaraFunctionLibrary.get_all_user_parameters(system)]};report['systems'].append(row)
  comp=u.NiagaraFunctionLibrary.spawn_system_at_location(world,system,u.Vector(0,0,0),u.Rotator(0,0,0),u.Vector(1,1,1),False,True,u.NCPoolMethod.NONE,False)
  comp.set_variable_vec3('User.AxisLocal',u.Vector(0,0,1));comp.advance_simulation(6,1/60)
  cache=u.NiagaraSimCacheFunctionLibrary.create_niagara_sim_cache(world)
  result=u.NiagaraSimCacheFunctionLibrary.capture_niagara_sim_cache_immediate(cache,u.NiagaraSimCacheCreateParameters(),comp,False,1/60)
  row['captureResult']=str(result);row['frames']=cache.get_num_frames();row['particles']={}
  for name in cache.get_emitter_names():row['particles'][str(name)]=len(cache.read_position_attribute('Position',name,False,0))
  row['active']=comp.is_active();comp.destroy_component();u.SystemLibrary.collect_garbage()
  if sum(row['particles'].values())<=0:raise RuntimeError('No particles: '+key)
 report['ok']=True
except:report['error']=traceback.format_exc();u.log_error(report['error'])
finally:
 Path('G:/hb-vfx-unreal/Reports/validate.json').write_text(json.dumps(report,indent=2));u.SystemLibrary.quit_editor()
