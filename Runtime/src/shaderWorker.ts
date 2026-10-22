import {newShaderFrame, translateShaderMaterial} from './shaders';
const g = globalThis as any;
let jobs = Promise.resolve();
g.onmessage = ({data}: {data: any}) => {
  jobs = jobs.then(async () => {
    const started = Date.now();
    let result;
    try {
      do {
        newShaderFrame();
        result = translateShaderMaterial(data.material, data.instanced);
        if (result === undefined) await new Promise(resolve => setTimeout(resolve, 2));
      } while (result === undefined);
    } catch (error) {
      g.console.warn('shader translation failed: ' + error); result = null;
    }
    g.postMessage({key: data.key, result, ms: Date.now() - started});
  });
};
