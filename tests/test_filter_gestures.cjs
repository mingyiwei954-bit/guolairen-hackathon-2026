const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict'),path=require('node:path');
const source=fs.readFileSync(path.join(__dirname,'../public/app.js'),'utf8');
const block=source.slice(source.indexOf('function cleanupFilterControls()'),source.indexOf('let answerDeckResize=null;'));
function fixture(initial=0){
 let now=1000,serial=0;const handlers={},timers=new Map(),frames=new Map(),classes=new Set();
 const stack={classList:{contains:k=>classes.has(k),add:k=>classes.add(k),remove:k=>classes.delete(k)},style:{setProperty(){}},setAttribute(){},removeAttribute(){},getBoundingClientRect:()=>({height:49}),closest:()=>({style:{setProperty(){}}})};
 const viewport={scrollTop:500,scrollHeight:1600,clientHeight:400,addEventListener:(t,f)=>handlers[t]=f,removeEventListener:t=>delete handlers[t]};
 const ctx=vm.createContext({app:{querySelector:s=>s==='.feed-viewport'?viewport:stack},FILTER_SCROLL_JITTER:1.75,FILTER_DIRECTION_CONFIRM:5,FILTER_FADE_DISTANCE:210,
 filterVisibilityProgress:initial,filterViewport:null,filterStack:null,filterScrollCleanup:null,filterFrame:0,filterLastScrollTop:0,
 clamp:(x,a,b)=>Math.min(b,Math.max(a,x)),performance:{now:()=>now},matchMedia:()=>({matches:true}),
 setTimeout:fn=>{const id=++serial;timers.set(id,fn);return id;},clearTimeout:id=>timers.delete(id),
 requestAnimationFrame:fn=>{const id=++serial;frames.set(id,fn);return id;},cancelAnimationFrame:id=>frames.delete(id)});
 vm.runInContext(block,ctx);ctx.bindFilterControls();
 const drain=map=>{for(const [id,fn] of [...map]){map.delete(id);fn(now);}};
 return {ctx,viewport,handlers,stack,classes,
  settle(){drain(timers);drain(frames);drain(frames);},
  wheel(delta,gap=20){now+=gap;handlers.wheel({deltaY:delta,deltaX:0,deltaMode:0,ctrlKey:false});},
  scroll(delta){viewport.scrollTop+=delta;handlers.scroll();drain(frames);},
  touchStart(){handlers.touchstart({touches:[{clientY:200,clientX:100}]});},
  touchMove(y){handlers.touchmove({touches:[{clientY:y,clientX:100}]});},
  touchEnd(){handlers.touchend();}
 };
}
let f=fixture();
for(let i=0;i<15;i++){f.wheel(-14);f.scroll(-14);}
f.settle();assert.equal(f.ctx.filterVisibilityProgress,0,'many wheel/scroll events from one gesture remain hidden');
f.wheel(-30,300);f.scroll(-30);f.settle();assert.equal(f.ctx.filterVisibilityProgress,1,'second distinct upward gesture reveals');assert(!f.classes.has('is-hidden'));
f.wheel(40,300);f.scroll(40);f.settle();assert.equal(f.ctx.filterVisibilityProgress,0);assert(f.stack.inert);
f.wheel(-30,300);f.scroll(-30);f.settle();assert.equal(f.ctx.filterVisibilityProgress,0,'first return after hiding holds');
f.wheel(30,300);f.scroll(30);f.settle();f.wheel(-30,300);f.scroll(-30);f.settle();assert.equal(f.ctx.filterVisibilityProgress,0,'opposite motion resets streak');
f.wheel(-30,300);f.settle();assert.equal(f.ctx.filterVisibilityProgress,1,'second gesture reveals even at scroll boundary');
f=fixture();f.touchStart();f.touchMove(220);f.touchMove(250);f.touchMove(280);f.touchEnd();f.settle();assert.equal(f.ctx.filterVisibilityProgress,0,'one touch stroke counts once');
f.touchStart();f.touchMove(225);f.touchEnd();f.settle();assert.equal(f.ctx.filterVisibilityProgress,1,'two separate touch strokes reveal');
f=fixture(.4);f.wheel(-30,300);f.settle();assert.equal(f.ctx.filterVisibilityProgress,0,'first return finishes hiding a partially collapsed bar');
f=fixture();f.scroll(-90);f.scroll(-90);f.settle();assert.equal(f.ctx.filterVisibilityProgress,0,'programmatic scroll does not count');
f.wheel(-2,300);f.settle();f.wheel(-2,300);f.settle();assert.equal(f.ctx.filterVisibilityProgress,0,'tiny strokes never reveal');
f=fixture();const key=(repeat=false)=>f.handlers.keydown({key:'ArrowUp',repeat,target:{closest:()=>null}});
key();key(true);key(true);f.settle();assert.equal(f.ctx.filterVisibilityProgress,0,'key repeat stays one gesture');key();f.settle();assert.equal(f.ctx.filterVisibilityProgress,1);
f=fixture();f.wheel(-30,300);f.wheel(-30,300);f.ctx.cleanupFilterControls();f.settle();assert.equal(f.ctx.filterVisibilityProgress,0,'leaving screen cancels pending reveal');assert.equal(Object.keys(f.handlers).length,0);
console.log('Filter gestures: separate strokes, inertia grouping, reversal reset, jitter, keyboard, top boundary, restoration and cleanup passed.');
