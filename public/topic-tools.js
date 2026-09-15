/* Official Zhihu content search gives context for a user-selected topic. */
(() => {
 let request=0;
 document.addEventListener('click',async event=>{
  const button=event.target.closest('[data-action="search-zhihu-topics"]');if(!button)return;
  event.preventDefault();event.stopImmediatePropagation();
  const input=document.getElementById('answer-topic-search'),results=document.getElementById('answer-topic-results');
  if(!input||!results)return;
  const query=input.value.trim().replace(/^#+/,'');
  if(query.length<2||query.length>40){results.textContent='请输入 2–40 字的话题关键词';return;}
  const ticket=++request;button.disabled=true;results.textContent='正在检索知乎相关内容…';
  try{
   const result=await api('/zhihu/topics?q='+encodeURIComponent(query));
   if(ticket!==request||!results.isConnected)return;
   const items=(result.items||[]).filter(item=>/^https?:\/\//.test(item.url||''));
   results.innerHTML=items.length?`<p class="topic-search-label">知乎相关内容</p>${items.slice(0,6).map(item=>`<a class="topic-search-result" href="${escape(item.url)}" target="_blank" rel="noopener noreferrer">${escape(item.name)} <span>↗</span></a>`).join('')}`: `<p class="topic-search-label">${['empty','success','completed','ok'].includes(result.status)?'没有找到相关内容，可以直接添加这个话题。':'知乎检索暂不可用，可以直接添加这个话题。'}</p>`;
  }catch(_){if(results.isConnected)results.textContent='知乎检索暂不可用，可以直接添加这个话题。';}
  finally{if(button.isConnected)button.disabled=false;}
 },true);
})();
