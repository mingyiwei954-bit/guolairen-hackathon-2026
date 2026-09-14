const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict'),path=require('node:path');
const source=fs.readFileSync(path.join(__dirname,'../public/app.js'),'utf8');
const block=source.slice(source.indexOf('let channelRefreshBusy=false'),source.indexOf("phone.addEventListener('click', async event => {"));
function fixture(api) {
 const strips=[];let renders=0;
 const nav={setAttribute(){},removeAttribute(){}};
 const viewport={scrollTop:88};
 const state={screen:'feed',request:0,mode:'older',stage:'all',feed:[{id:99}],allowed:['working']};
 const context=vm.createContext({state,performance:{now:()=>10000},AbortController,api,
  app:{querySelector:()=>nav},matchMedia:()=>({matches:false}),
  setTimeout:(fn,ms)=>ms<1000?setTimeout(fn,1):null,clearTimeout,
  restoreFeedViewport(){},captureFeedView(){},
  renderFeed(){renders++;strips.forEach(s=>s.isConnected=false);},
 });
 vm.runInContext(block,context);
 context.refreshViewport=()=>viewport;
 context.insertRefreshBar=(channel,phase,text)=>{strips.forEach(s=>s.isConnected=false);const bar={isConnected:true,phase,text};strips.push(bar);return bar;};
 context.settleRefreshBar=()=>{};
 return {context,state,strips,get renders(){return renders;}};
}
(async()=>{
 const success=fixture(async()=>({items:[{id:1},{id:2}],allowed_stages:['retired']}));
 await success.context.refreshCurrentChannel('guolairen');
 assert.equal(success.renders,1);assert.equal(success.state.feed.length,2);
 assert.deepEqual(success.strips.map(x=>x.phase),['loading','success']);
 assert(success.strips[1].text.includes('2 条问答'));
 const failure=fixture(async()=>{throw Error('offline')});
 await failure.context.refreshCurrentChannel('guolairen');
 assert.equal(failure.renders,0);assert.equal(failure.state.feed[0].id,99);
 assert.equal(failure.strips.at(-1).phase,'error');
 const timeout=fixture(async()=>{const e=Error('timeout');e.name='AbortError';throw e;});
 await timeout.context.refreshCurrentChannel('guolairen');
 assert(timeout.strips.at(-1).text.includes('超时'));
 let resolve;const cancel=fixture(()=>new Promise(r=>resolve=r));
 const pending=cancel.context.refreshCurrentChannel('guolairen');
 cancel.state.request++;cancel.strips[0].isConnected=false;
 resolve({items:[{id:2}],allowed_stages:[]});await pending;
 assert.equal(cancel.renders,0);assert.equal(cancel.state.feed[0].id,99);assert.equal(cancel.strips.length,1);
 console.log('Refresh workflow: success, failure preservation, timeout and stale-navigation cancellation passed.');
})().catch(e=>{console.error(e);process.exitCode=1;});
