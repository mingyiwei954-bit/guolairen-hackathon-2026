/* Authentication is isolated from the feed/composer implementation. */
(() => {
 let auth = {authenticated:false,configured:false,user:null};
 const main = document.getElementById('app');
 const root = document.querySelector('.phone');
 function updateLabel() {
  const button=main.querySelector('.bottom-tab-bar [data-action="profile"]');
  if(!button)return;
  const label=auth.authenticated?'我的':'未登录';
  const span=button.querySelector('span'); if(span && span.textContent!==label)span.textContent=label;
  if(button.getAttribute('aria-label')!==label)button.setAttribute('aria-label',label);
 }
 function profile() {
  if(!auth.authenticated)return;
  if(state.screen==='feed')captureFeedView();
  ++state.request;cleanupAIPoll();controls(false);state.screen='profile';
  const user=auth.user;
  main.innerHTML=`${bar('我的')}<section class="form-screen"><div class="oauth-person">${user.avatar?`<img src="${escape(user.avatar)}" alt="" referrerpolicy="no-referrer">`:''}<h2>${escape(user.name)}</h2><p class="helper">已通过知乎登录 · 问答仍以阶段自述展示</p></div><form id="profile-form"><label for="profile-stage">我的浏览阶段</label><select id="profile-stage" name="stage">${options(state.user.stage)}</select><button class="primary-button" type="submit">保存我的阶段</button></form><button class="secondary-button" type="button" data-oauth="logout">退出登录</button></section>`;
  main.scrollTop=0;
 }
 root.addEventListener('click',async event=>{
  const button=event.target.closest('button');if(!button)return;
  if(button.dataset.action==='profile') {
   event.preventDefault();event.stopImmediatePropagation();
   try {auth=await api('/auth/me');}catch(_){notice('登录服务暂时不可用，仍可继续浏览');return;}
   if(auth.authenticated){profile();return;}
   if(!auth.configured){notice('知乎登录尚未配置，仍可继续浏览');return;}
   if(state.screen==='feed')captureFeedView();
   location.assign('/api/auth/start');
  }
  if(button.dataset.oauth==='logout') {
   event.preventDefault();event.stopImmediatePropagation();button.disabled=true;
   try {
    const response=await fetch('/api/auth/logout',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'});
    if(!response.ok)throw Error('logout');
    Object.keys(sessionStorage).filter(key=>key.startsWith(STORAGE_PREFIX)).forEach(key=>sessionStorage.removeItem(key));location.assign('/?login=logout');
   }catch(_){button.disabled=false;notice('退出失败，请稍后重试');}
  }
 },true);
 new MutationObserver(updateLabel).observe(main,{childList:true,subtree:true});
 async function init() {
  try {auth=await api('/auth/me');updateLabel();}catch(_){return;}
  const result=new URL(location.href).searchParams.get('login');if(!result)return;
  const clean=new URL(location.href);clean.searchParams.delete('login');history.replaceState(null,'',clean.pathname+clean.search+clean.hash);
  const messages={success:'知乎登录成功',logout:'已退出登录',cancelled:'已取消知乎授权，可以继续浏览',invalid:'登录请求已过期或失效，请重新登录',failed:'知乎登录暂时失败，请重试',unavailable:'知乎登录尚未配置'};
  notice(messages[result]||'请重新发起登录');
  // Wait only for the existing app bootstrap, never resend authorization.
  if(result==='success' && auth.authenticated){
   for(let i=0;i<40;i++){
    if(state.user && main.querySelector('.app-shell,.composer-screen,.detail-screen')){profile();return;}
    await new Promise(resolve=>setTimeout(resolve,100));
   }
  }
 }
 init();
})();
