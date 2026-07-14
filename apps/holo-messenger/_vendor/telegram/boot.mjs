import { Buffer } from "./m2.mjs";
try { globalThis.Buffer = globalThis.Buffer || Buffer; } catch(e){}
try { globalThis.global = globalThis.global || globalThis; } catch(e){}
try { globalThis.process = globalThis.process || { env:{}, nextTick:(f,...a)=>queueMicrotask(()=>f(...a)), version:"", browser:true }; } catch(e){}
export * from "./m0.mjs";
