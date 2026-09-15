const vm=require('node:vm'),fs=require('node:fs'),assert=require('node:assert/strict');
const source=fs.readFileSync(require('node:path').join(__dirname,'../public/app.js'),'utf8');
const view={kanshanOpened:false,kanshanSnapshot:{status:'completed',answer:'已有回答 <script> 😀'}};
const section={innerHTML:''};let calls=[],pending;
const ctx=vm.createContext({Date,Math,Array,Promise,setTimeout(fn,ms){if(ms<1000)fn();return 1;},clearTimeout(){},kanshanPollTimer:0,state:{screen:'detail',detail:{id:1}},detailView:()=>view,app:{querySelector:()=>section},newClientTurnId:()=> 'test-request',escape:t=>String(t).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;'),refreshDogHTML:()=>'<svg></svg>',api:async(url,body)=>{calls.push(body);return pending?await pending:{status:'completed',answer:'已有回答 <script> 😀',sources:[]};}});
vm.runInContext(source.slice(source.indexOf('function kanshanRevealHTML'),source.indexOf('function answerFlowFooter')),ctx);
(async()=>{
 assert.match(ctx.kanshanSectionHTML(view),/问问看山/);assert(!ctx.kanshanSectionHTML(view).includes('已有回答'),'cached answer stays collapsed');
 view.kanshanOpened=true;await ctx.loadKanshanPage(1,{start:true});
 assert.equal(calls.length,1);assert.equal(calls[0],undefined,'saved answer only needs a read');assert.match(section.innerHTML,/kanshan-ink/);assert.match(section.innerHTML,/&lt;script&gt;/);assert(!section.innerHTML.includes('<script>'));
 await ctx.loadKanshanPage(1);assert(!section.innerHTML.includes('class="kanshan-ink"'),'same result does not replay on polling');
 view.kanshanBusy=true;assert.match(ctx.kanshanSectionHTML(view),/kanshan-thinking/);assert(!ctx.kanshanSectionHTML(view).includes('已有回答'),'waiting state does not leak prior answer');view.kanshanBusy=false;
 view.kanshanSnapshot={status:'running'};view.kanshanError='等待超时';assert.match(ctx.kanshanSectionHTML(view),/查看生成结果/,'timeout keeps recovery action visible');view.kanshanError='';
 let resolve;pending=new Promise(r=>resolve=r);const flight=ctx.loadKanshanPage(1);view.kanshanRequest++;view.kanshanOpened=false;section.innerHTML='new visit';resolve({status:'completed',answer:'stale'});await flight;assert.equal(section.innerHTML,'new visit','old request cannot reopen a new visit');
 const encoded=ctx.kanshanRevealHTML('🙂'.repeat(40));assert.equal((encoded.match(/🙂/gu)||[]).length,40,'unicode characters preserved');
 console.log('Kanshan: collapsed cache, explicit read, safe text reveal, no replay, centered busy state and stale-request isolation passed.');
})().catch(error=>{console.error(error);process.exitCode=1});
