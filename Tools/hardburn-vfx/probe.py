import unreal as u,json,traceback
from pathlib import Path
r={"ok":False}
try:
 fx=u.FXConverterUtilitiesLibrary
 r["fx"]=dir(fx)
 r["scriptContext"]=dir(fx.create_script_context(u.CreateScriptContextArgs(fx.create_asset_data('/Niagara/DynamicInputs/TypeConversions/MakeVector2D.MakeVector2D'))))
 r["system"]=dir(u.NiagaraSystem)
 r["component"]=dir(u.NiagaraComponent)
 r["library"]=dir(u.NiagaraFunctionLibrary)
 r["properties"]={}
 for name in ['NiagaraSpriteRendererProperties','NiagaraMeshRendererProperties','NiagaraSystem','NiagaraLightRendererProperties']:
  obj=getattr(u,name)();r['properties'][name]=dir(obj)
 r['ok']=True
except:r['error']=traceback.format_exc();u.log_error(r['error'])
finally:
 Path('G:/hb-vfx-unreal/Reports/probe.json').write_text(json.dumps(r,indent=2));u.SystemLibrary.quit_editor()
