'use strict';
const list=document.querySelector('#items'),status=document.querySelector('#status'),more=document.querySelector('#more');
let page=1,query='',ticket=0;
function element(tag,text){const el=document.createElement(tag);el.textContent=text;return el;}
async function load(reset=false){
 const current=++ticket;more.disabled=true;
 if(reset){page=1;list.replaceChildren();}
 status.textContent='正在读取资料…';
 try{
  const response=await fetch('/api/library/items?'+new URLSearchParams({q:query,page:String(page),page_size:'20'}));
  if(!response.ok)throw new Error('资料暂时无法读取');
  const data=await response.json();if(current!==ticket)return;
  for(const item of data.items){
   const article=document.createElement('article'),source=item.source||{};
   article.append(element('h2',item.title||'来源资料'),element('p',item.excerpt||''));
   article.append(element('small',[source.author?.name||'作者未提供',source.content_role==='fiction'?'故事 · 虚构作品':source.content_role==='community'?'知乎社区':'知识资料',source.content_scope==='summary'?'来源摘要':'来源片段',...(item.topics||[])].join(' · ')));
   try{const url=new URL(source.url);if(['https:','http:'].includes(url.protocol)&&!url.username&&!url.password){const a=element('a',url.hostname==='api.zhihu.com'?'查看官方来源记录 ↗':'阅读原始来源 ↗');a.href=url.href;a.target='_blank';a.rel='noopener noreferrer';a.className='source-link';article.append(document.createElement('br'),a);}}catch{}
   const detail=document.createElement('details'),summary=element('summary','展开已收录内容'),body=element('p','');detail.append(summary,body);
   detail.addEventListener('toggle',async()=>{if(!detail.open||detail.dataset.loaded)return;detail.dataset.loaded='loading';body.textContent='正在读取…';try{const r=await fetch('/api/library/items/'+item.id);if(!r.ok)throw new Error();const value=await r.json();body.textContent=value.body||'暂无正文';detail.dataset.loaded='true';}catch{body.textContent='暂时无法读取，请收起后重试';delete detail.dataset.loaded;}});article.append(detail);
   list.append(article);
  }
  status.textContent=`${query?'匹配到':'已收录'} ${data.total} 条来源资料 · 已展示 ${list.children.length} 条`;
  more.hidden=page*20>=data.total;
 }catch(error){if(current===ticket)status.textContent='资料暂时无法读取，请稍后搜索重试。';}
 finally{if(current===ticket)more.disabled=false;}
}
document.querySelector('form').addEventListener('submit',event=>{event.preventDefault();query=new FormData(event.currentTarget).get('q').trim();load(true);});
more.addEventListener('click',()=>{page++;load();});load(true);
