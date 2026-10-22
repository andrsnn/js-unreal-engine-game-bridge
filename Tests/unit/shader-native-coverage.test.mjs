import {test} from 'node:test';
import assert from 'node:assert/strict';
import {shaderAssetName, validateShaderCookLog} from '../../Tools/cook-shaders.mjs';
test('native shader coverage uses the host material naming contract', () => {
  assert.equal(shaderAssetName({custom: 'glsl_61bb44a1_adk_l', blending: 1, transparent: false, side: 0}), 'M_glsl_61bb44a1_adk_l_B0');
  assert.equal(shaderAssetName({custom: 'glsl_e2cc5059_y6_i_c_x9103e1_l', blending: 2, transparent: true, side: 2}), 'M_glsl_e2cc5059_y6_i_c_x9103e1_l_B2_2S');
  assert.equal(shaderAssetName({custom: 'x'.repeat(100), transparent: true, side: 1}).length, 93);
});

test('packaging rejects a native material that silently compiled to the default surface', () => {
  const coverage = {M_glsl_surface_B0: {shader: 'glsl_surface'}};
  assert.throws(() => validateShaderCookLog('Warning: Failed to compile Material /Game/JsgbGenerated/M_glsl_surface_B0; Default Material will be used in game.', coverage),
    /Shader glsl_surface did not compile; fix its editor error above and package again/);
  assert.doesNotThrow(() => validateShaderCookLog('Cook complete.', coverage));
});
