const vm=require('node:vm'),fs=require('node:fs'),assert=require('node:assert/strict'),path=require('node:path');
const source=fs.readFileSync(path.join(__dirname,'../public/app.js'),'utf8');
let time=1000;const handlers={},view={},answers=[{id:10},{id:20},{id:30}],counter={},footer={},up={},down={};
const pages=Array.from({length:4},()=>({style:{},setAttribute(){},getBoundingClientRect:()=>({top:0})}));
const deck={getBoundingClientRect:()=>({top:0}),clientHeight:400,isConnected:true,querySelectorAll:()=>pages,scrollTo({top}){this.scrollTop=top;},addEventListener(type,fn){handlers[type]=fn;}};
const app={querySelector(s){if(s==='.answer-deck'||s==='.answer-flow-shell')return deck;if(s==='.answer-flow-count')return counter;if(s==='.answer-flow-bottom')return footer;return s.includes('-1')?up:down;}};
let aiLoads=[];
const ctx=vm.createContext({clearTimeout(){},kanshanPollTimer:0,loadKanshanPage:(id,opts)=>aiLoads.push(opts.start),app,clamp:(x,a,b)=>Math.min(b,Math.max(a,x)),performance:{now:()=>time},matchMedia:()=>({matches:true}),saveDetailView(){},answerFlowFooter:()=>'',ResizeObserver:class{observe(){}},answerDeckResize:null});
vm.runInContext(source.slice(source.indexOf('function bindAnswerDeck('),source.indexOf('function applyAISnapshot')),ctx);
ctx.bindAnswerDeck({id:1},view,answers,0);assert.equal(pages[0].style.transform,'translate3d(0,0%,0)');
function wheel(reader=null,delta=40){let blocked=false;handlers.wheel({deltaY:delta,deltaX:0,target:{closest:s=>s.startsWith('.answer-reader')?reader:null},preventDefault(){blocked=true;}});return blocked;}
assert(wheel());assert.equal(view.answerId,20);assert.equal(pages[1].style.transform,'translate3d(0,0%,0)');
time+=30;wheel();assert.equal(view.answerId,20,'momentum must not skip another answer');
time+=1000;assert(wheel({scrollHeight:1000,clientHeight:300,scrollTop:20},4));assert.equal(view.answerId,20,'long answer must scroll before advancing');
time+=1000;wheel();assert.equal(view.answerId,30);assert.equal(pages[2].style.transform,'translate3d(0,0%,0)');
time+=1000;wheel();assert.equal(view.answerId,30,'last answer must stay in bounds');
time+=1000;wheel(null,-40);assert.equal(view.answerId,20);
function swipe(delta,reader=null,type='touch',duration=240,gap=1000){
 time+=gap;const target={closest:s=>s.startsWith('.answer-reader')?reader:null};
 const e={pointerId:1,pointerType:type,isPrimary:true,button:0,clientX:100,clientY:200,target,preventDefault(){}};
 handlers.pointerdown(e);time+=duration;handlers.pointermove({...e,clientY:200-delta});handlers.pointerup({...e,clientY:200-delta});
}
swipe(60);assert.equal(view.answerId,30,'up swipe advances');
swipe(-60);assert.equal(view.answerId,20,'down swipe returns');
swipe(-60,null,'mouse');assert.equal(view.answerId,10,'desktop dragging also returns');
swipe(-60);assert.equal(view.answerId,10,'first answer stays in bounds');
for(let i=0;i<20;i++){swipe(40);assert.equal(view.answerId,20);swipe(-40);assert.equal(view.answerId,10);}
const reader={scrollHeight:1000,clientHeight:300,scrollTop:0};
swipe(60,reader);assert.equal(reader.scrollTop,60);assert.equal(view.answerId,10,'long text scrolls first');
reader.scrollTop=695;swipe(60,reader);assert.equal(reader.scrollTop,700);assert.equal(view.answerId,10,'reaching bottom cannot flip in the same gesture');swipe(40,reader);assert.equal(view.answerId,20,'a new gesture at bottom flips once');
time+=1000;const pointer={pointerId:2,isPrimary:true,button:0,clientX:100,clientY:200,target:{closest:()=>null},preventDefault(){}};
handlers.pointerdown(pointer);handlers.pointermove({...pointer,clientY:150});handlers.pointercancel();handlers.pointerup({...pointer,clientY:150});assert.equal(view.answerId,20,'canceled pointer cannot flip');
handlers.pointerdown(pointer);handlers.pointermove({...pointer,clientX:200,clientY:180});handlers.pointerup({...pointer,clientY:180});assert.equal(view.answerId,20,'horizontal gesture cannot flip');
swipe(40);let prevented=false;handlers.click({preventDefault(){prevented=true;},stopPropagation(){}});assert(prevented,'swiping over a followup must not activate its click');
console.log('Answer deck: bidirectional pointer swipes, 20 cycles, desktop drag, long text, cancellation, bounds and click suppression passed.');

