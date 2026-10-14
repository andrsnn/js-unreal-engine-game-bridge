// Every case of the conformance suite, by the name used in ?case=<name>.
import hooks from './hooks.js';
import streaks from './streaks.js';
import dustbox from './dustbox.js';
import backdrop from './backdrop.js';
import studio from './studio.js';
import textures from './textures.js';
import ktx2 from './ktx2.js';
import {basics, materials, transparency, lines, billboards, shadows, fog, fogExp2, ortho} from './scenes.js';
import {instances, batched, churn, skinning, gltf, postprocess, motion, volume} from './dynamic.js';
import {ui, input, timers, audio, forms} from './page.js';

export const cases = {basics, materials, textures, ktx2, transparency, lines, billboards, shadows, fog, fogExp2, ortho, instances, batched, churn, motion, skinning, gltf, postprocess, volume, hooks, streaks, dustbox, backdrop, studio, ui, forms, input, timers, audio};
