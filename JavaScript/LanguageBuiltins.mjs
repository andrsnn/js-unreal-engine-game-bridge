// ES built-ins absent from the Puerts V8 9.4 runtime. No game rules.
const define=(prototype,key,value)=>{if(!prototype[key])Object.defineProperty(prototype,key,{value,writable:true,configurable:true});};
export function installLanguageBuiltins(){
 define(Array.prototype,'toSorted',function(compare){return Array.from(this).sort(compare);});
 define(Array.prototype,'toReversed',function(){return Array.from(this).reverse();});
 define(Array.prototype,'findLast',function(predicate,thisArg){if(typeof predicate!=='function')throw new TypeError('predicate must be callable');for(let i=this.length-1;i>=0;i--)if(predicate.call(thisArg,this[i],i,this))return this[i];});
 define(Array.prototype,'findLastIndex',function(predicate,thisArg){if(typeof predicate!=='function')throw new TypeError('predicate must be callable');for(let i=this.length-1;i>=0;i--)if(predicate.call(thisArg,this[i],i,this))return i;return -1;});
 define(Object,'hasOwn',function(object,key){return Object.prototype.hasOwnProperty.call(object,key);});
}
installLanguageBuiltins();