const selection=vm.createContext({});
vm.runInContext(source.slice(source.indexOf('function detailAnswers('),source.indexOf('function answerActionIcon(')),selection);
const withAI=selection.detailAnswers({answers},{answerStage:'working'});assert.equal(withAI.length,4);assert.equal(withAI[3].id,'kanshan');assert.equal(selection.detailAnswers({answers:[]}).length,1);
assert(!source.slice(source.indexOf('function renderDetail('),source.indexOf('function bindAnswerDeck(')).includes('detail-stage-filter'));
console.log('Detail includes all answers regardless of previous stage selection.');

const full=[...answers,{id:'kanshan',ai_page:true}];
ctx.bindAnswerDeck({id:1},view,full,2);assert.equal(aiLoads.length,0,'rendering the last human answer never generates');
swipe(60);assert.equal(view.answerId,'kanshan');assert.equal(aiLoads.length,1);assert.equal(aiLoads[0],true);
swipe(60);assert.equal(view.answerId,'kanshan');assert.equal(aiLoads.length,1,'cannot swipe to a second AI page');
swipe(-60);assert.equal(view.answerId,30);ctx.bindAnswerDeck({id:1},view,full,3);assert.equal(aiLoads.at(-1),false,'restoring AI page only reads');
console.log('Final AI page: explicit entry starts, restoration reads, one-page boundary and return passed.');

// The AI boundary uses the same CSS transform transition; resize cannot cancel it.
vm.runInContext("matchMedia=()=>({matches:false})",ctx);
ctx.bindAnswerDeck({id:1},view,full,2);swipe(60);
assert.equal(pages[3].style.transform,'translate3d(0,0%,0)');
assert.equal(pages[2].style.transform,'translate3d(0,-100%,0)');
assert.match(pages[3].style.transition,/260ms/);
assert.equal(pages[2].style.transition,pages[3].style.transition);
deck.clientHeight=226.609375;
assert.equal(pages[3].style.transform,'translate3d(0,0%,0)','fractional viewport resize needs no instant-scroll correction');
swipe(-60);assert.equal(view.answerId,30);assert.match(pages[3].style.transition,/260ms/);
console.log('AI boundary: identical bidirectional animation, fractional responsive heights, no ResizeObserver interruption.');

ctx.bindAnswerDeck({id:1},view,full,2);time+=1000;wheel();assert.equal(view.answerId,'kanshan');
time+=300;wheel(null,-40);assert.equal(view.answerId,30,'a deliberate reverse wheel gesture is not swallowed by the previous transition lock');
console.log('Separate reverse wheel gesture remains responsive.');

// Independent gestures at the same coordinates are not blocked by an animation.
ctx.bindAnswerDeck({id:1},view,full,0);
swipe(28,null,'touch',45,0);assert.equal(view.answerId,20);
swipe(28,null,'touch',45,0);assert.equal(view.answerId,30,'same-position second touch immediately advances');
swipe(-28,null,'touch',45,0);assert.equal(view.answerId,20,'immediate reversal advances in the other direction');

ctx.bindAnswerDeck({id:1},view,full,0);
const longReader={scrollHeight:1600,clientHeight:400,scrollTop:600};
swipe(36,longReader,'touch',60,0);assert.equal(view.answerId,10,'fast flick must read long answer');
assert.equal(longReader.scrollTop,636,'fast movement scrolls content');
swipe(-36,longReader,'touch',60,0);assert.equal(view.answerId,10,'down flick leaves long answer from its middle');
swipe(36,longReader,'touch',400,0);assert.equal(longReader.scrollTop,636);assert.equal(view.answerId,10,'slow dragging still reads long text');

