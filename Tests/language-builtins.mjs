import assert from 'node:assert/strict';
const names=['toSorted','toReversed','findLast','findLastIndex'];
const originals=new Map(names.map(name=>[name,Array.prototype[name]]));
for(const name of names)delete Array.prototype[name];
await import('../JavaScript/LanguageBuiltins.mjs');
const sparse=[3,,1,undefined,2];
for(const name of ['toSorted','toReversed']){
 const result=Array.prototype[name].call(sparse);
 assert.deepEqual(result,originals.get(name).call(sparse));
 assert.equal(1 in sparse,false);assert.equal(result.length,5);
 assert.equal(Object.keys(result).length,5);
}
const visited=[],expected=[];
assert.equal(sparse.findLast((value,index)=>{visited.push([value,index]);return false;}),originals.get('findLast').call(sparse,(value,index)=>{expected.push([value,index]);return false;}));
assert.deepEqual(visited,expected);
assert.equal(sparse.findLastIndex(value=>value===undefined),3);
assert.throws(()=>sparse.findLast(null),TypeError);
assert.equal(Object.getOwnPropertyDescriptor(Array.prototype,'toSorted').enumerable,false);
console.log('PASS old-V8 built-ins: sparse arrays, copy semantics, callback order, non-enumerable methods');
