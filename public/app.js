'use strict';
const app = document.getElementById('app');
const phone = document.querySelector('.phone');
const state = { user: null, mode: 'older', stage: 'all', feed: [], allowed: [], detail: null, screen: 'feed', request: 0 };
const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const stageName = id => state.user?.stages.find(s => s.id === id)?.label || id;
let noticeTimer;
const FILTER_FADE_DISTANCE = 70;
const FILTER_SCROLL_JITTER = 1.75;
const FILTER_DIRECTION_CONFIRM = 5;
let filterVisibilityProgress = 1;
let filterViewport = null;
let filterStack = null;
let filterScrollCleanup = null;
let filterFrame = 0;
let filterAdjustFrame = 0;
let filterLayoutAdjusting = false;
let filterLastScrollTop = 0;
let filterActiveDirection = 0;
let filterCandidateDirection = 0;
let filterCandidateDistance = 0;
let filterCollapsedHeight = 0;
function notice(message) { const n = document.getElementById('notice'); n.textContent = message; n.classList.add('visible'); clearTimeout(noticeTimer); noticeTimer = setTimeout(() => n.classList.remove('visible'), 3200); }
async function api(path, data) { const response = await fetch('/api' + path, { method: data === undefined ? 'GET' : 'POST', headers: data === undefined ? {} : {'Content-Type':'application/json'}, body: data === undefined ? undefined : JSON.stringify(data) }); const result = await response.json(); if (!response.ok) throw new Error(result.error || '暂时无法连接，请重试'); return result; }
function clamp(value, min, max) { return Math.min(max, Math.max(min, value)); }
function cleanupFilterControls() {
 if (filterScrollCleanup) filterScrollCleanup();
 if (filterFrame) cancelAnimationFrame(filterFrame);
 if (filterAdjustFrame) cancelAnimationFrame(filterAdjustFrame);
 filterViewport = null; filterStack = null; filterScrollCleanup = null;
 filterFrame = 0; filterAdjustFrame = 0; filterLayoutAdjusting = false;
}
function compensateFilterLayout(delta, minimumScrollTop = 0, baseScrollTop = filterViewport?.scrollTop || 0) {
 if (!filterViewport || !delta) return;
 const maxScroll = Math.max(0, filterViewport.scrollHeight - filterViewport.clientHeight);
 const lowerBound = Math.min(maxScroll, minimumScrollTop);
 const nextScrollTop = clamp(baseScrollTop + delta, lowerBound, maxScroll);
 filterLayoutAdjusting = true;
 filterViewport.scrollTop = nextScrollTop;
 filterLastScrollTop = nextScrollTop;
 if (filterAdjustFrame) cancelAnimationFrame(filterAdjustFrame);
 filterAdjustFrame = requestAnimationFrame(() => {
  filterAdjustFrame = 0; filterLayoutAdjusting = false;
  if (filterViewport) filterLastScrollTop = clamp(filterViewport.scrollTop, 0, Math.max(0, filterViewport.scrollHeight - filterViewport.clientHeight));
 });
}
function applyFilterVisibility() {
 filterFrame = 0;
 if (!filterStack || !filterViewport) return;
 const progress = clamp(filterVisibilityProgress, 0, 1);
 if (progress > 0 && filterStack.classList.contains('is-collapsed')) {
  const restoreHeight = filterCollapsedHeight;
  const scrollTopBeforeRestore = filterViewport.scrollTop;
  filterStack.classList.remove('is-collapsed');
  filterStack.removeAttribute('aria-hidden');
  filterStack.style.setProperty('--filter-progress', '0');
  filterStack.style.setProperty('--filter-offset', '-7px');
  void filterStack.offsetHeight;
  compensateFilterLayout(restoreHeight, 0, scrollTopBeforeRestore);
 }
 filterStack.style.setProperty('--filter-progress', progress.toFixed(4));
 filterStack.style.setProperty('--filter-offset', `${(-7 * (1 - progress)).toFixed(2)}px`);
 if (progress === 0 && !filterStack.classList.contains('is-collapsed')) {
  filterCollapsedHeight = filterStack.getBoundingClientRect().height;
  const scrollTopBeforeCollapse = filterViewport.scrollTop;
  filterStack.classList.add('is-collapsed');
  filterStack.setAttribute('aria-hidden', 'true');
  compensateFilterLayout(-filterCollapsedHeight, FILTER_DIRECTION_CONFIRM + FILTER_SCROLL_JITTER, scrollTopBeforeCollapse);
 }
}
function queueFilterVisibility() {
 if (!filterFrame) filterFrame = requestAnimationFrame(applyFilterVisibility);
}
function bindFilterControls() {
 cleanupFilterControls();
 filterViewport = app.querySelector('.feed-viewport');
 filterStack = app.querySelector('.filter-controls-stack');
 if (!filterViewport || !filterStack) return;
 filterLastScrollTop = clamp(filterViewport.scrollTop, 0, Math.max(0, filterViewport.scrollHeight - filterViewport.clientHeight));
 filterActiveDirection = 0; filterCandidateDirection = 0; filterCandidateDistance = 0;
 filterCollapsedHeight = filterStack.getBoundingClientRect().height;
 filterStack.style.setProperty('--filter-progress', filterVisibilityProgress.toFixed(4));
 filterStack.style.setProperty('--filter-offset', `${(-7 * (1 - filterVisibilityProgress)).toFixed(2)}px`);
 if (filterVisibilityProgress === 0) {
  filterStack.classList.add('is-collapsed');
  filterStack.setAttribute('aria-hidden', 'true');
 }
 const onScroll = () => {
  if (!filterViewport) return;
  const rawScrollTop = filterViewport.scrollTop;
  const maxScroll = Math.max(0, filterViewport.scrollHeight - filterViewport.clientHeight);
  if (rawScrollTop < 0 || rawScrollTop > maxScroll + 2) return;
  const currentScrollTop = clamp(rawScrollTop, 0, maxScroll);
  const delta = currentScrollTop - filterLastScrollTop;
  filterLastScrollTop = currentScrollTop;
  if (filterLayoutAdjusting || Math.abs(delta) < FILTER_SCROLL_JITTER) return;
  if (Math.abs(delta) > Math.max(240, filterViewport.clientHeight * .75)) {
   filterActiveDirection = 0; filterCandidateDirection = 0; filterCandidateDistance = 0;
   return;
  }
  const direction = delta > 0 ? -1 : 1;
  let distance = Math.abs(delta);
  if (direction !== filterActiveDirection) {
   if (direction !== filterCandidateDirection) { filterCandidateDirection = direction; filterCandidateDistance = 0; }
   filterCandidateDistance += distance;
   if (filterCandidateDistance < FILTER_DIRECTION_CONFIRM) return;
   filterActiveDirection = direction;
   distance = filterCandidateDistance;
   filterCandidateDirection = 0; filterCandidateDistance = 0;
  } else {
   filterCandidateDirection = 0; filterCandidateDistance = 0;
  }
  filterVisibilityProgress = clamp(filterVisibilityProgress + direction * distance / FILTER_FADE_DISTANCE, 0, 1);
  queueFilterVisibility();
 };
 const boundViewport = filterViewport;
 boundViewport.addEventListener('scroll', onScroll, {passive:true});
 filterScrollCleanup = () => boundViewport.removeEventListener('scroll', onScroll);
}
function controls(show) { app.classList.toggle('feed-mode', show); if (!show) cleanupFilterControls(); }
function bottomTabBarHTML() { return `<nav class="bottom-tab-bar" aria-label="主导航"><button data-action="home" class="current" aria-current="page" aria-label="首页"><svg class="tab-icon tab-icon-home" viewBox="2 3 20 19" aria-hidden="true" focusable="false"><path d="M3.2 10.1 11 4.25a1.65 1.65 0 0 1 2 0l7.8 5.85v9.05a1.75 1.75 0 0 1-1.75 1.75H4.95a1.75 1.75 0 0 1-1.75-1.75Z" fill="currentColor"/><path d="M12 14.5v4" fill="none" stroke="#fff" stroke-linecap="round" stroke-width="1.8"/></svg><span>首页</span></button><button data-action="unavailable" data-label="看山" aria-label="看山"><svg class="tab-icon tab-icon-mountain" viewBox="2.5 4.5 19 18.5" aria-hidden="true" focusable="false"><path d="M5.2 20.15c-1.3-1.12-1.6-3.15-1.27-5.25l1.16-7.72c.22-1.48 1.93-2.08 3-1.04l1.96 1.92A9.4 9.4 0 0 1 12 7.85c.67 0 1.32.07 1.95.21l1.96-1.92c1.07-1.04 2.78-.44 3 1.04l1.16 7.72c.33 2.1.03 4.13-1.27 5.25-1.32 1.14-3.65 1.35-6.8 1.35s-5.48-.21-6.8-1.35Z" fill="none" stroke="currentColor" stroke-linejoin="round" stroke-width="1.8"/><circle cx="9.25" cy="14.25" r="1.05" fill="currentColor"/><circle cx="14.75" cy="14.25" r="1.05" fill="currentColor"/></svg><span>看山</span></button><button class="ask-entry" data-action="ask" aria-label="提出一个问题"><svg class="tab-create-icon" viewBox="0 0 42 32" aria-hidden="true" focusable="false"><rect width="42" height="32" rx="16" fill="currentColor"/><path d="M21 10v12M15 16h12" fill="none" stroke="#fff" stroke-linecap="round" stroke-width="2"/></svg></button><button data-action="unavailable" data-label="消息" aria-label="消息"><svg class="tab-icon tab-icon-message" viewBox="1.5 3 21 18" aria-hidden="true" focusable="false"><rect x="3" y="5" width="18" height="14" rx="3.8" fill="none" stroke="currentColor" stroke-width="1.8"/><circle cx="9" cy="12" r="1.15" fill="currentColor"/><circle cx="15" cy="12" r="1.15" fill="currentColor"/></svg><span>消息</span></button><button data-action="profile" aria-label="未登录，设置我的阶段"><svg class="tab-icon tab-icon-profile" viewBox="2 2 20 20" aria-hidden="true" focusable="false"><circle cx="12" cy="12" r="8.7" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M9 14.35c.78.82 1.78 1.23 3 1.23s2.22-.41 3-1.23" fill="none" stroke="currentColor" stroke-linecap="round" stroke-width="1.7"/></svg><span>未登录</span></button></nav>`; }
function bar(title) { return `<div class="screen-bar"><button data-action="back">← 返回</button><span>${escape(title)}</span><span></span></div>`; }
function answerFooterHTML(a, qid, detail = false) { return `<footer class="answer-footer"><button data-action="vote" data-id="${a.id}" data-voted="${!!a.voted}" class="${a.voted ? 'voted' : ''}" aria-label="${a.voted ? '取消赞同' : '赞同回答'}" aria-pressed="${!!a.voted}">${a.voted ? '♥' : '♡'} <span>${a.votes}</span></button>${detail ? '<span>来自这一程的声音</span>' : `<button data-action="detail" data-id="${qid}">听听其他回答 ↗</button>`}</footer>`; }
function answerHTML(a, qid, detail = false) { return `<div class="answer-meta"><span class="answer-line"></span><span>${escape(stageName(a.stage))} · 自述</span></div><p class="answer-text">${escape(a.body)}</p>${answerFooterHTML(a, qid, detail)}`; }
function feedAnswerHTML(a, qid) { return `<div class="answer-section"><div class="answer-tags" aria-label="回答标签">${a.stage ? `<span class="stage-tag">${escape(stageName(a.stage))} · 自述</span>` : ''}</div><div class="answer-content"><p class="answer-text">${escape(a.body)}</p></div></div>${answerFooterHTML(a, qid)}`; }
function cardHTML(q) { return `<article class="qa-card qa-feed-card"><div class="question-section"><div class="question-content"><h2>${escape(q.title)}</h2></div><div class="question-tags" aria-label="问题标签">${q.stage ? `<span class="stage-tag">${escape(stageName(q.stage))}</span>` : ''}${q.target ? `<span class="target-stage-tag">想听${escape(stageName(q.target))}</span>` : ''}</div></div>${q.answer ? feedAnswerHTML(q.answer, q.id) : `<div class="answer-section"><div class="answer-tags" aria-hidden="true"></div><div class="answer-content"><p class="empty-answer">这一程的声音，还在路上。<br>暂时没有所选阶段的回答。</p></div></div><footer class="answer-footer"><span>等待一个新视角</span><button data-action="detail" data-id="${q.id}">去回答 ↗</button></footer>`}</article>`; }
function renderFeed() {
 cleanupFilterControls();
 filterVisibilityProgress = 1;
 state.screen = 'feed'; controls(true);
 app.innerHTML = `<div class="app-shell"><header class="top-navigation-group"><div class="search-bar" role="search" aria-label="社区搜索"><span class="search-placeholder"><span class="search-icon" aria-hidden="true"></span>搜索你感兴趣的问题</span><button type="button" data-action="search">搜索</button></div><nav class="channel-tabs" aria-label="内容频道"><button data-action="unavailable" data-label="推荐">推荐</button><button data-action="unavailable" data-label="热榜">热榜</button><button data-action="unavailable" data-label="故事">故事</button><button data-action="unavailable" data-label="知识">知识</button><button data-action="home" class="active" aria-current="page">过来人</button><button data-action="unavailable" data-label="关注">关注</button></nav></header><div class="filter-controls-stack" role="group" aria-label="内容筛选"><section class="direction-layer"><div class="direction-switch" aria-label="浏览方向"><button data-action="mode" data-value="older" class="${state.mode === 'older' ? 'selected' : ''}" aria-pressed="${state.mode === 'older'}">听过来人说</button><button data-action="mode" data-value="younger" class="${state.mode === 'younger' ? 'selected' : ''}" aria-pressed="${state.mode === 'younger'}">听没过来人说</button></div></section><section class="stage-filter-layer"><div class="stage-filter" aria-label="回答者阶段筛选"><div class="chips"><button data-action="filter" data-value="all" class="${state.stage === 'all' ? 'active' : ''}" aria-pressed="${state.stage === 'all'}">全部</button>${state.allowed.map(id => `<button data-action="filter" data-value="${id}" class="${state.stage === id ? 'active' : ''}" aria-pressed="${state.stage === id}">${escape(stageName(id))}</button>`).join('')}</div></div></section></div><section class="feed-viewport" aria-label="问答内容流" tabindex="0"><div class="feed-heading"><span>所选阶段 · 高赞优先</span><small>独立体验版</small></div>${state.feed.length ? state.feed.map(cardHTML).join('') : '<div class="empty-state">这一边暂时还没有回声。<br>换一个方向，或先留下你的问题。</div>'}</section>${bottomTabBarHTML()}</div>`;
 bindFilterControls();
}
async function loadFeed() { const ticket = ++state.request; const data = await api(`/feed?mode=${state.mode}&stage=${state.stage}`); if (ticket !== state.request) return; state.feed = data.items; state.allowed = data.allowed_stages; renderFeed(); app.scrollTop = 0; }
function options(selected) { return state.user.stages.map(s => `<option value="${s.id}" ${s.id === selected ? 'selected' : ''}>${escape(s.label)}</option>`).join(''); }
function showProfile() { ++state.request; state.screen = 'profile'; controls(false); app.innerHTML = `${bar('我的阶段')}<section class="form-screen"><h2>你正走到哪一程？</h2><p class="helper">用阶段认识彼此，不用头衔定义彼此。<br>阶段由你自己选择，会随问题和回答一起显示。</p><form id="profile-form"><label for="profile-stage">我目前的阶段</label><select id="profile-stage" name="stage">${options(state.user.stage)}</select><p class="helper">体验版按求学、工作、退休的顺序组织浏览方向，不代表经验或能力的高低。默认阶段为大学，可随时修改。</p><button class="primary-button" type="submit">保存我的阶段</button></form><p class="helper">当前使用本浏览器的访客身份保存操作，尚未接入知乎账号。</p></section>`; app.scrollTop = 0; }
function showAsk() { ++state.request; state.screen = 'ask'; controls(false); app.innerHTML = `${bar('留下一个问题')}<section class="form-screen"><h2>向另一程，问个好。</h2><p class="helper">此刻的你是「${escape(stageName(state.user.stage))}」。一个小问题，也可以打开一个新视角。</p><form id="ask-form"><label for="question-title">你想问什么？</label><textarea id="question-title" name="title" required maxlength="100" placeholder="比如：你最近最快乐的一件事，是什么？"></textarea><label for="question-target">最想听哪个阶段的人回答？</label><select id="question-target" name="target">${options(state.stage !== 'all' ? state.stage : state.allowed[0] || 'working')}</select><label for="question-body">再说一点背景（选填）</label><textarea id="question-body" name="body" maxlength="1000" placeholder="帮助对方理解，你为什么想问这个问题。"></textarea><button class="primary-button" type="submit">把问题送出去 ↗</button></form></section>`; app.scrollTop = 0; }
async function showDetail(id) { const ticket = ++state.request; const q = await api('/questions/' + id); if (ticket !== state.request) return; state.detail = q; state.screen = 'detail'; controls(false); app.innerHTML = `${bar('这一问，听大家说')}<article class="qa-card"><div class="question-meta"><span class="stage-tag">${escape(stageName(q.stage))}</span><span>想听 · ${escape(stageName(q.target))}</span></div><h2>${escape(q.title)}</h2>${q.body ? `<p class="question-body">${escape(q.body)}</p>` : ''}</article><div class="detail-actions"><button class="primary-button" data-action="answer">说说我的看法</button></div><div class="section-caption">全部阶段的回答 · 按赞同数排列 · ${q.answers.length} 条</div>${q.answers.length ? q.answers.map(a => `<article class="qa-card">${answerHTML(a, q.id, true)}</article>`).join('') : '<div class="empty-state">还没有人回答。你的经历，也许能带来第一个新视角。</div>'}`; app.scrollTop = 0; }
function showAnswer() { ++state.request; const q = state.detail; state.screen = 'answer'; controls(false); app.innerHTML = `${bar('说说我的看法')}<section class="form-screen"><h2>${escape(q.title)}</h2><p class="helper">你的回答将带上「${escape(stageName(state.user.stage))} · 自述」标签。分享亲身感受就好。</p><form id="answer-form"><label for="answer-body">从你所在的这一程看呢？</label><textarea id="answer-body" name="body" required maxlength="1200" placeholder="不用标准答案，说说你自己的经历。"></textarea><button class="primary-button" type="submit">留下我的回答</button></form></section>`; app.scrollTop = 0; }
phone.addEventListener('click', async event => {
 const b = event.target.closest('button[data-action]'); if (!b || b.disabled) return;
 try {
  const action = b.dataset.action;
  if (action === 'home') return await loadFeed();
  if (action === 'search') return notice('搜索尚未接入体验版，先从过来人问答逛起吧');
  if (action === 'unavailable') return notice(`${b.dataset.label || '这个入口'}尚未接入体验版`);
  if (action === 'profile') return showProfile();
  if (action === 'ask') return showAsk();
  if (action === 'answer') return showAnswer();
  if (action === 'back') return await (state.screen === 'answer' ? showDetail(state.detail.id) : loadFeed());
  if (action === 'mode') { state.mode = b.dataset.value; state.stage = 'all'; return await loadFeed(); }
  if (action === 'filter') { state.stage = b.dataset.value; return await loadFeed(); }
  if (action === 'detail') return await showDetail(Number(b.dataset.id));
  if (action === 'retry') return await boot();
  if (action === 'vote') { b.disabled = true; const result = await api('/vote', {answer_id:Number(b.dataset.id), active:b.dataset.voted !== 'true'}); b.dataset.voted = String(result.voted); b.classList.toggle('voted', result.voted); b.setAttribute('aria-pressed', String(result.voted)); b.setAttribute('aria-label', result.voted ? '取消赞同' : '赞同回答'); b.innerHTML = `${result.voted ? '♥' : '♡'} <span>${result.votes}</span>`; }
 } catch (e) { notice(e.message); } finally { b.disabled = false; }
});
app.addEventListener('submit', async event => {
 event.preventDefault(); const form = event.target; const submit = form.querySelector('[type=submit]'); if (submit.disabled) return; submit.disabled = true;
 const data = Object.fromEntries(new FormData(form));
 try {
  if (form.id === 'profile-form') { const user = await api('/profile', data); state.user.stage = user.stage; state.stage = 'all'; await loadFeed(); notice('阶段已更新'); }
  if (form.id === 'ask-form') { const q = await api('/questions', data); await showDetail(q.id); notice('问题已保存，等一个新视角'); }
  if (form.id === 'answer-form') { await api('/answers', {body:data.body, question_id:state.detail.id}); await showDetail(state.detail.id); notice('回答已保存'); }
 } catch (e) { notice(e.message); } finally { submit.disabled = false; }
});
async function boot() { try { state.user = await api('/me'); await loadFeed(); } catch (e) { controls(false); app.innerHTML = `<div class="empty-state"><p>${escape(e.message)}</p><button class="secondary-button" data-action="retry">重新连接</button></div>`; } }
const modelContext = document.modelContext;
if (modelContext?.registerTool) {
 const lifecycle = new AbortController();
 const validateEmpty = input => { if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).length) throw new Error('Expected an empty object'); };
 const definitions = [
  {name:'read_visible_feed', description:'Read the question cards currently visible in the feed. No hidden account data.', annotations:{readOnlyHint:true,untrustedContentHint:true}, execute:async input=>{validateEmpty(input);return {screen:state.screen,mode:state.mode,stage:state.stage,items:state.screen==='feed'?state.feed:[]};}},
  {name:'open_question_composer',description:'Open the visible question composer. This does not publish a question.',annotations:{readOnlyHint:false,untrustedContentHint:false},execute:async input=>{validateEmpty(input);if(!state.user)throw new Error('Page is still loading');showAsk();return {screen:state.screen,published:false};}}
 ];
 for (const tool of definitions) {
  try { Promise.resolve(modelContext.registerTool({...tool,inputSchema:{type:'object',properties:{},additionalProperties:false}},{signal:lifecycle.signal})).catch(()=>{}); } catch (_) { /* Optional browser capability. */ }
 }
 window.addEventListener('pagehide',()=>lifecycle.abort(),{once:true});
}
boot();