ctx.bindAnswerDeck({id:1},view,full,0);
time+=1000;wheel();assert.equal(view.answerId,20);
time+=300;wheel();assert.equal(view.answerId,30,'a separate wheel burst advances');
time+=15;wheel(null,28);time+=15;wheel(null,16);time+=15;wheel(null,8);
assert.equal(view.answerId,30,'decaying wheel tail does not flip again');
time+=300;wheel(null,40);assert.equal(view.answerId,'kanshan','new impulse after tail advances');

ctx.bindAnswerDeck({id:1},view,full,0);
time+=1000;wheel();time+=35;wheel(null,18);time+=35;wheel(null,8);time+=35;wheel(null,4);
time+=20;wheel(null,32);assert.equal(view.answerId,20,'acceleration cannot rearm the same gesture');

ctx.bindAnswerDeck({id:1},view,full,0);
time+=1000;wheel(longReader,40);assert.equal(view.answerId,10,'wheel flick reads long text regardless of speed');
ctx.bindAnswerDeck({id:1},view,full,0);
time+=1000;wheel(null,2);time+=12;wheel(null,3);assert.equal(view.answerId,10,'tiny wheel noise does not flip');
time+=12;wheel(null,13);assert.equal(view.answerId,20,'small deltas accumulate into a light gesture');

// The whole shell handles title, footer and whitespace gestures, not just the deck.
const bound={};const shell={addEventListener:(name,fn)=>bound[name]=fn};
const originalQuery=app.querySelector;app.querySelector=s=>s==='.answer-flow-shell'?shell:originalQuery(s);
ctx.bindAnswerDeck({id:1},view,full,0);
assert.equal(typeof bound.wheel,'function');assert.equal(typeof bound.pointerdown,'function');
const plain={closest:()=>null};
const headerPointer={pointerId:7,isPrimary:true,button:0,clientX:100,clientY:200,target:plain,preventDefault(){}};
bound.pointerdown(headerPointer);time+=50;bound.pointermove({...headerPointer,clientY:170});
assert.match(pages[0].style.transform,/-30px/,'page follows the finger before release');
bound.pointerup({...headerPointer,clientY:170});assert.equal(view.answerId,20);
bound.pointerdown(headerPointer);time+=50;bound.pointermove({...headerPointer,clientY:170});bound.pointerup({...headerPointer,clientY:170});assert.equal(view.answerId,30,'same-position header gesture repeats');
let suppressed=false;bound.click({preventDefault(){suppressed=true;},stopPropagation(){}});assert(suppressed,'swipe suppresses accidental footer activation');
bound.pointerdown(headerPointer);bound.pointerup(headerPointer);suppressed=false;
bound.click({preventDefault(){suppressed=true;},stopPropagation(){}});assert(!suppressed,'a new deliberate tap remains clickable immediately after a swipe');
bound.pointerdown(headerPointer);time+=50;bound.pointermove({...headerPointer,clientY:230});bound.pointercancel();
assert.equal(view.answerId,30);assert.equal(pages[2].style.transform,'translate3d(0,0%,0)','cancel snaps back');
bound.keydown({target:plain,key:'ArrowUp',preventDefault(){}});bound.keydown({target:plain,key:'ArrowUp',preventDefault(){}});assert.equal(view.answerId,10,'rapid keyboard steps are not animation-locked');
app.querySelector=originalQuery;
console.log('Continuous gestures: same position, rapid repeats/reversals, whole shell, follow-finger, long-text reading, wheel tails, cancel and fresh taps passed.');

