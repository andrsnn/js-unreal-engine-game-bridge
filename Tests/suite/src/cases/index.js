// Every case of the conformance suite, by the name used in ?case=<name>.
import hooks from './hooks.js';
import textures from './textures.js';
import ktx2 from './ktx2.js';
import {basics, materials, transparency, lines, billboards, shadows, fog, fogExp2, ortho} from './scenes.js';
import {instances, batched, churn, skinning, gltf, postprocess, motion} from './dynamic.js';
import {ui, input, timers, audio} from './page.js';

export const cases = {basics, materials, textures, ktx2, transparency, lines, billboards, shadows, fog, fogExp2, ortho, instances, batched, churn, motion, skinning, gltf, postprocess, hooks, ui, input, timers, audio};
