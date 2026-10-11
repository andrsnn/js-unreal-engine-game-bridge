/** `three` for the Unreal target: the real library as the scene graph and math library, with the
 *  WebGL renderer replaced by the Unreal stand-in. Imports of 'three' resolve here at build time. */
export * from 'three-real';
export {UnrealRenderer as WebGLRenderer} from './renderer';

// With a fixed seed, the game's first import of three starts the seeded sequence where a browser's would be once its
// bundle has loaded: re-seeded, then past the ids that WebGLRenderer's module-level objects take there (counted at
// build time, Tools/jsgb.mjs). The runtime's own objects created earlier don't shift the game's numbers.
declare const __JSGB_WEBGL_MODULE_DRAWS__: number;
const seeded = globalThis as {__jsgbReseed?: () => void};
if (seeded.__jsgbReseed) { seeded.__jsgbReseed(); for (let i = 0; i < __JSGB_WEBGL_MODULE_DRAWS__; i++) Math.random(); }
