import decode,{init}from'@jsquash/webp/decode.js';
let initialized;
export function isWebp(bytes:Uint8Array):boolean{return bytes.length>=12&&bytes[0]===82&&bytes[1]===73&&bytes[2]===70&&bytes[3]===70&&bytes[8]===87&&bytes[9]===69&&bytes[10]===66&&bytes[11]===80;}
export async function decodeWebp(bytes:Uint8Array,loadWasm:()=>ArrayBuffer|null){
 if(!initialized){const binary=loadWasm();if(!binary)throw Error('Native WebP decoder is missing');initialized=init(new WebAssembly.Module(binary));}
 await initialized;const result=await decode(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength));
 return {width:result.width,height:result.height,data:new Uint8ClampedArray(result.data)};
}
