const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict'),path=require('node:path');
const source=fs.readFileSync(path.join(__dirname,'../public/app.js'),'utf8');
const block=source.slice(source.indexOf('function cleanupFilterControls()'),source.indexOf('let answerDeckResize=null;'));
function fixture(initial=0,scrollTop=500,reduced=true){
 let now=1000,serial=0;const handlers={},frames=new Map(),classes=new Set(),styles={};
 const stack={classList:{contains:k=>classes.has(k),add:k=>classes.add(k),remove:k=>classes.delete(k)},style:{setProperty(k,v){styles[k]=v;}},setAttribute(){},removeAttribute(){},getBoundingClientRect:()=>({height:49}),closest:()=>({style:{setProperty(){}}})};
 const spacer={style:{height:'49px'},getBoundingClientRect(){return {height:parseFloat(this.style.height)}}};
 const viewport={querySelector:()=>spacer,scrollTop,scrollHeight:1800,clientHeight:400,addEventListener:(t,f)=>handlers[t]=f,removeEventListener:t=>delete handlers[t]};
 const ctx=vm.createContext({app:{querySelector:s=>s==='.feed-viewport'?viewport:stack},
 filterVisibilityProgress:initial,filterViewport:null,filterStack:null,filterScrollCleanup:null,filterFrame:0,filterLastScrollTop:0,
 clamp:(x,a,b)=>Math.min(b,Math.max(a,x)),performance:{now:()=>now},matchMedia:()=>({matches:reduced}),
 requestAnimationFrame:fn=>{const id=++serial;frames.set(id,fn);return id;},cancelAnimationFrame:id=>frames.delete(id)});
 vm.runInContext(block,ctx);ctx.bindFilterControls();
 const frame=ms=>{now+=ms;for(const [id,fn] of [...frames]){frames.delete(id);fn(now);}};
 return {ctx,viewport,handlers,stack,classes,spacer,styles,frame,
  settle(){frame(400);frame(400);},
  wheel(delta,gap=20){now+=gap;handlers.wheel({deltaY:delta,deltaX:0,deltaMode:0,ctrlKey:false});},
  scroll(delta){viewport.scrollTop+=delta;handlers.scroll();},
  touchStart(){handlers.touchstart({touches:[{clientY:200,clientX:100}]});},
  touchMove(y){handlers.touchmove({touches:[{clientY:y,clientX:100}]});},
  touchEnd(){handlers.touchend();}
 };
}
let f=fixture();f.wheel(-.001);f.settle();assert.equal(f.ctx.filterVisibilityProgress,1,'first tiny return reveals without distance threshold');
f=fixture();for(let i=0;i<15;i++){f.wheel(-1);f.scroll(-1);}f.settle();assert.equal(f.ctx.filterVisibilityProgress,1,'one gesture with many events reveals');
f.wheel(.001,300);f.settle();assert.equal(f.ctx.filterVisibilityProgress,0,'downward reversal hides');
f.wheel(-.001);f.settle();assert.equal(f.ctx.filterVisibilityProgress,1,'immediate upward reversal reveals');
f=fixture();f.touchStart();f.touchMove(200.01);f.touchEnd();f.settle();assert.equal(f.ctx.filterVisibilityProgress,1,'single tiny touch stroke reveals');
f=fixture();f.wheel(-20,300);f.wheel(2);f.wheel(-20);f.settle();assert.equal(f.ctx.filterVisibilityProgress,1,'latest direction wins within a stroke');
f=fixture();const key=(repeat=false)=>f.handlers.keydown({key:'ArrowUp',repeat,target:{closest:()=>null}});key();f.settle();assert.equal(f.ctx.filterVisibilityProgress,1,'first keyboard return reveals');key(true);f.settle();assert.equal(f.ctx.filterVisibilityProgress,1);
// Time-based appearance keeps going without more scroll distance or release.
f=fixture(0,500,false);f.wheel(-.1,300);f.frame(120);assert(f.ctx.filterVisibilityProgress>0&&f.ctx.filterVisibilityProgress<1);f.wheel(-.1,20);f.frame(260);assert.equal(f.ctx.filterVisibilityProgress,1,'same-direction input cannot keep restarting appearance');
// Arrival at top beats every pending fade, including momentum and negative overscroll.
for(const initial of [0,.35,1]){
 f=fixture(initial,20,false);f.wheel(20);f.frame(100);f.scroll(-20);assert.equal(f.ctx.filterVisibilityProgress,1);f.frame(600);assert.equal(f.ctx.filterVisibilityProgress,1);assert.equal(f.viewport.scrollTop,0);assert.equal(f.spacer.style.height,'49px');assert.equal(f.styles['--filter-offset'],'0px');
 f.wheel(-.01,300);f.scroll(-5);f.settle();assert.equal(f.ctx.filterVisibilityProgress,1);f.scroll(5);f.settle();assert.equal(f.ctx.filterVisibilityProgress,1);
}
f=fixture(0,0);assert.equal(f.ctx.filterVisibilityProgress,1,'restoring hidden state at top must show');f.wheel(20);f.settle();assert.equal(f.ctx.filterVisibilityProgress,1,'downward intent cannot hide before leaving top');f.scroll(20);f.settle();assert.equal(f.ctx.filterVisibilityProgress,0);
// No scroll mutation, spacer collapse or accumulated drift across repeated cycles.
f=fixture(1);for(let cycle=0;cycle<30;cycle++){
 const before=f.viewport.scrollTop;f.wheel(40,300);f.settle();assert.equal(f.ctx.filterVisibilityProgress,0);assert.equal(f.spacer.style.height,'49px');assert.equal(f.viewport.scrollTop,before);
 f.wheel(-.01,300);f.settle();assert.equal(f.ctx.filterVisibilityProgress,1);assert.equal(f.viewport.scrollTop,before);
}
f=fixture();f.scroll(-20);f.settle();assert.equal(f.ctx.filterVisibilityProgress,0,'non-top programmatic movement does not count');
f=fixture(0,500,false);f.wheel(-20,300);f.ctx.cleanupFilterControls();f.settle();assert.equal(f.ctx.filterVisibilityProgress,0);assert.equal(Object.keys(f.handlers).length,0);
f=fixture(0);f.ctx.revealFeedFilters();assert.equal(f.ctx.filterVisibilityProgress,1,'explicit channel tap reveals');assert.equal(f.ctx.feedEntryView({filterProgress:0,scrollTop:200}).filterProgress,1);
console.log('Filter flow: 30 stable single-return cycles, no distance threshold, time-based fade, top priority, overscroll, no layout drift, channel reveal and cleanup passed.');
