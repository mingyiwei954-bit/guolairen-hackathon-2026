const vm=require('node:vm'),fs=require('node:fs'),assert=require('node:assert/strict'),path=require('node:path');
const source=fs.readFileSync(path.join(__dirname,'../public/app.js'),'utf8');
let time=1000;const handlers={},view={},answers=[{id:10},{id:20},{id:30}],counter={},footer={},up={},down={};
const pages=answers.map(()=>({setAttribute(){}}));
const deck={clientHeight:400,isConnected:true,querySelectorAll:()=>pages,scrollTo({top}){this.scrollTop=top;},addEventListener(type,fn){handlers[type]=fn;}};
const app={querySelector(s){if(s==='.answer-deck')return deck;if(s==='.answer-flow-count')return counter;if(s==='.answer-flow-bottom')return footer;return s.includes('-1')?up:down;}};
const ctx=vm.createContext({app,clamp:(x,a,b)=>Math.min(b,Math.max(a,x)),performance:{now:()=>time},matchMedia:()=>({matches:true}),saveDetailView(){},answerFlowFooter:()=>'',ResizeObserver:class{observe(){}},answerDeckResize:null});
vm.runInContext(source.slice(source.indexOf('function bindAnswerDeck('),source.indexOf('function applyAISnapshot')),ctx);
ctx.bindAnswerDeck({id:1},view,answers,0);assert.equal(deck.scrollTop,0);
function wheel(reader=null,delta=40){let blocked=false;handlers.wheel({deltaY:delta,deltaX:0,target:{closest:()=>reader},preventDefault(){blocked=true;}});return blocked;}
assert(wheel());assert.equal(view.answerId,20);assert.equal(deck.scrollTop,400);
time+=30;wheel();assert.equal(view.answerId,20,'momentum must not skip another answer');
time+=1000;assert(!wheel({scrollHeight:1000,clientHeight:300,scrollTop:20}));assert.equal(view.answerId,20,'long answer must scroll before advancing');
time+=1000;wheel();assert.equal(view.answerId,30);assert.equal(deck.scrollTop,800);
time+=1000;wheel();assert.equal(view.answerId,30,'last answer must stay in bounds');
time+=1000;wheel(null,-40);assert.equal(view.answerId,20);
time+=1000;const target={closest:()=>null};handlers.touchstart({touches:[{clientX:100,clientY:200}],target});handlers.touchend({changedTouches:[{clientX:101,clientY:120}]});assert.equal(view.answerId,30);
console.log('Answer deck: wheel snap, inertia lock, long-reader boundary, limits and directional touch passed.');
