/** `three` for the Unreal target: the real library as the scene graph and math library, with the
 *  WebGL renderer replaced by the Unreal stand-in. Imports of 'three' resolve here at build time. */
export * from 'three-real';
export {UnrealRenderer as WebGLRenderer} from './renderer';
