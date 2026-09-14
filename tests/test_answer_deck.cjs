const vm=require('node:vm'),fs=require('node:fs'),assert=require('node:assert/strict'),path=require('node:path');
const source=fs.readFileSync(path.join(__dirname,'../public/app.js'),'utf8');
let time=1000;const handlers={},view={},answers=[{id:10},{id:20},{id:30}],counter={},footer={},up={},down={};
const pages=answers.map(()=>({setAttribute(){}}));
const deck={clientHeight:400,isConnected:true,querySelectorAll:()=>pages,scrollTo({top}){this.scrollTop=top;},addEventListener(type,fn){handlers[type]=fn;}};
const app={querySelector(s){if(s==='.answer-deck')return deck;if(s==='.answer-flow-count')return counter;if(s==='.answer-flow-bottom')return footer;return s.includes('-1')?up:down;}};
let aiLoads=[];
const ctx=vm.createContext({clearTimeout(){},kanshanPollTimer:0,loadKanshanPage:(id,opts)=>aiLoads.push(opts.start),app,clamp:(x,a,b)=>Math.min(b,Math.max(a,x)),performance:{now:()=>time},matchMedia:()=>({matches:true}),saveDetailView(){},answerFlowFooter:()=>'',ResizeObserver:class{observe(){}},answerDeckResize:null});
vm.runInContext(source.slice(source.indexOf('function bindAnswerDeck('),source.indexOf('function applyAISnapshot')),ctx);
ctx.bindAnswerDeck({id:1},view,answers,0);assert.equal(deck.scrollTop,0);
function wheel(reader=null,delta=40){let blocked=false;handlers.wheel({deltaY:delta,deltaX:0,target:{closest:()=>reader},preventDefault(){blocked=true;}});return blocked;}
assert(wheel());assert.equal(view.answerId,20);assert.equal(deck.scrollTop,400);
time+=30;wheel();assert.equal(view.answerId,20,'momentum must not skip another answer');
time+=1000;assert(!wheel({scrollHeight:1000,clientHeight:300,scrollTop:20}));assert.equal(view.answerId,20,'long answer must scroll before advancing');
time+=1000;wheel();assert.equal(view.answerId,30);assert.equal(deck.scrollTop,800);
time+=1000;wheel();assert.equal(view.answerId,30,'last answer must stay in bounds');
time+=1000;wheel(null,-40);assert.equal(view.answerId,20);
function swipe(delta,reader=null,type='touch'){
 time+=1000;const target={closest:s=>s==='.answer-reader'?reader:null};
 const e={pointerId:1,pointerType:type,isPrimary:true,button:0,clientX:100,clientY:200,target,preventDefault(){}};
 handlers.pointerdown(e);handlers.pointermove({...e,clientY:200-delta});handlers.pointerup({...e,clientY:200-delta});
}
swipe(60);assert.equal(view.answerId,30,'up swipe advances');
swipe(-60);assert.equal(view.answerId,20,'down swipe returns');
swipe(-60,null,'mouse');assert.equal(view.answerId,10,'desktop dragging also returns');
swipe(-60);assert.equal(view.answerId,10,'first answer stays in bounds');
for(let i=0;i<20;i++){swipe(40);assert.equal(view.answerId,20);swipe(-40);assert.equal(view.answerId,10);}
const reader={scrollHeight:1000,clientHeight:300,scrollTop:0};
swipe(60,reader);assert.equal(reader.scrollTop,60);assert.equal(view.answerId,10,'long text scrolls first');
reader.scrollTop=695;swipe(60,reader);assert.equal(reader.scrollTop,700);assert.equal(view.answerId,20,'remaining edge swipe advances');
time+=1000;const pointer={pointerId:2,isPrimary:true,button:0,clientX:100,clientY:200,target:{closest:()=>null},preventDefault(){}};
handlers.pointerdown(pointer);handlers.pointermove({...pointer,clientY:150});handlers.pointercancel();handlers.pointerup({...pointer,clientY:150});assert.equal(view.answerId,20,'canceled pointer cannot flip');
handlers.pointerdown(pointer);handlers.pointermove({...pointer,clientX:200,clientY:180});handlers.pointerup({...pointer,clientY:180});assert.equal(view.answerId,20,'horizontal gesture cannot flip');
swipe(40);let prevented=false;handlers.click({preventDefault(){prevented=true;},stopPropagation(){}});assert(prevented,'swiping over a followup must not activate its click');
console.log('Answer deck: bidirectional pointer swipes, 20 cycles, desktop drag, long text, cancellation, bounds and click suppression passed.');

const selection=vm.createContext({});
vm.runInContext(source.slice(source.indexOf('function detailAnswers('),source.indexOf('function answerActionIcon(')),selection);
const withAI=selection.detailAnswers({answers},{answerStage:'working'});assert.equal(withAI.length,4);assert.equal(withAI[3].id,'kanshan');assert.equal(selection.detailAnswers({answers:[]}).length,0);
assert(!source.slice(source.indexOf('function renderDetail('),source.indexOf('function bindAnswerDeck(')).includes('detail-stage-filter'));
console.log('Detail includes all answers regardless of previous stage selection.');

const full=[...answers,{id:'kanshan',ai_page:true}];
ctx.bindAnswerDeck({id:1},view,full,2);assert.equal(aiLoads.length,0,'rendering the last human answer never generates');
swipe(60);assert.equal(view.answerId,'kanshan');assert.equal(aiLoads.length,1);assert.equal(aiLoads[0],true);
swipe(60);assert.equal(view.answerId,'kanshan');assert.equal(aiLoads.length,1,'cannot swipe to a second AI page');
swipe(-60);assert.equal(view.answerId,30);ctx.bindAnswerDeck({id:1},view,full,3);assert.equal(aiLoads.at(-1),false,'restoring AI page only reads');
console.log('Final AI page: explicit entry starts, restoration reads, one-page boundary and return passed.');