ctx.bindAnswerDeck({id:1},view,full,3);
const finalReader={scrollHeight:1200,clientHeight:300,scrollTop:100};
time+=1000;wheel(finalReader,60);assert.equal(view.answerId,'kanshan');assert.equal(finalReader.scrollTop,160,'at final page even a strong outward scroll reads the remaining answer');
swipe(60,finalReader,'touch',100,0);assert.equal(view.answerId,'kanshan');assert.equal(finalReader.scrollTop,220,'at final page a quick outward swipe still reads');
ctx.bindAnswerDeck({id:1},view,full,0);pages[0].getBoundingClientRect=()=>({top:120});
time+=1000;const mid={pointerId:3,isPrimary:true,button:0,clientX:100,clientY:200,target:{closest:()=>null},preventDefault(){}};
handlers.pointerdown(mid);time+=40;handlers.pointermove({...mid,clientY:170});assert.match(pages[0].style.transform,/90px/,'a new drag continues from the in-flight visual position');handlers.pointercancel();
console.log('Page boundaries preserve long reading; interrupted transitions remain continuous.');

ctx.bindAnswerDeck({id:1},view,full,1);
const realisticReader={scrollHeight:1500,clientHeight:300,scrollTop:200};
const gradual={pointerId:4,isPrimary:true,button:0,clientX:100,clientY:200,target:{closest:s=>s.startsWith('.answer-reader')?realisticReader:null},preventDefault(){}};
handlers.pointerdown(gradual);
for(let frame=1;frame<=20;frame++){time+=16;handlers.pointermove({...gradual,clientY:200-frame*5});}
handlers.pointerup({...gradual,clientY:100});assert.equal(view.answerId,20);assert.equal(realisticReader.scrollTop,300,'realistic 16ms slow touch samples read long text');
ctx.bindAnswerDeck({id:1},view,full,0);time+=1000;wheel(null,40);time+=16;wheel(null,28);time+=70;wheel(null,18);time+=70;wheel(null,10);assert.equal(view.answerId,20,'70ms holes in decaying inertia do not restart paging');
ctx.bindAnswerDeck({id:1},view,full,1);realisticReader.scrollTop=200;time+=1000;
for(let frame=0;frame<20;frame++){time+=16;wheel(realisticReader,5);}
assert.equal(view.answerId,20);assert.equal(realisticReader.scrollTop,300,'small sustained wheel deltas read long text');
const css=fs.readFileSync(path.join(__dirname,'../public/style.css'),'utf8');
assert(!/\.answer-flow-shell\{[^}]*touch-action/.test(css),'research chat shell keeps native vertical scrolling');
assert.match(source,/answer-flow-shell\$\{view.aiOpen\?'':' answer-deck-mode'\}/,'gesture mode applies only to answer paging');
console.log('Realistic gradual touch/wheel samples, sparse inertia and native research-chat scrolling passed.');

ctx.bindAnswerDeck({id:1},view,full,1);
const edgeReader={scrollHeight:1000,clientHeight:300,scrollTop:680};
time+=1000;wheel(edgeReader,100);assert.equal(edgeReader.scrollTop,700);assert.equal(view.answerId,20);
for(const delta of [30,8,120,300,20,-80,400]){time+=70;wheel(edgeReader,delta);assert.equal(view.answerId,20,'reading gesture never flips even after reaching edge and accelerating');}
time+=300;wheel(edgeReader,40);assert.equal(view.answerId,30,'new gesture at the edge advances one page');
for(const delta of [400,5,200,-90,1000]){time+=70;wheel(null,delta);assert.equal(view.answerId,30,'one wheel burst can never advance more than one page');}
ctx.bindAnswerDeck({id:1},view,full,2);edgeReader.scrollTop=20;
swipe(-200,edgeReader,'touch',20,0);assert.equal(edgeReader.scrollTop,0);assert.equal(view.answerId,30,'fast drag to top only reads');
swipe(-200,edgeReader,'touch',20,0);assert.equal(view.answerId,20,'lift then drag at top changes one page');
console.log('Strict boundary gestures: speed-independent reading, new gesture required at both edges, one page per burst.');

ctx.bindAnswerDeck({id:1},view,full,1);edgeReader.scrollTop=100;pages[1].querySelector=()=>edgeReader;
swipe(1000,null,'touch',10,0);assert.equal(edgeReader.scrollTop,700);assert.equal(view.answerId,20,'header/footer gestures cannot bypass the active long reader');
swipe(1000,null,'touch',10,0);assert.equal(view.answerId,30,'a second huge gesture at bottom still changes exactly one page');
delete pages[1].querySelector;
