# Prints a material's expressions and what feeds each input, for debugging generated graphs.
# Run: UnrealEditor-Cmd.exe <project> -run=pythonscript -script="G:/JsGameBridge/Tools/materials/inspect_material.py /JsGameBridge/Mirror/M_JsgbBillboardAdd"
import sys
import unreal

path = sys.argv[-1] if len(sys.argv) > 1 and sys.argv[-1].startswith('/') else '/JsGameBridge/Mirror/M_JsgbBillboardAdd'
mat = unreal.load_asset(path)
MEL = unreal.MaterialEditingLibrary
unreal.log_warning(f'INSPECT {path}: {mat}')
for prop in [unreal.MaterialProperty.MP_WORLD_POSITION_OFFSET, unreal.MaterialProperty.MP_EMISSIVE_COLOR, unreal.MaterialProperty.MP_OPACITY]:
    node = MEL.get_material_property_input_node(mat, prop)
    unreal.log_warning(f'INSPECT property {prop}: {node.get_name() if node else None}')
for expr in MEL.get_material_expressions(mat) if hasattr(MEL, 'get_material_expressions') else []:
    line = f'INSPECT {expr.get_name()} {expr.get_class().get_name()}'
    for attr in ['parameter_name', 'use_custom_primitive_data', 'primitive_data_index', 'code', 'coordinate_index']:
        try:
            line += f' {attr}={expr.get_editor_property(attr)!r}'[:400]
        except Exception:
            pass
    try:
        for i, inp in enumerate(MEL.get_inputs_for_material_expression(mat, expr)):
            line += f' in{i}={inp.get_name() if inp else None}'
    except Exception as e:
        line += f' (inputs: {e})'
    unreal.log_warning(line)
