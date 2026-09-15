'use strict';
const app = document.getElementById('app');
const phone = document.querySelector('.phone');
const state = {
 user: null, mode: 'older', stage: 'all', feed: [], allowed: [], detail: null,
 screen: 'feed', request: 0, feedReturn: null, composerOrigin: null,
 detailViews: new Map(), aiRequest: 0, demoChannel: null,
 demoScroll: new Map(), kanshanSuggestion: null
};
const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const stageName = id => state.user?.stages.find(s => s.id === id)?.label || id;
const answerKind = answer => (answer?.is_demo ?? answer?.sample) ? '示例' : '自述';
let noticeTimer;
const STORAGE_PREFIX = 'past-voices-v1:';
let filterVisibilityProgress = 1;
let filterViewport = null;
let filterStack = null;
let filterScrollCleanup = null;
let filterLastScrollTop = 0;
let kanshanPollTimer = 0;
let aiPollTimer = 0;
let aiPollStartedAt = 0;
const DEMO_CHANNELS = {
 recommend: {
  label: '推荐',
  items: [
   {title:'毕业后的第一份工作，应该先看成长还是稳定？', excerpt:'把岗位能学到什么、生活成本和风险承受力分别列出来，比寻找唯一的标准答案更有用。', meta:'职业选择 · 示例提问'},
   {title:'成年以后，怎样重新建立稳定的朋友关系？', excerpt:'关系往往不是从一次深聊开始，而是从可以重复的小约定、共同兴趣和可靠回应慢慢长出来。', meta:'人际关系 · 示例提问'},
   {title:'在陌生城市生活，哪些小习惯能带来安全感？', excerpt:'固定一条散步路线、记住附近的店和建立应急联系人，都是把陌生感变成日常感的方法。', meta:'城市生活 · 示例提问'},
   {title:'读中专或职校，如何找到适合自己的成长路径？', excerpt:'先从可验证的小项目和真实岗位要求入手，再决定考证、升学或积累作品，不必一次选定终点。', meta:'学习成长 · 示例提问'},
   {title:'退休后开始一项新爱好，会不会太晚？', excerpt:'兴趣不需要证明效率。能持续带来好奇、连接和身体活动，本身就是值得的开始。', meta:'退休生活 · 示例提问'}
  ]
 },
 hot: {
  label: '热榜',
  items: [
   {title:'第一次独自租房，最容易忽略哪些细节？', excerpt:'从合同、通勤、隔音到水电交接，整理一份入住前检查清单。', meta:'示例序号 · 非实时热榜'},
   {title:'换行业之前，怎样判断是短期倦怠还是方向不合适？', excerpt:'把工作内容、环境和个人状态拆开观察，避免把所有不适归为同一个原因。', meta:'示例序号 · 非实时热榜'},
   {title:'和家人意见不同，怎样把一次争论变成有效沟通？', excerpt:'先确认彼此真正担心的事，再讨论可以共同承担的下一步。', meta:'示例序号 · 非实时热榜'},
   {title:'学习一项新技能时，如何度过最初的挫败期？', excerpt:'缩短练习反馈周期，用完成一个小作品替代反复准备。', meta:'示例序号 · 非实时热榜'},
   {title:'忙碌的时候，怎么保留一点属于自己的时间？', excerpt:'给恢复精力的事情安排最低可执行版本，而不是等待完整空闲。', meta:'示例序号 · 非实时热榜'}
  ]
 },
 story: {
  label: '故事',
  items: [
   {title:'我在凌晨的便利店，学会了不急着评价陌生人', excerpt:'那天雨很大，一个总来买热水的人把伞留给了没带伞的学生。店门合上前，我第一次听见了他的故事。', meta:'虚构片段 · 示例内容'},
   {title:'奶奶第一次使用视频通话', excerpt:'她对着黑下去的屏幕继续说了很久，直到我们再次接通。后来她把每个按钮都写在纸上，贴在桌角。', meta:'虚构片段 · 示例内容'},
   {title:'离职后的第一个普通星期一', excerpt:'我没有去远方，只是在早上九点走进菜市场。摊主问今天不用上班吗，我才意识到新的生活真的开始了。', meta:'虚构片段 · 示例内容'},
   {title:'一封迟到了十年的回信', excerpt:'整理旧书时，我发现当年的地址仍清晰。回信没有解释遗憾，只认真回答了那个少年提出的三个问题。', meta:'虚构片段 · 示例内容'},
   {title:'父亲学会拍照以后', excerpt:'他的相册里没有风景大片，只有每天不同的云、门口新开的花，以及家人回来时亮着的那扇窗。', meta:'虚构片段 · 示例内容'}
  ]
 },
 knowledge: {
  label: '知识',
  items: [
   {title:'沉没成本为什么会影响选择？', excerpt:'已经付出的时间和金钱无法收回，但人很容易继续投入，只为了让过去的投入看起来没有白费。', meta:'概念速览 · 示例内容'},
   {title:'间隔练习为什么比集中突击更容易记住？', excerpt:'把学习分散到多个时间点，并在快要忘记时主动回忆，通常能让记忆线索变得更牢固。', meta:'概念速览 · 示例内容'},
   {title:'什么是社会支持？', excerpt:'它既包括实际帮助，也包括被理解、获得信息和感到自己属于某个群体。不同支持解决的问题并不相同。', meta:'概念速览 · 示例内容'},
   {title:'学习迁移为什么常常没有自动发生？', excerpt:'在一个场景里会做，并不代表能在新场景中识别同一种结构；比较案例和主动解释能帮助迁移。', meta:'概念速览 · 示例内容'},
   {title:'机会成本该怎么理解？', excerpt:'选择一件事时放弃的最佳替代选项，就是这次选择的机会成本。它提醒我们同时看见没有选择的路径。', meta:'概念速览 · 示例内容'}
  ]
 }
};
const KANSHAN_SUGGESTIONS = [
 {question:'换到陌生城市，怎么认识新朋友？', answer:'可以先选一个会重复出现的线下场景，比如固定课程、运动小组或志愿活动。稳定见面比一次热闹更容易建立连接。'},
 {question:'第一份工作最该关注什么？', answer:'可以同时看学习密度、带教反馈、基本生活保障和可承受风险。先明确自己此刻最需要补足的部分。'},
 {question:'周末想培养一个新爱好，怎么开始？', answer:'先选一个两小时内能完成的小体验，再决定是否继续投入。用作品或活动记录进展，比一开始购买全套装备更容易坚持。'},
 {question:'我想听不同阶段的人怎么回答', home:true}
];
function notice(message) { const n = document.getElementById('notice'); n.textContent = message; n.classList.add('visible'); clearTimeout(noticeTimer); noticeTimer = setTimeout(() => n.classList.remove('visible'), 3200); }
class APIError extends Error { constructor(message, status, payload) { super(message); this.status = status; this.payload = payload; } }
async function api(path, data, options = {}) {
 const response = await fetch('/api' + path, { signal: options.signal, method: data === undefined ? 'GET' : 'POST', headers: data === undefined ? {} : {'Content-Type':'application/json'}, body: data === undefined ? undefined : JSON.stringify(data) });
 let result = {};
 try { result = await response.json(); } catch (_) { /* The status still carries a useful failure. */ }
 if (!response.ok) throw new APIError(result.error || '暂时无法连接，请重试', response.status, result);
 return result;
}
function clamp(value, min, max) { return Math.min(max, Math.max(min, value)); }
function stored(key, fallback = null) { try { const raw = sessionStorage.getItem(STORAGE_PREFIX + key); return raw ? JSON.parse(raw) : fallback; } catch (_) { return fallback; } }
function store(key, value) { try { sessionStorage.setItem(STORAGE_PREFIX + key, JSON.stringify(value)); } catch (_) { /* Storage is optional. */ } }
function removeStored(key) { try { sessionStorage.removeItem(STORAGE_PREFIX + key); } catch (_) { /* Storage is optional. */ } }
function questionTargets(question) {
 const raw = Array.isArray(question?.targets) ? question.targets : (question?.target ? [question.target] : []);
 const available = new Set((state.user?.stages || []).map(stage => stage.id));
 return [...new Set(raw.map(String))].filter(id => available.has(id)).slice(0, 6);
}
function composerKey(origin) { if (origin?.type === 'demo-item') return `composer:demo:${origin.channel}:${origin.index}`; return origin?.type === 'ai-turn' && origin.questionId ? `composer:ai:${origin.questionId}` : 'composer:feed'; }
function composerSeed(prefill, origin) { if (origin?.type === 'demo-item') return `demo:${origin.channel}:${origin.index}:${prefill}`; return origin?.type === 'ai-turn' ? `ai:${origin.questionId}:${origin.turnIndex}:${prefill}` : 'feed'; }
function normalizeTargets(values) {
 const available = new Set((state.user?.stages || []).map(stage => stage.id));
 return [...new Set((Array.isArray(values) ? values : [values]).filter(Boolean).map(String))].filter(id => available.has(id)).slice(0, 6);
}
function composerAllowedStages(form) {
 const own = form.elements.stage.value;
 const direction = form.elements.direction.value;
 const stages = state.user.stages;
 const index = stages.findIndex(stage => stage.id === own);
 return index < 0 ? stages : stages.filter((stage, i) => direction === 'older' ? i > index : i < index);
}
function updateComposerChoices({announce = false} = {}) {
 const form = app.querySelector('#ask-form'); if (!form) return;
 const allowed = new Set(composerAllowedStages(form).map(stage => stage.id));
 let removed = false;
 for (const input of composerTargetInputs(form)) {
  if (!allowed.has(input.value) && input.checked) { input.checked = false; removed = true; }
  input.disabled = !allowed.has(input.value);
  input.closest('label').hidden = input.disabled;
 }
 const empty = app.querySelector('#composer-target-empty');
 if (empty) empty.hidden = allowed.size > 0;
 if (removed && announce) notice('已移除不符合当前阶段和方向的对象');
 syncComposerUI();
}
function composerTargetInputs(form = app.querySelector('#ask-form')) { return form ? [...form.querySelectorAll('input[name="targets"]')] : []; }
function selectedComposerTargets(form = app.querySelector('#ask-form')) { return composerTargetInputs(form).filter(input => input.checked).map(input => input.value); }
function saveCurrentComposerDraft() {
 const form = app.querySelector('#ask-form');
 if (!form) return;
 const draft = {
  title: form.elements.title?.value || '', body: form.elements.body?.value || '',
  stage: form.elements.stage.value, direction: form.elements.direction.value, version: 2,
  targets: selectedComposerTargets(form), sourceSeed: form.dataset.sourceSeed || 'feed'
 };
 store(form.dataset.draftKey || 'composer:feed', draft);
}
function composerTargetSummaryHTML(targets) {
 return targets.map(id => `<button type="button" class="composer-target-chip" data-action="remove-target" data-value="${escape(id)}" aria-label="移除${escape(stageName(id))}"># ${escape(stageName(id))}<span aria-hidden="true">×</span></button>`).join('');
}
function fitComposerTextareas() {
 for(const field of app.querySelectorAll('.composer-field textarea')) {
  const minimum=field.name==='title'?38:32, maximum=field.name==='title'?160:240;
  field.style.height='0px';
  const contentHeight=field.scrollHeight;
  field.style.height=`${Math.max(minimum,Math.min(maximum,contentHeight))}px`;
  field.style.overflowY=contentHeight>maximum?'auto':'hidden';
 }
}
function syncComposerUI({save = true} = {}) {
 const form = app.querySelector('#ask-form');
 if (!form) return;
 fitComposerTextareas();
 const titleLength = form.elements.title?.value.length || 0;
 const bodyLength = form.elements.body?.value.length || 0;
 const targets = selectedComposerTargets(form);
 const titleStatus = app.querySelector('#question-title-status');
 const bodyStatus = app.querySelector('#question-body-status');
 const targetStatus = app.querySelector('#question-target-status');
 const summary = app.querySelector('.composer-selected-targets');
 if (titleStatus) {
  titleStatus.classList.toggle('is-error', titleLength > 100);
  titleStatus.textContent = titleLength > 100 ? `当前 ${titleLength} 字，请编辑到 100 字以内后发布。` : `${titleLength}/100`;
 }
 if (bodyStatus) bodyStatus.textContent = `${bodyLength}/1000`;
 if (targetStatus) {
  targetStatus.classList.toggle('is-error', targets.length > 6);
  targetStatus.textContent = targets.length ? `已选 ${targets.length}` : '';
 }
 if (summary) summary.innerHTML = composerTargetSummaryHTML(targets);
 const publish = app.querySelector('.composer-publish[form="ask-form"]');
 if (publish) publish.disabled = form.dataset.submitting === 'true' || !form.elements.title?.value.trim() || titleLength > 100 || targets.length > 6;
 if (save) saveCurrentComposerDraft();
}
function detailView(id) {
 if (!state.detailViews.has(id)) {
  const saved = stored('detail:' + id, {});
  state.detailViews.set(id, {
   aiAnswerId:saved.aiAnswerId||null, aiDrafts:saved.aiDrafts&&typeof saved.aiDrafts==='object'?saved.aiDrafts:{}, answerId: saved.answerId || null, answerStage: saved.answerStage || 'all', scrollTop: Number(saved.scrollTop) || 0,
   aiOpen: !!saved.aiOpen, aiDraft: typeof saved.aiDraft === 'string' ? saved.aiDraft : '',
   aiSnapshot: null, aiLoading: false, aiSubmitting: false, aiUncertain: false, aiError: ''
  });
 }
 return state.detailViews.get(id);
}
function saveDetailView(id) {
 const view = detailView(id);
 store('detail:' + id, {aiAnswerId:view.aiAnswerId, aiDrafts:view.aiDrafts, answerId:view.answerId, answerStage:view.answerStage, scrollTop:view.scrollTop, aiOpen:view.aiOpen, aiDraft:view.aiDraft});
}
function cleanupAIPoll() { clearTimeout(aiPollTimer); aiPollTimer = 0; aiPollStartedAt = 0; }
function cleanupFilterControls() {
 if (filterScrollCleanup) filterScrollCleanup();
 filterViewport = null; filterStack = null; filterScrollCleanup = null;
}
function syncFilterSpacerHeight() {
 const layer = filterStack?.closest('.feed-layer');
 if (!layer) return;
 const height = filterStack.getBoundingClientRect().height;
 if (height > 0) layer.style.setProperty('--filter-controls-height', `${height}px`);
}
function syncFilterSpacer(viewport, stack) {
 const spacer = viewport.querySelector('.filter-controls-spacer');
 if (!spacer) return;
 // Natural document space: it scrolls out with the feed, never changes per frame.
 // Top has a hard visible invariant, so an empty hidden gap cannot remain there.
 const height = stack.getBoundingClientRect().height;
 if (Math.abs(spacer.getBoundingClientRect().height - height) >= .1) spacer.style.height = `${height}px`;
}
function feedEntryView(view) { return view ? {...view, filterProgress:1} : null; }
function revealFeedFilters() {
 if (!app.querySelector('.filter-controls-stack')) return;
 cleanupFilterControls();
 filterViewport = app.querySelector('.feed-viewport'); filterStack = app.querySelector('.filter-controls-stack');
 filterVisibilityProgress = 1; applyFilterVisibility(); bindFilterControls();
}
function applyFilterVisibility() {
 if (!filterStack || !filterViewport) return;
 const progress = clamp(filterVisibilityProgress, 0, 1);
 syncFilterSpacer(filterViewport, filterStack);
 if (progress > 0 && filterStack.classList.contains('is-hidden')) {
  filterStack.classList.remove('is-hidden');
  filterStack.removeAttribute('aria-hidden');
  filterStack.inert = false;
 }
 filterStack.style.setProperty('--filter-progress', progress.toFixed(4));
 filterStack.style.setProperty('--filter-offset', '0px');
 if (progress === 0 && !filterStack.classList.contains('is-hidden')) {
  filterStack.classList.add('is-hidden');
  filterStack.setAttribute('aria-hidden', 'true');
  filterStack.inert = true;
 }
}
// Any nonzero vertical return input reveals the filters immediately.
function filterScrollIntent(delta) {
 if (!Number.isFinite(delta) || delta === 0) return null;
 return delta < 0 ? 'show' : 'hide';
}
function bindFilterControls() {
 cleanupFilterControls();
 filterViewport = app.querySelector('.feed-viewport');
 filterStack = app.querySelector('.filter-controls-stack');
 if (!filterViewport || !filterStack) return;
 const viewport = filterViewport;
 filterLastScrollTop = Math.max(0, viewport.scrollTop);
 syncFilterSpacerHeight();
 let action = null, touchY = null, touchX = null;
 let animation = 0, target = null, disposed = false;
 const stop = () => { cancelAnimationFrame(animation); animation = 0; target = null; };
 const pinTop = () => {
  stop(); action = null;
  filterVisibilityProgress = 1; applyFilterVisibility();
 };
 const animateTo = to => {
  if (disposed) return;
  if (viewport.scrollTop <= 1) { pinTop(); return; }
  if (target === to || (filterVisibilityProgress === to && !animation)) return;
  stop(); target = to;
  const from = filterVisibilityProgress, start = performance.now();
  const duration = matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 360;
  const tick = now => {
   if (disposed) return;
   // Touch overscroll and arriving at zero always win over a pending hide frame.
   if (viewport.scrollTop <= 1) { pinTop(); return; }
   const t = duration ? Math.min(1, (now - start) / duration) : 1;
   filterVisibilityProgress = from + (to - from) * (1 - Math.pow(1 - t, 3));
   applyFilterVisibility();
   if (t < 1) animation = requestAnimationFrame(tick);
   else { animation = 0; target = null; }
  };
  animation = requestAnimationFrame(tick);
 };
 const input = delta => {
  const next = filterScrollIntent(delta);
  if (!next) return;
  action = next;
  if (viewport.scrollTop <= 1) {
   // Wheel/touch intent arrives before native scrolling: retain downward intent
   // so onScroll can start fading after leaving the top, never while still at it.
   if (next !== 'hide') pinTop();
   return;
  }
  if (next === 'show') animateTo(1);
  else if (next === 'hide') animateTo(0);
 };
 const onWheel = event => {
  if (event.ctrlKey || Math.abs(event.deltaX) > Math.abs(event.deltaY)) return;
  const scale = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? viewport.clientHeight : 1;
  input(event.deltaY * scale);
 };
 const onTouchStart = event => {
  touchY = event.touches.length === 1 ? event.touches[0].clientY : null;
  touchX = event.touches.length === 1 ? event.touches[0].clientX : null;
 };
 const onTouchMove = event => {
  if (touchY === null || event.touches.length !== 1) return;
  const touch = event.touches[0], dy = touchY - touch.clientY, dx = touchX - touch.clientX;
  touchY = touch.clientY; touchX = touch.clientX;
  if (Math.abs(dy) > Math.abs(dx)) input(dy);
 };
 const onTouchEnd = () => { touchY = null; touchX = null; if (viewport.scrollTop <= 1) pinTop(); };
 const onKey = event => {
  if (event.target.closest?.('input,textarea,select,button,[contenteditable="true"]')) return;
  const up = ['ArrowUp','PageUp','Home'].includes(event.key) || (event.key === ' ' && event.shiftKey);
  const down = ['ArrowDown','PageDown','End'].includes(event.key) || (event.key === ' ' && !event.shiftKey);
  if (!up && !down) return;
  input(up ? -40 : 40);
 };
 const onScroll = () => {
  const current = Math.max(0, viewport.scrollTop);
  const delta = current - filterLastScrollTop;
  filterLastScrollTop = current;
  if (current <= 1) { pinTop(); return; }
  if (delta > 0 && action === 'hide') animateTo(0);
  else if (delta < 0 && action === 'show') animateTo(1);
 };
 if (viewport.scrollTop <= 1) pinTop(); else applyFilterVisibility();
 const listeners = {scroll:onScroll,wheel:onWheel,touchstart:onTouchStart,touchmove:onTouchMove,touchend:onTouchEnd,touchcancel:onTouchEnd,keydown:onKey};
 Object.entries(listeners).forEach(([type,fn]) => viewport.addEventListener(type,fn,{passive:true}));
 filterScrollCleanup = () => {
  disposed = true; stop();
  Object.entries(listeners).forEach(([type,fn]) => viewport.removeEventListener(type,fn));
 };
}
let composerResize=null;
let answerDeckResize=null;
function controls(show) { clearTimeout(kanshanPollTimer);kanshanPollTimer=0;composerResize?.disconnect();composerResize=null;answerDeckResize?.disconnect();answerDeckResize=null;app.classList.remove('answer-flow-mode'); app.classList.toggle('feed-mode', show); if (!show) cleanupFilterControls(); }
const CHANNEL_TABS = [['recommend','推荐'], ['hot','热榜'], ['story','故事'], ['knowledge','知识']];
function channelTabsHTML(active = 'guolairen') {
 const demoTabs = CHANNEL_TABS.map(([id, label]) => `<button data-action="channel" data-channel="${id}" class="${active === id ? 'active' : ''}" ${active === id ? 'aria-current="page"' : ''}>${label}</button>`).join('');
 return `<nav class="channel-tabs" aria-label="内容频道">${demoTabs}<button data-action="home" class="${active === 'guolairen' ? 'active' : ''}" ${active === 'guolairen' ? 'aria-current="page"' : ''}>过来人</button><button data-action="channel" data-channel="follow">关注</button></nav>`;
}
function topNavigationHTML(active = 'guolairen') { return shotHeader(active); }
function bottomTabBarHTML(active = 'home') { return `<nav class="bottom-tab-bar" aria-label="主导航"><button data-action="home" class="${active === 'home' ? 'current' : ''}" ${active === 'home' ? 'aria-current="page"' : ''} aria-label="首页"><svg class="tab-icon tab-icon-home" viewBox="2 3 20 19" aria-hidden="true" focusable="false"><path d="M3.2 10.1 11 4.25a1.65 1.65 0 0 1 2 0l7.8 5.85v9.05a1.75 1.75 0 0 1-1.75 1.75H4.95a1.75 1.75 0 0 1-1.75-1.75Z" fill="currentColor"/><path d="M12 14.5v4" fill="none" stroke="#fff" stroke-linecap="round" stroke-width="1.8"/></svg><span>首页</span></button><button data-action="kanshan" class="${active === 'kanshan' ? 'current' : ''}" ${active === 'kanshan' ? 'aria-current="page"' : ''} aria-label="看山"><svg class="tab-icon tab-icon-mountain" viewBox="2.5 4.5 19 18.5" aria-hidden="true" focusable="false"><path d="M5.2 20.15c-1.3-1.12-1.6-3.15-1.27-5.25l1.16-7.72c.22-1.48 1.93-2.08 3-1.04l1.96 1.92A9.4 9.4 0 0 1 12 7.85c.67 0 1.32.07 1.95.21l1.96-1.92c1.07-1.04 2.78-.44 3 1.04l1.16 7.72c.33 2.1.03 4.13-1.27 5.25-1.32 1.14-3.65 1.35-6.8 1.35s-5.48-.21-6.8-1.35Z" fill="none" stroke="currentColor" stroke-linejoin="round" stroke-width="1.8"/><circle cx="9.25" cy="14.25" r="1.05" fill="currentColor"/><circle cx="14.75" cy="14.25" r="1.05" fill="currentColor"/></svg><span>看山</span></button><button class="ask-entry" data-action="ask" aria-label="提出一个问题"><svg class="tab-create-icon" viewBox="0 0 42 32" aria-hidden="true" focusable="false"><rect width="42" height="32" rx="16" fill="currentColor"/><path d="M21 10v12M15 16h12" fill="none" stroke="#fff" stroke-linecap="round" stroke-width="2"/></svg></button><button data-action="notifications" class="${active==='notifications'?'current':''}" aria-label="消息"><svg class="tab-icon tab-icon-message" viewBox="1.5 3 21 18" aria-hidden="true" focusable="false"><rect x="3" y="5" width="18" height="14" rx="3.8" fill="none" stroke="currentColor" stroke-width="1.8"/><circle cx="9" cy="12" r="1.15" fill="currentColor"/><circle cx="15" cy="12" r="1.15" fill="currentColor"/></svg><span>消息</span><i class="notification-dot" ${demoInbox.unread?'':'hidden'}></i></button><button data-action="profile" aria-label="未登录，设置我的阶段"><svg class="tab-icon tab-icon-profile" viewBox="2 2 20 20" aria-hidden="true" focusable="false"><circle cx="12" cy="12" r="8.7" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M9 14.35c.78.82 1.78 1.23 3 1.23s2.22-.41 3-1.23" fill="none" stroke="currentColor" stroke-linecap="round" stroke-width="1.7"/></svg><span>未登录</span></button></nav>`; }
function saveDemoScroll() {
 if (state.screen !== 'demo' || !state.demoChannel) return;
 const viewport = app.querySelector('.demo-feed');
 if (viewport) state.demoScroll.set(state.demoChannel, viewport.scrollTop);
}
function prepareDemoScreen() {
 if (state.screen === 'feed') captureFeedView();
 else saveDemoScroll();
 ++state.request; cleanupAIPoll(); state.aiRequest++; controls(false);
}
const DEMO_AUTHORS = ['小满的日常', '路过的人', '慢慢来呀', '一页笔记', '林间有风'];
const DEMO_STORY_TYPES = ['人间故事', '家庭', '生活', '成长', '亲情'];
const DEMO_KNOWLEDGE_TYPES = ['心理学', '学习方法', '社会学', '认知科学', '经济学'];
const demoMarks = new Set();
function demoIcon(type) {
 const paths = {vote:'<path d="m12 3 10 17H2Z"/>',comment:'<path d="M21 11.5a9 9 0 0 1-9 9H4l-2 2v-11a9.5 9.5 0 0 1 19 0Z"/>',save:'<path d="m12 2 3.1 6.3 6.9 1-5 4.9 1.2 6.9L12 17.8 5.8 21.1 7 14.2 2 9.3l6.9-1Z"/>',share:'<path d="m14 3 7 7-7 7v-5c-5 0-8 2-11 7 0-7 3-11 11-12Z"/>',more:'<circle cx="5" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/>'};
 return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.65" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[type] || paths.more}</svg>`;
}
function demoAuthorHTML(index, channel) {
 return `<div class="demo-author"><span class="demo-avatar" aria-hidden="true">${DEMO_AUTHORS[index % DEMO_AUTHORS.length][0]}</span><span>${DEMO_AUTHORS[index % DEMO_AUTHORS.length]}</span><small>${channel==='story'?'故事创作者':'分享生活中的观察'}</small><span class="demo-author-menu" aria-hidden="true">···</span></div>`;
}
function demoActionsHTML(channel,index) {
 const key = channel+':'+(mockItems(channel)[index]?.id||index);
 return `<div class="demo-actions"><button data-action="demo-mark" data-key="vote:${key}" aria-pressed="${demoMarks.has('vote:'+key)}">${demoIcon('vote')}<span>${demoMarks.has('vote:'+key)?'已赞同':'赞同'}</span></button><button data-action="demo-mark" data-key="save:${key}" aria-pressed="${demoMarks.has('save:'+key)}">${demoIcon('save')}<span>${demoMarks.has('save:'+key)?'已收藏':'收藏'}</span></button><button data-action="demo-open" data-channel="${channel}" data-index="${index}">${demoIcon('comment')}<span>评论</span></button><button data-action="demo-open" data-channel="${channel}" data-index="${index}" aria-label="查看更多示例">${demoIcon('more')}</button></div>`;
}
function demoRowHTML(item, index, channel) {
 const open=`data-action="demo-open" data-channel="${channel}" data-index="${index}"`;
 if(channel==='hot')return `<article class="demo-row demo-hot-row"><span class="demo-rank ${index<3?'demo-rank-leading':''}">${index+1}</span><div class="demo-row-body"><button class="demo-title demo-title-button" ${open}>${escape(item.title)}</button><p class="demo-excerpt">${escape(item.excerpt)}</p><div class="demo-hot-meta"><span aria-label="示例热度">♨ ${[488,418,306,219,180][index]} 万热度</span><button data-action="demo-share">${demoIcon('share')}分享</button></div></div></article>`;
 const story=channel==='story'; const knowledge=channel==='knowledge';
 return `<article class="demo-row demo-${channel}-row">${demoAuthorHTML(index,channel)}${story?`<div class="demo-genre">${DEMO_STORY_TYPES[index % DEMO_STORY_TYPES.length]}<span>短篇 · 完结示例</span></div>`:''}${knowledge?`<div class="demo-knowledge-topic">${DEMO_KNOWLEDGE_TYPES[index % DEMO_KNOWLEDGE_TYPES.length]} · 每天读懂一个概念</div>`:''}<button class="demo-title demo-title-button" ${open}>${escape(item.title)}</button><p class="demo-excerpt">${escape(item.excerpt)}</p>${story?`<button class="demo-read-story" ${open}>继续阅读 <span>›</span></button>`:''}${demoActionsHTML(channel,index)}</article>`;
}
function demoSubnavHTML(id) {
 if(id==='hot')return '<div class="demo-section-label"><strong>全站热榜</strong><span>榜单与热度均为演示</span></div>';
 if(id==='story')return '<div class="demo-section-label demo-story-heading"><strong>盐选故事</strong><span>好故事，自有回响</span></div>';
 if(id==='knowledge')return '<div class="demo-section-label"><strong>今日精选</strong><span>让好奇心多走一步</span></div>';
 return '';
}
function renderDemoChannel(id) {
 if (['follow','recommend','hot'].includes(id)) return renderScreenshotChannel(id);
 const channel = DEMO_CHANNELS[id]; if (!channel) return;
 prepareDemoScreen(); state.screen = 'demo'; state.demoChannel = id; state.kanshanSuggestion = null;
 app.innerHTML = `<div class="app-shell demo-shell shot-shell">${topNavigationHTML(id)}<section class="demo-feed demo-feed-${id}" aria-label="${escape(channel.label)}频道示例内容" tabindex="0"><p class="demo-caption">频道预览 · 内容、昵称与互动数据均为示例</p>${demoSubnavHTML(id)}${mockItems(id).map((item,index)=>demoRowHTML(item,index,id)).join('')}</section>${bottomTabBarHTML('home')}</div>`;
 requestAnimationFrame(() => { const viewport = app.querySelector('.demo-feed'); if (viewport && state.demoChannel===id) viewport.scrollTop = state.demoScroll.get(id) || 0; });
}
function showDemoArticle(channel,index) {
 const raw=mockItems(channel)[index]; const item=raw?{...raw,excerpt:raw.text||raw.excerpt||'以下为截图界面示例内容，可带着问题去过来人发起讨论。'}:null; if(!item)return;
 saveDemoScroll(); controls(false); state.screen='demo-detail'; state.demoChannel=channel;
 app.innerHTML=`${bar(channel==='story'?'故事':channel==='knowledge'?'知识':'这一条讨论')}<section class="demo-reader"><p class="demo-caption">示例内容 · 不对应真实知乎帖子</p>${demoAuthorHTML(index,channel)}<h1>${escape(item.title)}</h1><p>${escape(item.excerpt)}</p><div class="demo-reader-note">这一条是频道界面示例。想听真实的经历，可以把这个问题带到过来人。</div><button class="demo-discuss" data-action="demo-discuss" data-channel="${channel}" data-index="${index}">去过来人问问大家 ↗</button><div class="demo-comment-empty"><strong>评论</strong><p>还没有真实评论。留一个问题，让交流从这里开始。</p></div></section>`;
 app.scrollTop=0;
}
function kanshanSuggestionHTML() {
 if (state.kanshanSuggestion === null) return '';
 const item = KANSHAN_SUGGESTIONS[state.kanshanSuggestion];
 if (!item || item.home) return '';
 return `<article class="demo-row" aria-live="polite"><div class="demo-row-body"><h2 class="demo-title">${escape(item.question)}</h2><p class="demo-excerpt">${escape(item.answer)}</p><div class="demo-meta"><span>本地预置回答 · 非 AI 实时生成</span></div></div></article>`;
}
function renderKanshan({prepare = true} = {}) {
 if (prepare) prepareDemoScreen();
 state.screen = 'kanshan'; state.demoChannel = null;
 app.innerHTML = `<div class="app-shell demo-shell shot-shell">${topNavigationHTML('kanshan')}<section class="demo-feed demo-kanshan" aria-label="看山示例页"><div class="demo-kanshan-heading"><span>Hi，我是刘看山，你的 AI 朋友</span><strong>畅所欲问</strong><small>本页为本地交互示例，未接入实时 AI 或搜索服务。</small></div><div class="demo-kanshan-suggestions" aria-label="示例问题">${KANSHAN_SUGGESTIONS.map((item, index) => `<button type="button" data-action="kanshan-suggestion" data-index="${index}">${escape(item.question)}${item.home ? ' ↗' : ''}</button>`).join('')}</div>${kanshanSuggestionHTML()}<div class="demo-kanshan-input"><input type="text" value="体验版暂不支持自由对话" aria-label="体验版暂不支持自由对话" disabled><button type="button" data-action="ask">去提问</button></div></section>${bottomTabBarHTML('kanshan')}</div>`;
}
function showCachedFeed() {
 const restore = feedEntryView(state.feedReturn || stored('feed', null));
 state.composerOrigin = null;
 if (!state.feed.length) return loadFeed({restore});
 if (restore) { state.mode = restore.mode || state.mode; state.stage = restore.stage || 'all'; }
 renderFeed(restore); return Promise.resolve();
}
function bar(title, trailing = '') { return `<div class="screen-bar"><button data-action="back">← 返回</button><span>${escape(title)}</span><span class="screen-bar-trailing">${trailing}</span></div>`; }
function formatVoteCount(value){const n=Math.max(0,Number(value)||0);return n>=10000?(Math.floor(n/1000)/10)+'w':n>=1000?(Math.floor(n/100)/10)+'k':String(n);}
function voteHeartHTML(voted) { return `<span class="vote-heart${voted ? ' is-filled' : ''}" aria-hidden="true"><svg viewBox="0 0 24 24" focusable="false"><path d="M16.5 3c-1.74 0-3.41.81-4.5 2.09C10.91 3.81 9.24 3 7.5 3A5.49 5.49 0 0 0 2 8.5c0 3.78 3.4 6.86 8.55 11.54L12 21.35l1.45-1.32C18.6 15.36 22 12.28 22 8.5A5.49 5.49 0 0 0 16.5 3Z"/></svg></span>`; }
function saveStarHTML() { return '<span class="save-star" aria-hidden="true"><svg viewBox="0 0 24 24" focusable="false"><path d="m12 2.8 2.85 5.78 6.38.93-4.62 4.5 1.09 6.35L12 17.36l-5.7 3 1.09-6.35-4.62-4.5 6.38-.93Z"/></svg></span>'; }
function answerFooterHTML(a, qid, detail = false) { return `<footer class="answer-footer"><button data-action="vote" data-id="${a.id}" data-voted="${!!a.voted}" class="${a.voted ? 'voted' : ''}" aria-label="${a.voted ? '取消赞同' : '赞同回答'}" aria-pressed="${!!a.voted}">${voteHeartHTML(a.voted)} <span>${formatVoteCount(a.votes)}</span></button>${detail ? '<span>来自这一程的声音</span>' : `<button data-action="detail" data-id="${qid}">听听其他回答 ↗</button>`}</footer>`; }
function answerHTML(a, qid, detail = false) { return `<article class="qa-card detail-answer-card" data-answer-id="${a.id}"><div class="answer-meta"><span class="answer-line"></span><span>${escape(stageName(a.stage))} · ${answerKind(a)}</span></div><p class="answer-text">${escape(a.body)}</p>${answerFooterHTML(a, qid, detail)}</article>`; }
const ITEM_STAGE_NAMES = {primary:'小学',middle:'初中',secondary:'中学',college:'大学',working:'工作',retired:'退休'};
const itemStageName = id => ITEM_STAGE_NAMES[id] || stageName(id);
function itemRouteHTML(q) {
 const targets = questionTargets(q);
 if (!q.stage && !targets.length) return '';
 const full = `${q.stage ? stageName(q.stage) : '阶段未填'} → ${targets.length ? targets.map(stageName).join('、') : '不限阶段'}`;
 const compact = `${q.stage ? itemStageName(q.stage) : '未填'} → ${targets.length ? itemStageName(targets[0]) : '不限'}`;
 return `<span class="stage-tag item-route" title="${escape(full)}" aria-label="${escape(full)}">${escape(compact)}</span>`;
}
function authorBadgeHTML(author, className='public-author') {
 const person=author||{name:'路过的朋友',avatar:'/assets/avatars/00.svg'};
 return `<span class="${className}"><img src="${escape(person.avatar)}" alt="" width="28" height="28" loading="lazy"><span>${escape(person.name)}</span>${person.simulated?`<small class="ai-role" title="虚拟角色 · ${person.age}岁">AI 角色</small>`:''}</span>`;
}
function feedAnswerHTML(a, qid) {
 const label = a.stage ? `<span class="stage-tag" title="${escape(stageName(a.stage))} · ${answerKind(a)}">${escape(itemStageName(a.stage))}</span>` : '';
 const vote = `<button class="item-vote ${a.voted ? 'voted' : ''}" data-action="vote" data-id="${a.id}" data-voted="${!!a.voted}" aria-label="${a.voted ? '取消赞同' : '赞同回答'}" aria-pressed="${!!a.voted}">${voteHeartHTML(a.voted)} <span>${formatVoteCount(a.votes)}</span></button>`;
 return `<div class="answer-section"><div class="answer-tags" aria-label="回答标签 · ${answerKind(a)}">${label}${vote}</div><div class="answer-content"><p class="answer-text">${escape(a.body)}</p></div></div>`;
}
function cardHTML(q) {
 return `<article class="qa-card qa-feed-card" data-question-id="${q.id}" role="link" tabindex="0" aria-label="查看问题：${escape(q.title)}"><div class="question-section"><div class="question-content"><h2>${escape(q.title)}</h2></div><div class="question-tags" aria-label="问题标签">${itemRouteHTML(q)}</div></div>${q.answer ? feedAnswerHTML(q.answer, q.id) : `<div class="answer-section"><div class="answer-tags" aria-hidden="true"></div><div class="answer-content"><p class="empty-answer">暂时没有这个阶段的回答，等你来说。</p></div></div>`}</article>`;
}
function captureFeedView(focusedQuestionId = null) {
 const viewport = app.querySelector('.feed-viewport');
 if (!viewport) return state.feedReturn;
 const viewportRect = viewport.getBoundingClientRect();
 const cards = [...viewport.querySelectorAll('.qa-feed-card[data-question-id]')];
 const anchor = cards.find(card => card.getBoundingClientRect().bottom > viewportRect.top + 1) || cards[0] || null;
 const focusedCard = document.activeElement?.closest?.('.qa-feed-card[data-question-id]');
 const view = {
  mode: state.mode, stage: state.stage, scrollTop: viewport.scrollTop,
  anchorId: anchor ? Number(anchor.dataset.questionId) : null,
  anchorOffset: anchor ? anchor.getBoundingClientRect().top - viewportRect.top : 0,
  filterProgress: filterVisibilityProgress,
  focusedQuestionId: focusedQuestionId || (focusedCard ? Number(focusedCard.dataset.questionId) : null)
 };
 state.feedReturn = view; store('feed', view); return view;
}
function restoreFeedViewport(view) {
 const viewport = app.querySelector('.feed-viewport');
 const stack = app.querySelector('.filter-controls-stack');
 if (!viewport || !stack) return;
 filterVisibilityProgress = view?.filterProgress === 0 ? 0 : 1;
 const naturalHeight = stack.getBoundingClientRect().height;
 if (naturalHeight > 0) stack.closest('.feed-layer')?.style.setProperty('--filter-controls-height', `${naturalHeight}px`);
 stack.style.setProperty('--filter-progress', filterVisibilityProgress.toFixed(4));
 stack.style.setProperty('--filter-offset', '0px');
 if (filterVisibilityProgress === 0) {
  stack.classList.add('is-hidden'); stack.setAttribute('aria-hidden', 'true'); stack.inert = true;
 } else {
  stack.classList.remove('is-hidden'); stack.removeAttribute('aria-hidden'); stack.inert = false;
 }
 syncFilterSpacer(viewport, stack);
 viewport.scrollTop = clamp(Number(view?.scrollTop) || 0, 0, Math.max(0, viewport.scrollHeight - viewport.clientHeight));
 if (view?.anchorId) {
  const anchor = viewport.querySelector(`[data-question-id="${view.anchorId}"]`);
  if (anchor) viewport.scrollTop = clamp(viewport.scrollTop + anchor.getBoundingClientRect().top - viewport.getBoundingClientRect().top - (Number(view.anchorOffset) || 0), 0, Math.max(0, viewport.scrollHeight - viewport.clientHeight));
 }
 requestAnimationFrame(() => {
  if (!viewport.isConnected || app.querySelector('.feed-viewport') !== viewport) return;
  bindFilterControls();
  if (view?.focusedQuestionId) app.querySelector(`[data-question-id="${view.focusedQuestionId}"]`)?.focus({preventScroll:true});
 });
}
function renderFeed(restore = null) {
 cleanupFilterControls();
 cleanupAIPoll(); state.aiRequest++;
 if (!restore) filterVisibilityProgress = 1;
 state.screen = 'feed'; controls(true);
 app.innerHTML = `<div class="app-shell shot-shell guolairen-shell">${topNavigationHTML()}<div class="feed-layer"><div class="filter-controls-stack" role="group" aria-label="内容筛选"><section class="direction-layer"><div class="direction-switch" aria-label="浏览方向"><button data-action="mode" data-value="older" class="${state.mode === 'older' ? 'selected' : ''}" aria-pressed="${state.mode === 'older'}">听过来人说</button><button data-action="mode" data-value="younger" class="${state.mode === 'younger' ? 'selected' : ''}" aria-pressed="${state.mode === 'younger'}">听没过来人说</button></div></section><section class="stage-filter-layer"><div class="stage-filter" aria-label="回答者阶段筛选"><div class="chips"><button data-action="filter" data-value="all" class="${state.stage === 'all' ? 'active' : ''}" aria-pressed="${state.stage === 'all'}">全部</button>${state.allowed.map(id => `<button data-action="filter" data-value="${id}" class="${state.stage === id ? 'active' : ''}" aria-pressed="${state.stage === id}">${escape(stageName(id))}</button>`).join('')}</div>${myStageEntryHTML()}</div></section></div><section class="feed-viewport" aria-label="问答内容流" tabindex="0"><div class="filter-controls-spacer" aria-hidden="true"></div>${state.feed.length ? state.feed.map(cardHTML).join('') : '<div class="empty-state">这一边暂时还没有回声。<br>换一个方向，或先留下你的问题。</div>'}</section></div>${bottomTabBarHTML()}</div>`;
 restoreFeedViewport(restore || {scrollTop:0, filterProgress:1});
}
async function loadFeed({restore = null} = {}) {
 if (restore) { state.mode = restore.mode || state.mode; state.stage = restore.stage || 'all'; }
 const ticket = ++state.request;
 const data = await api(`/feed?mode=${state.mode}&stage=${state.stage}`);
 if (ticket !== state.request) return;
 state.feed = data.items; state.allowed = data.allowed_stages; renderFeed(restore);
}
async function returnToFeed() { const restore = state.feedReturn || stored('feed', null); state.composerOrigin = null; return loadFeed({restore}); }
function options(selected) { return state.user.stages.map(s => `<option value="${s.id}" ${s.id === selected ? 'selected' : ''}>${escape(s.label)}</option>`).join(''); }
const PERSONAL_STAGE_LABELS={primary:'小学生',middle:'初中生',secondary:'高中 / 中专生',college:'大学生',working:'上班族',retired:'已退休'};
function myStageEntryHTML() {
 const label=PERSONAL_STAGE_LABELS[state.user.stage]||stageName(state.user.stage);
 return `<button type="button" class="my-stage-entry" data-action="stage-settings" aria-label="我是${escape(label)}，切换我的阶段"><span>我是${escape(label)}</span><span aria-hidden="true">›</span></button>`;
}
function showStagePicker() {
 captureFeedView();++state.request;cleanupAIPoll();controls(false);state.screen='stage-picker';
 const descriptions={primary:'正在读小学',middle:'正在读初中',secondary:'正在读高中或中专',college:'正在大学学习',working:'已经进入职场',retired:'正在享受退休生活'};
 app.innerHTML=`<header class="screen-bar stage-picker-bar"><button type="button" data-action="stage-picker-back" aria-label="返回"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m15 4-8 8 8 8"/></svg></button><span>我的阶段</span><button class="stage-picker-done" type="submit" form="stage-switch-form">完成</button></header><section class="stage-picker-page"><h1>你现在处于哪个阶段？</h1><p class="stage-picker-intro">让另一程的声音，离你近一点。</p><form id="stage-switch-form"><fieldset><legend class="sr-only">选择我的阶段</legend>${state.user.stages.map((stage,i)=>`<label class="stage-picker-option"><input type="radio" name="stage" value="${escape(stage.id)}" ${stage.id===state.user.stage?'checked':''}><span class="stage-picker-number" aria-hidden="true">${String(i+1).padStart(2,'0')}</span><span class="stage-picker-copy"><strong>${escape(stage.label)}</strong><small>${descriptions[stage.id]||''}</small></span><svg class="stage-picker-check" viewBox="0 0 24 24" aria-hidden="true"><path d="m5 12 4 4L19 6"/></svg></label>`).join('')}</fieldset><p class="stage-picker-note">阶段由你自己选择，随时可以切换。<br>影响推荐与之后回答的阶段标签，已发布内容不变。</p><p class="stage-picker-status" role="status" aria-live="polite"></p></form></section>`;
 app.scrollTop=0;
}
async function saveStagePicker(form) {
 const submit=app.querySelector('.stage-picker-done');if(!submit||submit.disabled)return;
 const stage=form.dataset.saved?state.user.stage:new FormData(form).get('stage');
 if(!state.user.stages.some(x=>x.id===stage)){notice('请选择一个阶段');return;}
 const back=app.querySelector('[data-action="stage-picker-back"]');
 submit.disabled=true;back.disabled=true;submit.textContent='保存中';
 const radios=[...form.querySelectorAll('input')];radios.forEach(x=>x.disabled=true);
 try {
  if(!form.dataset.saved && stage!==state.user.stage){const result=await api('/profile',{stage});state.user.stage=result.stage;}
  form.dataset.saved='true';state.stage='all';state.feedReturn=null;removeStored('feed');
  submit.textContent='更新中';
  await loadFeed();captureFeedView();notice('已切换为'+(PERSONAL_STAGE_LABELS[state.user.stage]||stageName(state.user.stage)));
  app.querySelector('.my-stage-entry')?.focus({preventScroll:true});
 } catch(error) {
  const saved=!!form.dataset.saved;
  form.querySelector('.stage-picker-status').textContent=saved?'阶段已保存，内容暂未刷新。点击右上角重试即可。':'暂时没有保存成功，请重试。';
  submit.textContent=saved?'重新加载':'完成';
  if(!saved)radios.forEach(x=>x.disabled=false);
  notice(saved?'阶段已保存，无需重复选择':error.message);
 } finally {if(submit.isConnected)submit.disabled=false;if(back.isConnected)back.disabled=false;}
}
function showProfile() { ++state.request; state.screen = 'profile'; controls(false); app.innerHTML = `${bar('我的阶段')}<section class="form-screen">${authorBadgeHTML(state.user?.author)}<h2>你正走到哪一程？</h2><p class="helper">用阶段认识彼此，不用头衔定义彼此。<br>阶段由你自己选择，会随问题和回答一起显示。</p><form id="profile-form"><label for="profile-stage">我目前的阶段</label><select id="profile-stage" name="stage">${options(state.user.stage)}</select><p class="helper">体验版按求学、工作、退休的顺序组织浏览方向，不代表经验或能力的高低。默认阶段为大学，可随时修改。</p><button class="primary-button" type="submit">保存我的阶段</button></form><p class="helper">当前使用本浏览器的访客身份保存操作，尚未接入知乎账号。</p></section>`; app.scrollTop = 0; }
function showAsk(prefill = '', origin = null) {
 ++state.request; cleanupAIPoll(); state.screen = 'ask'; controls(false);
 origin = origin || {type:'feed'}; state.composerOrigin = origin;
 const fromAI = origin.type === 'ai-turn';
 const draftKey = composerKey(origin); const sourceSeed = composerSeed(prefill, origin);
 const saved = stored(draftKey, null);
 const useSaved = !!saved && (!fromAI || saved.sourceSeed === sourceSeed);
 const hasContent = !!(saved?.title || saved?.body);
 const initialTargets = normalizeTargets(useSaved && (saved.version === 2 || hasContent) ? saved.targets : []);
 const draft = {
  title: useSaved ? String(saved.title || '') : String(prefill || ''),
  body: useSaved ? String(saved.body || '') : '',
  targets: initialTargets, stage: useSaved ? normalizeTargets(saved.stage)[0] || '' : '',
  direction: useSaved && ['older','younger'].includes(saved.direction) ? saved.direction : state.mode, version: 2,
  sourceSeed
 };
 store(draftKey, draft); store('composer:active', {origin, prefill:String(prefill || '')});
 const targetChoices = state.user.stages.map(stage => `<label class="composer-target-option"><input type="checkbox" name="targets" value="${escape(stage.id)}" ${draft.targets.includes(stage.id) ? 'checked' : ''}><span># ${escape(stage.label)}</span></label>`).join('');
 const stageChoices = [{id:'', label:'暂不填写'}, ...state.user.stages].map(stage => `<label class="composer-text-option"><input type="radio" name="stage" value="${escape(stage.id)}" ${draft.stage === stage.id ? 'checked' : ''}><span>${stage.id ? '# ' : ''}${escape(stage.label)}</span></label>`).join('');
 const directions = [['older','听过来人说'],['younger','听没过来人说']].map(([id,label]) => `<label class="composer-text-option"><input type="radio" name="direction" value="${id}" ${draft.direction === id ? 'checked' : ''}><span>${label}</span></label>`).join('');
 const publish = '<button class="composer-publish" type="submit" form="ask-form"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m21 3-7 18-4-7-7-4 18-7Zm0 0L10 14"/></svg><span>发布</span></button>';
 const composerBar = `<div class="screen-bar composer-bar"><button class="composer-back" data-action="back" aria-label="返回">←</button><span>向大家提问</span><span class="screen-bar-trailing">${publish}</span></div>`;
 app.innerHTML = `${composerBar}<section class="composer-screen"><div class="composer-channel-context composer-public-author">${authorBadgeHTML(state.user?.author)}<span>公开提问</span></div>${fromAI ? '<p class="composer-context-note">已带入刚才的追问，可继续修改后发布。</p>' : ''}<form id="ask-form" class="composer-form" data-draft-key="${escape(draftKey)}" data-source-seed="${escape(sourceSeed)}"><div class="composer-field composer-question-field"><label for="question-title">问题</label><textarea id="question-title" name="title" required maxlength="100" aria-describedby="question-title-status" placeholder="写下你真正想问的问题">${escape(draft.title)}</textarea><p id="question-title-status" class="field-status" aria-live="polite"></p></div><div class="composer-field composer-background-field"><label for="question-body">补充背景 <span>选填</span></label><textarea id="question-body" name="body" maxlength="1000" aria-describedby="question-body-status" placeholder="补充经历或困惑，让回答更贴近你"></textarea><p id="question-body-status" class="field-status" aria-live="polite"></p></div><fieldset class="composer-personal"><legend>我的阶段 <small>选填，仅用于这条问题</small></legend><div class="composer-personal-options">${stageChoices}</div></fieldset><fieldset class="composer-direction"><legend>提问方向</legend><div class="composer-personal-options">${directions}</div></fieldset><section class="composer-target-section" aria-labelledby="composer-target-heading"><div class="composer-target-heading"><div><strong id="composer-target-heading">想听谁说</strong><small>只是表达期待，不限制其他阶段回答</small></div><span id="question-target-status" class="field-status" aria-live="polite"></span></div><div class="composer-target-summary"><div class="composer-selected-targets" aria-label="已选择阶段"></div><button type="button" class="composer-target-add" data-action="toggle-targets" aria-expanded="false" aria-controls="composer-target-picker"># 想听谁说</button></div><div id="composer-target-picker" class="composer-target-picker" hidden><fieldset><legend class="sr-only">选择希望回答的阶段，可不选，最多六个</legend><div class="composer-target-options">${targetChoices}</div><p id="composer-target-empty" class="helper" hidden>这个方向没有可选阶段，可以切换提问方向。</p></fieldset><div class="composer-target-picker-footer"><span>可不选，也可以多选</span><button type="button" data-action="finish-targets">完成</button></div></div></section></form></section>`;
 app.querySelector('#question-body').value = draft.body;
 app.scrollTop = 0; updateComposerChoices();
 let lastComposerWidth=0;
 composerResize=new ResizeObserver(entries=>{const width=entries[0].contentRect.width;if(width!==lastComposerWidth){lastComposerWidth=width;fitComposerTextareas();}});
 composerResize.observe(app.querySelector('.composer-screen'));
 requestAnimationFrame(() => app.querySelector('#question-title')?.focus({preventScroll:true}));
}
function availableAnswerStages(q) { const present = new Set(q.answers.map(answer => answer.stage)); return state.user.stages.map(stage => stage.id).filter(id => present.has(id)); }
function contentScopeLabel(scope) { return ({summary:'摘要', excerpt:'节选', full:'全文'})[scope] || '资料'; }
function canInviteCommunity(snapshot) {
 if (!snapshot) return false;
 return snapshot.turns_used >= 3 || (snapshot.status === 'insufficient_evidence' && snapshot.turns_used === 1);
}
function aiTurnHTML(turn, index, invite) {
 const citations = Array.isArray(turn.citations) ? turn.citations : [];
 const followups = Array.isArray(turn.followups) ? turn.followups : [];
 let result = '';
 if (turn.status === 'running') result = '<p class="ai-turn-state">正在从已核验资料里寻找线索…</p>';
 if (turn.status === 'answered') result = `<p class="ai-answer">${escape(turn.answer)}</p>${citations.length ? `<div class="ai-citations"><span>依据资料 ${citations.length} 条</span>${citations.map(citation => `<a href="${escape(citation.source_url)}" target="_blank" rel="noreferrer"><strong>${escape(citation.title || '来源资料')}</strong><small>${escape(contentScopeLabel(citation.content_scope))} · ${escape(citation.quote)}</small></a>`).join('')}</div>` : ''}${followups.length ? `<div class="ai-followups" aria-label="可继续追问">${followups.map((text, followupIndex) => `<button type="button" data-action="use-followup" data-turn-index="${index}" data-followup-index="${followupIndex}">${escape(text)}</button>`).join('')}</div>` : ''}`;
 if (turn.status === 'insufficient_evidence') result = '<p class="ai-turn-state">现有资料还不足以可靠回答。你可以把这句话交给不同阶段的人。</p>';
 if (turn.status === 'failed') result = `<p class="error-inline">${escape(turn.error || '这次没有整理成功，可以重新提问。')}</p>`;
 return `<article class="ai-turn"><div class="ai-question-label">你的追问</div><p class="ai-question">${escape(turn.question)}</p>${result}${invite && (turn.status === 'answered' || turn.status === 'insufficient_evidence') ? `<button class="ask-community-link" type="button" data-action="ask-from-ai" data-turn-index="${index}">用这句问大家 ↗</button>` : ''}</article>`;
}
function aiPanelHTML(q, view) {
 const snapshot = view.aiSnapshot;
 const turns = Array.isArray(snapshot?.turns) ? snapshot.turns : [];
 const invite = canInviteCommunity(snapshot);
 let status = '';
 if (view.aiLoading && !snapshot) status = '<div class="ai-status" role="status">正在恢复这道问题的资料记录…</div>';
 else if (view.aiError) status = `<div class="ai-status error-inline" role="alert">${escape(view.aiError)} <button type="button" data-action="refresh-ai">检查结果</button></div>`;
 else if (snapshot?.status === 'source_unavailable') status = '<div class="ai-status">原资料已不可用，当前记录不再展示引用，也无法继续追问。</div>';
 else if (snapshot?.status === 'running') status = '<div class="ai-status" role="status">资料整理仍在进行。离开页面也不会自动重发。</div>';
 else if (snapshot?.status === 'limit_reached') status = '<div class="ai-status">本题的三次资料追问已经完成。</div>';
 else if (snapshot?.status === 'insufficient_evidence') status = '<div class="ai-status">首问没有足够资料，本轮已停止继续追问。</div>';
 const canAsk = !!snapshot?.can_ask && snapshot.status !== 'running' && !view.aiUncertain;
 const form = snapshot && canAsk ? `<form id="ai-question-form" class="ai-question-form"><label for="ai-question">继续问资料</label><textarea id="ai-question" name="question" required maxlength="1000" rows="3" placeholder="问一个和当前问题有关的具体问题">${escape(view.aiDraft)}</textarea><div class="ai-compose-row"><span><span id="ai-draft-count">${view.aiDraft.length}</span>/1000 · 还可问 ${snapshot.turns_remaining} 次</span><button type="submit" ${view.aiSubmitting ? 'disabled' : ''}>${view.aiSubmitting ? '正在发送…' : '发送'}</button></div></form>` : '';
 const empty = snapshot && !turns.length && snapshot.status === 'ready' ? '<p class="ai-empty">资料回答会标明出处，不会替代真人自述。</p>' : '';
 const check = snapshot?.status === 'running' ? '<button class="ai-check-button" type="button" data-action="refresh-ai">检查结果</button>' : '';
 return `${turns.map((turn, index) => aiTurnHTML(turn, index, invite)).join('')}${empty}${status}${check}${form}`;
}
function detailAnswers(q) { return [...q.answers,{id:'kanshan',ai_page:true}]; }
function answerActionIcon(type) {
 const paths = {up:'<path d="m12 3 10 17H2Z"/>',down:'<path d="m12 21 10-17H2Z"/>',save:'<path d="m12 2 3.1 6.3 6.9 1-5 4.9 1.2 6.9L12 17.8 5.8 21.1 7 14.2 2 9.3l6.9-1Z"/>',comment:'<path d="M21 11.5a9 9 0 0 1-9 9H4l-2 2v-11a9.5 9.5 0 0 1 19 0Z"/>',more:'<circle cx="12" cy="4" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="12" cy="20" r="1"/>'};
 return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.65" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[type]}</svg>`;
}
function kanshanRevealHTML(text) {
 const chunks=Array.from(text).join('').match(/[\s\S]{1,14}/gu)||[];
 return chunks.map((chunk,i)=>`<span class="kanshan-ink" style="--ink-delay:${Math.min(i*32,1600)}ms">${escape(chunk)}</span>`).join('');
}
function kanshanSectionHTML(view,{reveal=false}={}) {
 if(!view.kanshanOpened)return `<button class="kanshan-invite" data-action="kanshan-start" aria-label="问问看山"><span class="kanshan-invite-avatar" aria-hidden="true">${refreshDogHTML()}</span><span><strong>问问看山</strong><small>再听一个新的角度</small></span><span class="kanshan-invite-arrow" aria-hidden="true">↗</span></button>`;
 const busy=view.kanshanBusy||(view.kanshanSnapshot?.status==='running'&&!view.kanshanError);
 return `${busy?'':`<div class="answer-person kanshan-person">${kanshanHeader(view)}</div>`}<div class="kanshan-content">${kanshanPageContent(view,{reveal})}</div>${busy?'':`<details class="kanshan-about"><summary>关于这份 AI 回答</summary><p>由 DeepSeek 结合来源资料生成，并非知乎官方看山服务。</p><a href="/library.html" target="_blank" rel="noopener">查看来源资料库 ↗</a></details>`}`;
}
function kanshanPageContent(view,{reveal=false}={}) {
 const snapshot=view.kanshanSnapshot, busy=view.kanshanBusy||(snapshot?.status==='running'&&!view.kanshanError);
 const retrieval=snapshot?.retrieval||{};
 const searchLabels={local_library:'已查阅本地来源资料',insufficient_evidence:'已检索，但资料不足以支持本题',completed:'已检索联网资料',empty:'暂未找到合适的联网资料',not_configured:'联网检索暂未配置',authentication_error:'联网检索暂不可用',rate_limited:'联网检索额度暂不可用',timeout:'联网检索超时',upstream_error:'联网检索暂不可用'};
 const status=busy?`<div class="kanshan-state" role="status"><span class="kanshan-thinking" aria-hidden="true">${refreshDogHTML()}</span><strong>${snapshot?.phase==='generating'?'看山正在整理回答…':'正在查找相关资料…'}</strong><p>可以先回看大家的回答，结果会保存在这里。</p></div>`:'';
 if(busy)return status;
 const error=view.kanshanError||snapshot?.error;
 const errorHTML=error?`<div class="kanshan-state" role="status">${escape(error)}<button data-action="kanshan-check">查看生成结果</button><button data-action="kanshan-refresh">再试一次</button></div>`:'';
 const sources=snapshot?.sources||[];
 const sourceHTML=source=>{const quote=Array.from(source.quote||'');return `<details class="kanshan-source"><summary>[${escape(source.id)}] ${escape(source.title)}</summary><blockquote>${escape(quote.slice(0,80).join(''))}${quote.length>80?'…':''}</blockquote><a href="${escape(source.url)}" target="_blank" rel="noopener noreferrer">查看原文 ↗</a></details>`;};
 const sourceList=sources.slice(0,2).map(sourceHTML).join('')+(sources.length>2?`<details class="kanshan-more-sources"><summary>其余 ${sources.length-2} 条参考资料</summary><div>${sources.slice(2).map(sourceHTML).join('')}</div></details>`:'');
 const answer=snapshot?.answer?`<p class="answer-full-text">${reveal?kanshanRevealHTML(snapshot.answer):escape(snapshot.answer)}</p><div class="kanshan-sources">${sourceList}</div><p class="kanshan-footnote">${sources.length?'依据来源摘要整理，可查看原文。':escape(searchLabels[retrieval.status]||'此前保存的回答')+'；仅供一般思路参考。'}</p>`:'';
 if(busy||error||answer)return status+errorHTML+answer;
 return '<div class="kanshan-state"><p>看看资料，再听一个新的角度。</p><button data-action="kanshan-start">请看山想一想</button></div>';
}
function kanshanHeader(view) {
 const busy=view.kanshanBusy||(view.kanshanSnapshot?.status==='running'&&!view.kanshanError);
 return `<span class="kanshan-avatar" role="img" aria-label="看山">${refreshDogHTML()}</span><span class="kanshan-ai-mark">AI</span><button class="kanshan-refresh" data-action="kanshan-refresh" aria-label="重新生成 AI 回答" title="重新生成" ${busy?'disabled':''}><svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M20 7v5h-5M4 17v-5h5M5.5 7a7.5 7.5 0 0 1 12.3-1L20 9M4 15l2.2 3A7.5 7.5 0 0 0 18.5 17" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></svg></button>`;
}
function kanshanAnswerPage(view,index,active) {
 return `<article class="answer-page kanshan-answer-page" data-answer-id="kanshan" aria-label="看山 AI 的回答" aria-hidden="${!active}" ${active?'':'inert'}><div class="answer-reader"><div class="answer-person kanshan-person">${kanshanHeader(view)}</div><div class="kanshan-content">${kanshanPageContent(view)}</div><div class="answer-swipe-hint">下滑回看大家的回答</div></div></article>`;
}
let kanshanFocusCleanup=null;
function focusKanshanThinking(){
 const stream=app.querySelector('.answer-stream'),thinking=app.querySelector('.kanshan-answer-page .kanshan-state');
 if(!stream?.getBoundingClientRect||!thinking?.getBoundingClientRect)return;
 kanshanFocusCleanup?.();
 const from=stream.scrollTop;
 const target=Math.max(from,Math.min(stream.scrollHeight-stream.clientHeight,from+thinking.getBoundingClientRect().bottom-stream.getBoundingClientRect().bottom+16));
 if(target-from<1)return;
 let frame=0,started=null;
 const cancel=()=>{cancelAnimationFrame(frame);['wheel','touchstart','pointerdown','keydown'].forEach(type=>stream.removeEventListener(type,cancel));if(kanshanFocusCleanup===cancel)kanshanFocusCleanup=null;};
 kanshanFocusCleanup=cancel;
 if(matchMedia('(prefers-reduced-motion: reduce)').matches){stream.scrollTop=target;cancel();return;}
 ['wheel','touchstart','pointerdown','keydown'].forEach(type=>stream.addEventListener(type,cancel,{passive:true}));
 const step=now=>{
  if(!stream.isConnected){cancel();return;}
  if(started===null)started=now;
  const progress=Math.min(1,(now-started)/640),eased=1-Math.pow(1-progress,3);
  stream.scrollTop=from+(target-from)*eased;
  if(progress<1)frame=requestAnimationFrame(step);else cancel();
 };
 frame=requestAnimationFrame(step);
}
async function loadKanshanPage(questionId,{start=false,refresh=false}={}) {
 const view=detailView(questionId);if(view.kanshanBusy)return;
 const openedAt=Date.now();
 const request= (view.kanshanRequest||0)+1;view.kanshanRequest=request;
 const current=()=>view.kanshanRequest===request;
 const visible=()=>current()&&state.screen==='detail'&&state.detail?.id===questionId&&!view.aiOpen&&view.kanshanOpened;
 const paint=()=>{if(visible()){
  const section=app.querySelector('.kanshan-answer-page');if(!section)return;
  const ready=!view.kanshanBusy&&view.kanshanSnapshot?.status!=='running';
  const key=ready&&view.kanshanSnapshot?.answer;
  const reveal=!!key&&view.kanshanRevealed!==key;
  const stream=app.querySelector('.answer-stream'),scrollTop=stream?.scrollTop;
  section.innerHTML=kanshanSectionHTML(view,{reveal});
  if(section.style)section.style.minHeight='205px';
  if(ready&&stream&&Number.isFinite(scrollTop))stream.scrollTop=scrollTop;
  if(reveal)view.kanshanRevealed=key;
 }};
 clearTimeout(kanshanPollTimer);view.kanshanBusy=true;view.kanshanError='';
 // Preserve the displayed generation for cross-tab optimistic concurrency.
 const expected=view.kanshanSnapshot?.generation;
 const requestId=refresh?newClientTurnId():null;
 if(refresh){view.kanshanPollStart=0;const reader=app.querySelector('.kanshan-answer-page .answer-reader');if(reader)reader.scrollTop=0;}
 paint();
 if(start||refresh)focusKanshanThinking();
 try {
  let snapshot=await api(`/questions/${questionId}/kanshan`);
  if(refresh&&visible()&&snapshot.status!=='running')snapshot=await api(`/questions/${questionId}/kanshan`,{refresh:true,client_turn_id:requestId,expected_generation:expected??snapshot.generation});
  else if(snapshot.status==='not_started'&&start&&visible())snapshot=await api(`/questions/${questionId}/kanshan`,{});
  if(start||refresh)await new Promise(resolve=>setTimeout(resolve,Math.max(0,720-(Date.now()-openedAt))));
  if(!current())return;
  view.kanshanSnapshot=snapshot;
  if(snapshot.status==='running'&&!view.kanshanPollStart)view.kanshanPollStart=Date.now();
  if(snapshot.status==='running'&&visible()) {
   if(Date.now()-view.kanshanPollStart<120000)kanshanPollTimer=setTimeout(()=>loadKanshanPage(questionId),1500);
   else view.kanshanError='整理时间较长，可以稍后查看结果。';
  }else view.kanshanPollStart=0;
 }catch(error){if(current())view.kanshanError='暂时无法确认生成结果，请先查看已有记录。';}
 finally{if(current()){view.kanshanBusy=false;paint();}}
}
function answerFlowFooter(q,view,answers,index) {
 if(answers[index]?.ai_page)return '<details class="kanshan-about"><summary>AI 回答说明</summary><p>本项目使用 DeepSeek 生成回答，知乎开放平台提供来源资料和联网检索；并非知乎官方看山服务。</p><a href="/library.html" target="_blank" rel="noopener">查看来源资料库 ↗</a></details>'+ (q.answers.length?'<button class="kanshan-return" data-action="answer-page" data-step="-1">返回大家的回答</button>':'<button class="kanshan-return" data-action="answer">我来回答</button>');
 const a=answers[index], saved=a&&stored('saved-answer:'+a.id,false), unhelpful=a&&stored('unhelpful-answer:'+a.id,false);
 return `<button class="answer-anonymous" data-action="answer"><span>${escape(state.user?.author?.name||'我')}</span><strong>写回答</strong></button>${a?`<button class="answer-icon-button ${a.voted?'voted':''}" data-action="vote" data-id="${a.id}" data-voted="${!!a.voted}" aria-pressed="${!!a.voted}" aria-label="${a.voted?'取消赞同':'赞同回答'}">${answerActionIcon('up')}<span class="answer-action-count">${formatVoteCount(a.votes)}</span></button><button class="answer-icon-button ${unhelpful?'voted':''}" data-action="answer-unhelpful" data-id="${a.id}" aria-pressed="${!!unhelpful}" aria-label="这条回答暂时没帮到我">${answerActionIcon('down')}</button><button class="answer-icon-button ${saved?'voted':''}" data-action="answer-save" data-id="${a.id}" aria-pressed="${!!saved}" aria-label="${saved?'取消收藏':'收藏回答'}">${saveStarHTML()}</button><button class="answer-icon-button" data-action="${view.aiOpen?'toggle-ai':'answer-followup'}" data-id="${a.id}" aria-label="${view.aiOpen?'返回回答':'追问这条回答（资料三问）'}">${answerActionIcon('comment')}</button>`:''}<details class="answer-more"><summary aria-label="更多回答操作">${answerActionIcon('more')}</summary><div><button data-action="answer">写回答</button><button data-action="toggle-ai">${view.aiOpen?'返回回答':'资料三问'}</button>${a?`<small>${answerKind(a)==='示例'?'本条为体验示例':'阶段由回答者自述'}</small>`:''}</div></details>`;
}
function replyThreadHTML(a) {
 const replies=a.replies||[];
 return `<section class="reply-thread" id="reply-thread-${a.id}" aria-label="回答追评" hidden><div class="reply-list">${replies.map(replyRowHTML).join('')}</div><form class="reply-form" data-answer-id="${a.id}"><img src="${escape(state.user.author.avatar)}" alt="" width="28" height="28"><div><label class="sr-only" for="reply-body-${a.id}">写一条追评</label><textarea id="reply-body-${a.id}" name="body" maxlength="600" rows="2" required placeholder="接着聊聊你的看法…"></textarea><div class="reply-form-bottom"><span>回复 ${escape(a.author.name)}</span><button type="submit">发送</button></div><p class="reply-status" role="status"></p></div></form></section>`;
}
function replyRowHTML(reply) {
 return `<article class="reply-row"><img src="${escape(reply.author.avatar)}" alt="" width="28" height="28"><div><div class="reply-person"><strong>${escape(reply.author.name)}</strong>${reply.author.simulated?`<small class="ai-role" title="虚拟角色 · ${reply.author.age}岁">AI 角色</small>`:''}<span>${escape(stageName(reply.stage))}</span></div><p>${escape(reply.body)}</p></div></article>`;
}
async function submitReply(form) {
 const button=form.querySelector('button[type="submit"]'),field=form.elements.body;
 if(button.disabled||!field.value.trim())return;
 const body=field.value.trim(),aid=Number(form.dataset.answerId),question=state.detail;
 if(form.dataset.sentBody!==body){form.dataset.clientId=newClientTurnId();form.dataset.sentBody=body;}
 button.disabled=true;form.querySelector('.reply-status').textContent='';
 try {
  const reply=await api('/replies',{answer_id:aid,body,client_id:form.dataset.clientId});
  const answer=question.answers.find(a=>a.id===aid);answer.replies=answer.replies||[];
  if(!answer.replies.some(r=>r.id===reply.id))answer.replies.push(reply);
  if(!form.isConnected)return;
  form.previousElementSibling.innerHTML=answer.replies.map(replyRowHTML).join('');
  const trigger=app.querySelector(`[data-action="toggle-replies"][data-id="${aid}"]`);
  trigger.querySelector('.reply-count').textContent=answer.replies.length;
  field.value='';delete form.dataset.clientId;delete form.dataset.sentBody;
  form.querySelector('.reply-status').textContent='已发送';
 }catch(error){if(form.isConnected)form.querySelector('.reply-status').textContent=error.message||'发送失败，文字已保留，请重试';}
 finally{button.disabled=false;}
}
function answerAttachmentsHTML(answer){
 const topics=Array.isArray(answer.topics)?answer.topics:[],tags=Array.isArray(answer.tags)?answer.tags:[],images=Array.isArray(answer.images)?answer.images:[];
 const chips=topics.map(topic=>`<span class="answer-topic"># ${escape(topic)}</span>`).join('')+tags.map(tag=>`<span class="answer-label">${escape(tag)}</span>`).join('');
 return `${images.length?`<div class="answer-images ${images.length===1?'single-image':''}">${images.map((url,i)=>`<button type="button" data-action="view-answer-image" data-src="${escape(url)}" aria-label="查看回答配图 ${i+1}"><img src="${escape(url)}" alt="回答配图 ${i+1}" loading="lazy"></button>`).join('')}</div>`:''}${chips?`<div class="answer-topics" aria-label="话题与标签">${chips}</div>`:''}`;
}
function openAnswerImage(src){
 if(!/^\/uploads\/[a-f0-9]+\.(?:jpg|jpeg|png|webp)$/.test(src))return;
 const dialog=document.createElement('dialog');dialog.className='answer-image-viewer';dialog.setAttribute('aria-label','查看回答配图');
 dialog.innerHTML=`<button type="button" aria-label="关闭图片">×</button><img src="${escape(src)}" alt="回答配图大图">`;
 dialog.querySelector('button').addEventListener('click',()=>dialog.close());
 dialog.addEventListener('click',event=>{if(event.target===dialog)dialog.close();});
 dialog.addEventListener('close',()=>dialog.remove(),{once:true});phone.append(dialog);dialog.showModal();
}
function readingAnswerHTML(a,i) { return `<article class="reading-answer" data-answer-id="${a.id}" aria-label="第 ${i+1} 条回答，${escape(stageName(a.stage))}"><div class="answer-person">${authorBadgeHTML(a.author)}<span>${escape(stageName(a.stage))}</span></div>${a.body?`<p class="answer-full-text">${escape(a.body)}</p>`:''}${answerAttachmentsHTML(a)}<div class="reading-actions"><button data-action="vote" data-id="${a.id}" data-voted="${!!a.voted}" aria-pressed="${!!a.voted}" aria-label="${a.voted?'取消赞同':'赞同回答'}" class="${a.voted?'voted':''}">${voteHeartHTML(a.voted)} <span>${formatVoteCount(a.votes)}</span></button><button data-action="answer-save" data-id="${a.id}" aria-pressed="${!!stored('saved-answer:'+a.id,false)}" aria-label="${stored('saved-answer:'+a.id,false)?'取消收藏':'收藏回答'}" class="${stored('saved-answer:'+a.id,false)?'voted':''}">${saveStarHTML()}</button><button data-action="toggle-replies" data-id="${a.id}" aria-label="查看追评" aria-expanded="false" aria-controls="reply-thread-${a.id}"><svg class="reply-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M20.5 11.5a8.5 8.5 0 0 1-8.5 8.5H4l1.3-4.1A8.5 8.5 0 1 1 20.5 11.5Z"/></svg><span class="reply-count">${a.replies?.length||''}</span></button></div>${replyThreadHTML(a)}</article>`; }
function renderDetail({focusAnswerId = null} = {}) {
 const q=state.detail;if(!q)return;
 const view=detailView(q.id),oldStream=app.querySelector('.answer-stream'),oldAI=app.querySelector('.answer-ai-view');
 if(oldStream)view.streamScroll=oldStream.scrollTop;
 if(oldAI)view.aiScroll=oldAI.scrollTop;
 if(focusAnswerId){view.answerId=focusAnswerId;view.aiOpen=false;}
 controls(false);app.classList.add('answer-flow-mode');state.screen='detail';
 const questionBody=(q.body||'').trim()==='本题及初始回答为体验示例，可继续分享你自己的经历。'?'':q.body;
 const title=`<header class="reading-question"><h1>${escape(q.title)}</h1><div class="question-public-author">${authorBadgeHTML(q.author)}<span>提问</span></div>${questionBody?`<p class="reading-background">${escape(questionBody)}</p>`:''}</header>`;
 const rows=q.answers.map(readingAnswerHTML).join('<div class="reading-divider" aria-hidden="true"><span>✦</span></div>');
 const ai=`<article class="reading-answer kanshan-answer-page" data-answer-id="kanshan" aria-label="看山 AI 的回答">${kanshanSectionHTML(view)}</article>`;
 const body=view.aiOpen?`<section class="answer-ai-view"><p class="answer-ai-context">资料三问 · AI 根据来源继续讨论，不代表回答者本人。</p><div id="detail-ai-panel" class="detail-ai-panel">${aiPanelHTML(q,view)}</div></section>`:`<section class="answer-stream" aria-label="问题与全部回答，连续滚动阅读" tabindex="0">${title}${rows||'<p class="reading-empty">还没有回答，愿意分享你的经历吗？</p>'}<div class="reading-divider" aria-hidden="true"><span>✦</span></div>${ai}<div class="reading-end" aria-hidden="true">·</div></section>`;
 app.innerHTML=`<div class="answer-flow-shell reading-shell"><button class="reading-back" data-action="${view.aiOpen?'toggle-ai':'back'}" aria-label="${view.aiOpen?'返回回答':'返回'}"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m14 6-6 6 6 6"/></svg></button>${body}<footer class="reading-bottom"><button data-action="answer">写回答 <span>↗</span></button>${view.aiOpen?'<button data-action="toggle-ai">返回回答</button>':''}</footer></div>`;
 app.scrollTop=0;saveDetailView(q.id);
 requestAnimationFrame(()=>{if(state.screen!=='detail'||state.detail?.id!==q.id)return;
  if(view.aiOpen){const el=app.querySelector('.answer-ai-view');if(el)el.scrollTop=view.aiScroll||0;}
  else {const stream=app.querySelector('.answer-stream');if(!stream)return;stream.scrollTop=view.streamScroll||0;stream.addEventListener('scroll',()=>{view.streamScroll=stream.scrollTop;},{passive:true});if(focusAnswerId)[...stream.querySelectorAll('[data-answer-id]')].find(el=>el.dataset.answerId===String(focusAnswerId))?.scrollIntoView({block:'start'});if(view.kanshanOpened)loadKanshanPage(q.id);}
 });
}
function bindAnswerDeck(q,view,answers,start) {
 const deck=app.querySelector('.answer-deck'),surface=app.querySelector('.answer-flow-shell');
 if(!deck||!surface||!answers.length)return;
 const pages=[...deck.querySelectorAll('.answer-page')];
 let index=start,drag=null,suppressClickUntil=0;
 let lastWheel=-Infinity,wheelConsumed=false,wheelDistance=0,wheelMode=null,wheelReader=null,wheelDirection=0;
 const reduced=matchMedia('(prefers-reduced-motion: reduce)').matches;
 function paint(offset=0,animate=true) {
  pages.forEach((p,i)=>{
   p.style.transition=animate&&!reduced?'transform 260ms cubic-bezier(.2,.75,.25,1)':'none';
   p.style.transform=offset?`translate3d(0,calc(${(i-index)*100}% + ${offset}px),0)`:`translate3d(0,${(i-index)*100}%,0)`;
  });
 }
 function go(next,animate=true) {
  index=clamp(next,0,answers.length-1);view.answerId=answers[index].id;saveDetailView(q.id);
  pages.forEach((p,i)=>{p.inert=i!==index;p.setAttribute('aria-hidden',String(i!==index));});
  paint(0,animate);
  app.querySelector('.answer-flow-count').textContent=`${index+1} / ${answers.length}`;
  app.querySelector('[data-action="answer-page"][data-step="-1"]').disabled=index===0;
  app.querySelector('[data-action="answer-page"][data-step="1"]').disabled=index===answers.length-1;
  app.querySelector('.answer-flow-bottom').innerHTML=answerFlowFooter(q,view,answers,index);
  if(answers[index]?.ai_page)loadKanshanPage(q.id,{start:animate});
  else {clearTimeout(kanshanPollTimer);kanshanPollTimer=0;}
 }
 function canFlip(reader,dir){return !reader||reader.scrollHeight<=reader.clientHeight+2||(dir>0?reader.scrollTop+reader.clientHeight>=reader.scrollHeight-2:reader.scrollTop<=2);}
 function move(step){const next=clamp(index+step,0,answers.length-1);if(next===index){paint();return false;}go(next);return true;}
 function readerAt(target){return pages[index].querySelector?.('.answer-reader')||target.closest('.answer-reader,.answer-flow-background,.answer-flow-header');}
 function hasPage(dir){return index+dir>=0&&index+dir<answers.length;}
 deck.answerMove=step=>move(step);go(index,false);
 answerDeckResize=null;
 // A wheel burst owns one reading/paging decision. Speed changes and reversals
 // cannot rearm it; wait for a quiet interval before accepting a new burst.
 surface.addEventListener('wheel',e=>{
  if(e.ctrlKey||drag||e.target.closest('input,textarea,select')||Math.abs(e.deltaY)<Math.abs(e.deltaX)||!e.deltaY)return;
  const now=performance.now(),dir=Math.sign(e.deltaY);
  const amount=Math.abs(e.deltaY)*(e.deltaMode===1?16:e.deltaMode===2?deck.clientHeight:1);
  if(now-lastWheel>240){
   wheelConsumed=false;wheelDistance=0;wheelDirection=dir;wheelReader=readerAt(e.target);
   wheelMode=canFlip(wheelReader,dir)?'page':'read';
  }
  lastWheel=now;e.preventDefault();
  if(wheelConsumed)return;
  if(wheelMode==='read'){
   wheelReader.scrollTop=clamp(wheelReader.scrollTop+dir*amount,0,wheelReader.scrollHeight-wheelReader.clientHeight);
   return; // Reaching an edge never upgrades this same gesture to paging.
  }
  if(dir!==wheelDirection){wheelConsumed=true;return;}
  wheelDistance+=amount;
  if(wheelDistance>=18){wheelConsumed=true;move(dir);}
 },{passive:false});
 // Capture on the whole detail shell, including title, controls and whitespace.
 // A new pointerdown is an independent gesture, even during the previous transition.
 surface.addEventListener('pointerdown',e=>{
  if(e.isPrimary===false){cancelDrag();return;}
  if(e.button!==0||e.target.closest('input,textarea,select'))return;
  suppressClickUntil=0;
  drag={id:e.pointerId,x:e.clientX,y:e.clientY,lastY:e.clientY,edge:0,moved:false,mode:null,direction:0,reader:readerAt(e.target),canUp:canFlip(readerAt(e.target),1),canDown:canFlip(readerAt(e.target),-1),originOffset:pages[index].getBoundingClientRect().top-deck.getBoundingClientRect().top};
 });
 surface.addEventListener('pointermove',e=>{
  if(!drag||drag.id!==e.pointerId)return;
  const dy=drag.y-e.clientY,dx=drag.x-e.clientX;
  if(!drag.moved){
   if(Math.max(Math.abs(dy),Math.abs(dx))<8)return;
   if(Math.abs(dx)>Math.abs(dy)){cancelDrag();return;}
   drag.moved=true;surface.setPointerCapture?.(e.pointerId);
  }
  e.preventDefault();
  if(!drag.mode){
   drag.direction=Math.sign(dy);
   drag.mode=(drag.direction>0?drag.canUp:drag.canDown)?'page':'read';
  }
  let remaining=drag.lastY-e.clientY;drag.lastY=e.clientY;
  const r=drag.reader;
  if(drag.mode==='read'){
   if(r)r.scrollTop=clamp(r.scrollTop+remaining,0,r.scrollHeight-r.clientHeight);
   return; // Lift and start again at the boundary to turn a page.
  }
  if(remaining){
   if(Math.sign(remaining)!==Math.sign(drag.edge))drag.edge=0;
   drag.edge+=remaining;
  }else drag.edge=0;
  const atEnd=(index===0&&drag.edge<0)||(index===answers.length-1&&drag.edge>0);
  paint((drag.mode==='page'?drag.originOffset:0)-clamp(drag.edge,-deck.clientHeight*.65,deck.clientHeight*.65)*(atEnd ? .2 : 1),false);
 },{passive:false});
 surface.addEventListener('pointerup',e=>{
  if(!drag||drag.id!==e.pointerId)return;
  const ended=drag;drag=null;
  if(surface.hasPointerCapture?.(e.pointerId))surface.releasePointerCapture(e.pointerId);
  if(ended.moved){
   suppressClickUntil=performance.now()+400;
   if(ended.mode==='page'&&Math.abs(ended.edge)>=18&&Math.sign(ended.edge)===ended.direction)move(ended.direction);else paint();
  }
 });
 function cancelDrag(){
  const ended=drag;drag=null;
  if(ended?.moved){suppressClickUntil=performance.now()+400;paint();}
  if(ended&&surface.hasPointerCapture?.(ended.id))surface.releasePointerCapture(ended.id);
 }
 surface.addEventListener('pointercancel',cancelDrag);surface.addEventListener('lostpointercapture',cancelDrag);
 surface.addEventListener('click',e=>{if(performance.now()<suppressClickUntil){e.preventDefault();e.stopPropagation();}},true);
 surface.addEventListener('keydown',e=>{if(e.target.closest('button,input,textarea,a,summary,select'))return;if(['ArrowDown','PageDown','ArrowUp','PageUp'].includes(e.key)){e.preventDefault();move(['ArrowDown','PageDown'].includes(e.key)?1:-1);}});
}
function applyAISnapshot(id, snapshot, error = '') {
 const view = detailView(id); view.aiSnapshot = snapshot; view.aiLoading = false; view.aiSubmitting = false; view.aiUncertain = false; view.aiError = error;
 if (snapshot?.status === 'running') scheduleAIPoll(id); else cleanupAIPoll();
 if (state.screen === 'detail' && state.detail?.id === id) { view.scrollTop = app.scrollTop; renderDetail(); }
}
function isAISnapshot(value) { return value && Number.isInteger(value.question_id) && Array.isArray(value.turns); }
async function loadAIState(id, {poll = false} = {}) {
 const view = detailView(id); const ticket = ++state.aiRequest;
 if (!poll && !view.aiSnapshot) { view.aiLoading = true; view.aiError = ''; if (state.screen === 'detail' && state.detail?.id === id) renderDetail(); }
 try {
  const snapshot = await api(`/questions/${id}/ai`);
  if (ticket !== state.aiRequest || state.screen !== 'detail' || state.detail?.id !== id) return;
  applyAISnapshot(id, snapshot);
 } catch (error) {
  if (ticket !== state.aiRequest || state.screen !== 'detail' || state.detail?.id !== id) return;
  if (isAISnapshot(error.payload)) applyAISnapshot(id, error.payload, error.message); else { view.aiLoading = false; view.aiSubmitting = false; view.aiError = error.message; renderDetail(); }
 }
}
function scheduleAIPoll(id) {
 if (!aiPollStartedAt) aiPollStartedAt = Date.now();
 clearTimeout(aiPollTimer);
 if (Date.now() - aiPollStartedAt >= 150000) { const view = detailView(id); view.aiError = '整理时间较长，可以稍后手动检查结果。'; if (state.screen === 'detail' && state.detail?.id === id) renderDetail(); return; }
 aiPollTimer = setTimeout(() => { if (state.screen === 'detail' && state.detail?.id === id) loadAIState(id, {poll:true}); }, 2000);
}
function newClientTurnId() { return globalThis.crypto?.randomUUID ? crypto.randomUUID() : `turn-${Date.now()}-${Math.random().toString(36).slice(2)}`; }
async function submitAIQuestion(form) {
 const q = state.detail; if (!q) return;
 const view = detailView(q.id); const question = String(new FormData(form).get('question') || '').trim();
 if (!question || question.length > 1000 || view.aiSubmitting) return;
 const clientTurnId = newClientTurnId(); const ticket = ++state.aiRequest;
 view.aiDraft = question; view.aiSubmitting = true; view.aiError = ''; saveDetailView(q.id); view.scrollTop = app.scrollTop; renderDetail();
 try {
  const snapshot = await api(`/questions/${q.id}/ai`, {question, client_turn_id:clientTurnId});
  if (ticket !== state.aiRequest || state.screen !== 'detail' || state.detail?.id !== q.id) return;
  const recorded = snapshot.turns?.find(turn => turn.client_turn_id === clientTurnId);
  if (recorded && (recorded.status === 'answered' || recorded.status === 'insufficient_evidence')) view.aiDraft = '';
  applyAISnapshot(q.id, snapshot);
 } catch (error) {
  if (ticket !== state.aiRequest || state.screen !== 'detail' || state.detail?.id !== q.id) return;
  if (isAISnapshot(error.payload)) {
   const recorded = error.payload.turns.find(turn => turn.client_turn_id === clientTurnId);
   if (recorded && (recorded.status === 'answered' || recorded.status === 'insufficient_evidence')) view.aiDraft = '';
   applyAISnapshot(q.id, error.payload, error.payload.status === 'running' ? '' : error.message);
  } else { view.aiSubmitting = false; view.aiUncertain = true; view.aiError = '发送结果尚未确认，请先检查结果，避免重复提问。'; renderDetail(); }
 } finally { saveDetailView(q.id); }
}
async function showDetail(id, {captureFeed = true, focusAnswerId = null} = {}) {
 const enteringFromFeed=captureFeed&&state.screen==='feed';
 if (captureFeed && state.screen === 'feed') captureFeedView(id);
 if (state.screen === 'detail' && state.detail) { const current = detailView(state.detail.id); current.scrollTop = app.scrollTop; saveDetailView(state.detail.id); }
 cleanupAIPoll(); state.aiRequest++;
 const ticket = ++state.request; const q = await api('/questions/' + id); if (ticket !== state.request) return;
 const entryView=detailView(q.id);entryView.kanshanOpened=false;entryView.kanshanBusy=false;entryView.kanshanRevealed=null;entryView.kanshanError='';entryView.kanshanRequest=(entryView.kanshanRequest||0)+1;
 if(enteringFromFeed)entryView.aiOpen=false;
 state.detail = q; state.screen = 'detail'; renderDetail({focusAnswerId});
 const view = detailView(id); if (view.aiOpen) loadAIState(id);
}
const answerEditor={questionId:null,body:'',tags:[],topics:[],images:[],uploading:false};
function answerEditorIcon(kind){
 const paths={image:'<rect x="3" y="3" width="18" height="18" rx="3"/><circle cx="8" cy="8" r="1.5"/><path d="m3 17 5-5 4 4 4-6 5 6"/>',tag:'<path d="M3 4h8l10 10-7 7L3 10Z"/><circle cx="7.5" cy="8" r="1"/>',close:'<path d="m5 5 14 14M19 5 5 19"/>',plus:'<path d="M12 5v14M5 12h14"/>',draft:'<rect x="5" y="3" width="14" height="18" rx="2"/><path d="M8 8h8M8 12h8M8 16h5"/>'};
 return `<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">${paths[kind]||paths.tag}</svg>`;
}
function saveAnswerEditorDraft(){
 if(!answerEditor.questionId)return;
 const field=app.querySelector('#answer-body');if(field)answerEditor.body=field.value;
 store('answer-draft:'+answerEditor.questionId,{body:answerEditor.body,tags:answerEditor.tags,topics:answerEditor.topics,images:answerEditor.images});
}
function updateAnswerEditor(){
 const form=app.querySelector('#answer-form');if(!form||Number(form.dataset.questionId)!==answerEditor.questionId)return;
 const chips=app.querySelector('#answer-editor-chips');
 chips.innerHTML=['topics','tags'].map(kind=>answerEditor[kind].map((label,index)=>`<button type="button" class="answer-editor-chip ${kind}" data-editor-action="remove-chip" data-kind="${kind}" data-index="${index}">${kind==='topics'?'# ':''}${escape(label)}<span aria-hidden="true">×</span></button>`).join('')).join('');
 app.querySelector('#answer-editor-images').innerHTML=answerEditor.images.map((url,index)=>`<div class="answer-editor-photo"><button type="button" data-editor-action="preview-image" data-index="${index}" aria-label="预览第 ${index+1} 张图片"><img src="${escape(url)}" alt="待发布图片 ${index+1}"></button><button type="button" class="answer-editor-photo-remove" data-editor-action="remove-image" data-index="${index}" aria-label="移除第 ${index+1} 张图片">×</button></div>`).join('')+(answerEditor.images.length<4?`<button type="button" class="answer-editor-add-photo" data-editor-action="image" ${answerEditor.uploading?'disabled':''}>${answerEditorIcon('plus')}<span>${answerEditor.uploading?'正在添加…':'添加图片'}</span></button>`:'');
 const count=app.querySelector('#answer-editor-count');count.textContent=`${answerEditor.body.length}/1200`;
 const submit=app.querySelector('[form="answer-form"][type="submit"]');submit.disabled=answerEditor.uploading||(!answerEditor.body.trim()&&!answerEditor.images.length)||form.dataset.submitting==='true';
 const body=app.querySelector('#answer-body');body.required=!answerEditor.images.length;body.style.height='auto';body.style.height=Math.max(220,body.scrollHeight)+'px';
 saveAnswerEditorDraft();
}
function showAnswer(){
 ++state.request;cleanupAIPoll();const q=state.detail;state.screen='answer';controls(false);
 const saved=stored('answer-draft:'+q.id,{});
 Object.assign(answerEditor,{questionId:q.id,body:typeof saved.body==='string'?saved.body:'',tags:Array.isArray(saved.tags)?saved.tags.slice(0,5):[],topics:Array.isArray(saved.topics)?saved.topics.slice(0,3):[],images:Array.isArray(saved.images)?saved.images.filter(url=>typeof url==='string'&&url.startsWith('/uploads/')).slice(0,4):[],uploading:false});
 app.innerHTML=`<section class="answer-editor-screen"><header class="answer-editor-header"><button type="button" class="answer-editor-close" data-action="back" aria-label="关闭写回答">${answerEditorIcon('close')}</button><div><button type="button" class="answer-editor-draft" data-editor-action="save-draft">${answerEditorIcon('draft')}<span>存草稿</span></button><button type="submit" form="answer-form" class="answer-editor-publish">发布</button></div></header><form id="answer-form" data-question-id="${q.id}" class="answer-editor-form"><div class="answer-editor-context">${authorBadgeHTML(state.user?.author)}<span>${escape(stageName(state.user.stage))}</span></div><h2>${escape(q.title)}</h2><label class="sr-only" for="answer-body">写下你的回答</label><textarea id="answer-body" name="body" required maxlength="1200" placeholder="从你所在的这一程，说说自己的经历…"></textarea><div id="answer-editor-chips" class="answer-editor-chips"></div><div id="answer-editor-picker" class="answer-editor-picker" hidden><div class="answer-editor-picker-row"><label id="answer-editor-picker-label" for="answer-topic-search">添加话题</label><button type="button" data-editor-action="close-picker" aria-label="收起">×</button></div><div class="answer-editor-picker-entry"><input id="answer-topic-search" autocomplete="off" maxlength="40" placeholder="输入话题，按回车添加"><button type="button" data-editor-action="add-chip">添加</button><button type="button" id="answer-topic-lookup" data-action="search-zhihu-topics">搜知乎</button></div><div id="answer-topic-results" class="answer-topic-results"></div><p id="answer-editor-picker-hint">最多添加 3 个话题</p></div><div id="answer-editor-images" class="answer-editor-images"></div><input type="file" id="answer-image-input" accept="image/jpeg,image/png,image/webp" multiple hidden></form><footer class="answer-editor-toolbar"><div><button type="button" data-editor-action="image" aria-label="添加图片">${answerEditorIcon('image')}</button><button type="button" data-editor-action="topics" aria-label="添加话题"><span class="answer-editor-hash">#</span></button><button type="button" data-editor-action="tags" aria-label="添加标签">${answerEditorIcon('tag')}</button></div><span id="answer-editor-count">0/1200</span></footer></section>`;
 app.querySelector('#answer-body').value=answerEditor.body;updateAnswerEditor();app.scrollTop=0;
}
function addAnswerEditorChip(){
 const panel=app.querySelector('#answer-editor-picker'),input=app.querySelector('#answer-topic-search');if(!panel||!input)return;
 const kind=panel.dataset.kind||'topics',limit=kind==='topics'?3:5,max=kind==='topics'?40:20;
 const text=input.value.trim().replace(/^#+/,'').trim();if(!text)return;
 if(text.length>max)return notice(`请控制在 ${max} 字以内`);
 if(answerEditor[kind].includes(text))return notice('已经添加过了');
 if(answerEditor[kind].length>=limit)return notice(`最多添加 ${limit} 个${kind==='topics'?'话题':'标签'}`);
 answerEditor[kind].push(text);input.value='';updateAnswerEditor();input.focus();
}
async function answerImageDataURL(file){
 if(!['image/jpeg','image/png','image/webp'].includes(file.type))throw new Error('请选择 JPG、PNG 或 WebP 图片');
 if(file.size>15*1024*1024)throw new Error('单张图片请小于 15 MB');
 const source=URL.createObjectURL(file);
 try{
  const image=new Image();image.src=source;await new Promise((resolve,reject)=>{image.onload=resolve;image.onerror=()=>reject(new Error('这张图片无法读取，请换一张'));});
  const scale=Math.min(1,1600/Math.max(image.width,image.height)),canvas=document.createElement('canvas');canvas.width=Math.max(1,Math.round(image.width*scale));canvas.height=Math.max(1,Math.round(image.height*scale));
  const ctx=canvas.getContext('2d');ctx.fillStyle='#fff';ctx.fillRect(0,0,canvas.width,canvas.height);ctx.drawImage(image,0,0,canvas.width,canvas.height);
  let quality=.86,result=canvas.toDataURL('image/jpeg',quality);while(result.length>2600000&&quality>.4){quality-=.15;result=canvas.toDataURL('image/jpeg',quality);}if(result.length>2800000)throw new Error('图片内容过大，请选择较小的图片');return result;
 }finally{URL.revokeObjectURL(source);}
}
async function uploadAnswerEditorImages(files){
 if(answerEditor.uploading)return;const questionId=answerEditor.questionId,room=4-answerEditor.images.length;
 if(!room)return notice('最多添加 4 张图片');
 const selected=Array.from(files).slice(0,room);if(files.length>room)notice('最多添加 4 张图片');
 answerEditor.uploading=true;updateAnswerEditor();
 try{for(const file of selected){const data_url=await answerImageDataURL(file),result=await api('/uploads',{data_url});if(answerEditor.questionId!==questionId)return;answerEditor.images.push(result.url);saveAnswerEditorDraft();updateAnswerEditor();}}
 catch(error){notice(error.message);}finally{if(answerEditor.questionId===questionId){answerEditor.uploading=false;updateAnswerEditor();}}
}
app.addEventListener('click',event=>{
 const button=event.target.closest('[data-editor-action]');if(!button)return;
 const action=button.dataset.editorAction;
 if(action==='preview-close'){app.querySelector('.answer-editor-preview')?.remove();return;}
 if(state.screen!=='answer')return;
 if(action==='image')return app.querySelector('#answer-image-input')?.click();
 if(action==='save-draft'){saveAnswerEditorDraft();notice('草稿已保存，再次打开可继续写');return;}
 if(action==='topics'||action==='tags'){
  const panel=app.querySelector('#answer-editor-picker'),input=app.querySelector('#answer-topic-search'),name=action==='topics'?'话题':'标签';panel.hidden=false;panel.dataset.kind=action;app.querySelector('#answer-topic-lookup').hidden=action!=='topics';input.maxLength=action==='topics'?40:20;input.placeholder=`输入${name}，按回车添加`;app.querySelector('#answer-editor-picker-label').textContent='添加'+name;app.querySelector('#answer-editor-picker-hint').textContent=`最多添加 ${action==='topics'?3:5} 个${name}`;app.querySelector('#answer-topic-results').innerHTML='';input.focus();panel.scrollIntoView({block:'nearest',behavior:'smooth'});return;
 }
 if(action==='close-picker'){app.querySelector('#answer-editor-picker').hidden=true;return;}
 if(action==='add-chip')return addAnswerEditorChip();
 if(action==='remove-chip'){answerEditor[button.dataset.kind].splice(Number(button.dataset.index),1);return updateAnswerEditor();}
 if(action==='remove-image'){answerEditor.images.splice(Number(button.dataset.index),1);return updateAnswerEditor();}
 if(action==='preview-image'){const url=answerEditor.images[Number(button.dataset.index)];app.insertAdjacentHTML('beforeend',`<div class="answer-editor-preview" role="dialog" aria-modal="true" aria-label="图片预览"><button type="button" data-editor-action="preview-close" aria-label="关闭图片预览">×</button><img src="${escape(url)}" alt="待发布图片预览"></div>`);app.querySelector('.answer-editor-preview button')?.focus();}
});
app.addEventListener('input',event=>{if(event.target.id==='answer-body'){answerEditor.body=event.target.value;updateAnswerEditor();}});
app.addEventListener('keydown',event=>{if(event.target.id==='answer-topic-search'&&event.key==='Enter'){event.preventDefault();addAnswerEditorChip();}if(event.key==='Escape')app.querySelector('.answer-editor-preview')?.remove();});
app.addEventListener('change',event=>{if(event.target.id==='answer-image-input'){uploadAnswerEditorImages(event.target.files);event.target.value='';}});
window.addEventListener('pagehide',()=>{if(state.screen==='answer')saveAnswerEditorDraft();});

function showSavedRecovery(questionId, kind) {
 state.screen = 'saved'; controls(false);
 app.innerHTML = `${bar('已经保存')}<section class="saved-state"><strong>${kind === 'answer' ? '回答已经留下' : '问题已经送出'}</strong><p>内容已经成功保存，只是详情暂时没有刷新出来。请不要重复发布。</p><button class="primary-button" data-action="reopen-detail" data-id="${questionId}">重新查看详情</button></section>`;
 app.scrollTop = 0;
}
function updateVoteState(answerId, result) {
 const apply = answer => { if (answer?.id === answerId) { answer.votes = result.votes; answer.voted = result.voted; } };
 state.feed.forEach(question => apply(question.answer));
 state.detail?.answers?.forEach(apply);
}
function playVoteHeart(button) {
 if (!button.querySelector('.vote-heart')) return;
 button.classList.remove('is-heart-popping');
 void button.offsetWidth;
 button.classList.add('is-heart-popping');
}
async function handleBack() {
 if (state.screen === 'answer') { saveAnswerEditorDraft(); return showDetail(state.detail.id, {captureFeed:false}); }
 if (state.screen === 'ask') {
  saveCurrentComposerDraft(); removeStored('composer:active');
  if (state.composerOrigin?.type === 'ai-turn') return showDetail(state.composerOrigin.questionId, {captureFeed:false});
  return returnToFeed();
 }
 if (state.screen === 'detail' && state.detail) { const view = detailView(state.detail.id); view.scrollTop = app.scrollTop; saveDetailView(state.detail.id); }
 return returnToFeed();
}
let navTap={channel:null,time:0};
let channelRefreshBusy=false, lastChannelRefresh=0;
let refreshOperation=0, refreshController=null, refreshLiveBar=null;
const REFRESH_MIN_MS=850;
function refreshDogHTML() {
 return `<svg class="refresh-dog" viewBox="0 0 116 78" fill="none" aria-hidden="true"><g class="refresh-dog-body" stroke="#383b3d" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M30 64V40q0-17 11-24l6-12 9 10h13l10-10 5 15q9 9 9 25v20" fill="#fff"/><path d="m40 17 9-3m25 0 10 5"/><ellipse cx="61" cy="33" rx="9" ry="10" fill="#272b2c" stroke="none"/><ellipse cx="47" cy="33" rx="2" ry="3.7" fill="#272b2c" stroke="none"/><ellipse cx="76" cy="33" rx="2" ry="3.7" fill="#272b2c" stroke="none"/><path d="M78 49q-11 13-23 12M33 57l14-7M81 49v16"/><g class="refresh-dog-pen"><path d="m49 43 7 24" stroke="#1289ff" stroke-width="5"/><path d="m56 67 2 4" stroke="#383b3d" stroke-width="2"/><path d="m44 51 10 3" stroke="#383b3d"/></g></g><path class="refresh-dog-scribble" d="m60 67 9-2 6 2 7-1" stroke="#1685f8" stroke-width="1.8" stroke-linecap="round"/><rect x="12" y="69" width="92" height="7" rx="3.5" fill="#e8e9ec" stroke="#45484a" stroke-width="2.4"/></svg>`;
}
function refreshViewport(channel) {return app.querySelector(channel==='guolairen'?'.feed-viewport':'.demo-feed');}
function insertRefreshBar(channel,phase,text='') {
 const viewport=refreshViewport(channel);if(!viewport)return null;
 viewport.querySelector('.channel-refresh-strip')?.remove();
 const strip=document.createElement('div');strip.className='channel-refresh-strip '+phase;
 strip.setAttribute('role','status');strip.setAttribute('aria-live','polite');strip.setAttribute('aria-atomic','true');
 strip.dataset.refreshState=phase;
 strip.innerHTML=phase==='loading'?`${refreshDogHTML()}<span class="sr-only">正在刷新内容</span>`:`<span>${escape(text)}</span>`;
 const spacer=viewport.querySelector('.filter-controls-spacer');
 if(spacer)spacer.after(strip);else viewport.prepend(strip);
 return strip;
}
function settleRefreshBar(strip) {
 if(!strip)return;
 setTimeout(()=>{if(!strip.isConnected)return;strip.classList.add('is-closing');setTimeout(()=>strip.remove(),220);},2400);
}
function refreshSuccessText(channel,count) {
 if(channel==='guolairen')return count?`听见另一程的声音，${count} 条问答已更新`:'暂时没有这一程的问答，试试换个阶段';
 if(channel==='kanshan')return `换个问题聊聊，${count} 个示例话题`;
 return `探索未知的领域，${count} 条示例内容推荐`;
}
async function refreshCurrentChannel(channel) {
 const now=performance.now();
 if((channelRefreshBusy&&refreshLiveBar?.isConnected)||now-lastChannelRefresh<700)return;
 refreshController?.abort();
 const operation=++refreshOperation;
 const controller=new AbortController();refreshController=controller;
 channelRefreshBusy=true;lastChannelRefresh=now;
 const nav=app.querySelector('.channel-tabs,.shot-tabs');
 nav?.setAttribute('aria-busy','true');
 const viewport=refreshViewport(channel);if(!viewport){channelRefreshBusy=false;nav?.removeAttribute('aria-busy');return;}
 viewport.scrollTop=0;
 if(channel==='guolairen')restoreFeedViewport({scrollTop:0,filterProgress:1});
 const strip=insertRefreshBar(channel,'loading');refreshLiveBar=strip;
 const minimum=new Promise(resolve=>setTimeout(resolve,matchMedia('(prefers-reduced-motion: reduce)').matches?150:REFRESH_MIN_MS));
 const timeout=setTimeout(()=>controller.abort(),15000);
 const ticket=channel==='guolairen'?++state.request:state.request;
 const stillHere=()=>operation===refreshOperation&&strip?.isConnected&&state.request===ticket;
 try {
  let count=0;
  if(channel==='guolairen') {
   const [data]=await Promise.all([api(`/feed?mode=${state.mode}&stage=${state.stage}&refresh=1`,undefined,{signal:controller.signal}),minimum]);
   if(!stillHere())return;
   if(!Array.isArray(data.items)||!Array.isArray(data.allowed_stages))throw new Error('内容响应不完整');
   state.feed=data.items;state.allowed=data.allowed_stages;count=data.items.length;
   renderFeed();captureFeedView();
  } else {
   await minimum;if(!stillHere())return;
   if(channel==='kanshan') {KANSHAN_SUGGESTIONS.push(KANSHAN_SUGGESTIONS.shift());state.kanshanSuggestion=null;count=KANSHAN_SUGGESTIONS.length;renderKanshan();}
   else {count=nextMockBatch(channel).length;saveDemoScroll();viewport.scrollTop=0;state.demoScroll.set(channel,0);renderDemoChannel(channel);}
  }
  const done=insertRefreshBar(channel,'success',refreshSuccessText(channel,count));refreshLiveBar=done;settleRefreshBar(done);
 } catch(error) {
  await minimum;
  if(stillHere()) {const failed=insertRefreshBar(channel,'error',error.name==='AbortError'?'刷新超时，原内容已保留':'刷新失败，原内容已保留');refreshLiveBar=failed;settleRefreshBar(failed);}
 } finally {
  clearTimeout(timeout);nav?.removeAttribute('aria-busy');
  if(operation===refreshOperation){channelRefreshBusy=false;refreshController=null;}
 }
}
phone.addEventListener('click', async event => {
 const b = event.target.closest('button[data-action]');
 if (!b) {
  const card = event.target.closest('.qa-feed-card[data-question-id]');
  if (!card || window.getSelection()?.toString()) return;
  try { await showDetail(Number(card.dataset.questionId)); } catch (error) { notice(error.message); }
  return;
 }
 if (b.disabled) return;
 try {
  const action = b.dataset.action;
  if (b.closest('.channel-tabs, .shot-tabs') || (action==='kanshan'&&state.screen==='kanshan')) {
   const channel=action==='home'?'guolairen':action==='kanshan'?'kanshan':b.dataset.channel;
   const active=state.screen==='feed'?'guolairen':state.screen==='demo'?state.demoChannel:state.screen==='kanshan'?'kanshan':null;
   if(channel&&channel===active) {
    const now=performance.now();
    if(navTap.channel===channel&&now-navTap.time<420){navTap={channel:null,time:0};await refreshCurrentChannel(channel);}
    else {navTap={channel,time:now};if(channel==='guolairen')revealFeedFilters();}
    return;
   }
   navTap={channel:null,time:0};
  }
  if (action === 'shot-notice') return notice('这是截图界面演示，过来人可进行真实交流');
  if (action === 'shot-shortcut') return b.dataset.label==='知乎日报'?renderDemoChannel('follow'):notice(b.dataset.label+' · 界面示例');
  if (action === 'shot-mark') { const on=b.getAttribute('aria-pressed')!=='true';b.setAttribute('aria-pressed',String(on));return; }
  if (action === 'shot-hide') {if(state.demoChannel==='follow')return notice('这是关注动态示例');b.closest('article')?.remove();return;}
  if (action === 'shot-follow-filter') {const t=b.textContent;app.querySelectorAll('.shot-follow-filters button').forEach(e=>e.setAttribute('aria-pressed',String(e===b)));const list=app.querySelector('.shot-follow-posts');const rows=[...list.children];rows.forEach(e=>e.hidden=t==='想法'&&e.dataset.kind!=='想法');if(t==='最新')rows.sort((a,b)=>a.dataset.kind==='想法'?-1:1).forEach(e=>list.append(e));else rows.sort((a,b)=>a.dataset.kind==='文章'?-1:1).forEach(e=>list.append(e));return;}
  if (action === 'demo-share') return notice('这是一条榜单示例，可进入过来人发起真实讨论');
  if (action === 'demo-open') return showDemoArticle(b.dataset.channel,Number(b.dataset.index));
  if (action === 'demo-mark') {
   const key=b.dataset.key;if(demoMarks.has(key))demoMarks.delete(key);else demoMarks.add(key);
   const marked=demoMarks.has(key);b.setAttribute('aria-pressed',String(marked));b.querySelector('span').textContent=key.startsWith('vote:')?(marked?'已赞同':'赞同'):(marked?'已收藏':'收藏');return;
  }
  if (action === 'demo-discuss') {
   const item=mockItems(b.dataset.channel)[Number(b.dataset.index)];if(!item)return;
   await showCachedFeed();return showAsk(item.title,{type:'demo-item',channel:b.dataset.channel,index:item.id});
  }
  if (action === 'back' && state.screen==='demo-detail') return renderDemoChannel(state.demoChannel);
  if (action === 'home') return state.screen === 'feed' ? await loadFeed() : (state.screen === 'demo' || state.screen === 'kanshan' ? await showCachedFeed() : await returnToFeed());
  if (action === 'channel') return renderDemoChannel(b.dataset.channel);
  if (action === 'kanshan') return renderKanshan();
  if (action === 'kanshan-suggestion') {
   const index = Number(b.dataset.index); const suggestion = KANSHAN_SUGGESTIONS[index];
   if (!suggestion) return;
   if (suggestion.home) { await showCachedFeed(); return notice('已回到过来人，听不同阶段的人说'); }
   state.kanshanSuggestion = index; renderKanshan({prepare:false});
   requestAnimationFrame(() => app.querySelector('.demo-row[aria-live]')?.scrollIntoView({block:'nearest'}));
   return;
  }
  if(action==='view-answer-image')return openAnswerImage(b.dataset.src);
  if(action==='notifications')return showNotifications();
  if(action==='notification-open'){await showDetail(Number(b.dataset.question),{captureFeed:false,focusAnswerId:Number(b.dataset.answer)||null});return;}
  if (action === 'search') return notice('搜索尚未接入体验版，先从过来人问答逛起吧');
  if (action === 'unavailable') return notice(`${b.dataset.label || '这个入口'}尚未接入体验版`);
  if (action === 'stage-settings') return showStagePicker();
  if (action === 'stage-picker-back') {if(app.querySelector('#stage-switch-form')?.dataset.saved){await loadFeed();captureFeedView();}else await showCachedFeed();app.querySelector('.my-stage-entry')?.focus({preventScroll:true});return;}
  if (action === 'profile') { if (state.screen === 'feed') captureFeedView(); return showProfile(); }
  if (action === 'ask') { if (state.screen === 'demo' || state.screen === 'kanshan') await showCachedFeed(); if (state.screen === 'feed') captureFeedView(); return showAsk('', {type:'feed'}); }
  if (action === 'answer') { const view = detailView(state.detail.id); view.scrollTop = app.scrollTop; saveDetailView(state.detail.id); return showAnswer(); }
  if (action === 'back') return await handleBack();
  if (action === 'mode') { state.mode = b.dataset.value; state.stage = 'all'; return await loadFeed(); }
  if (action === 'filter') { state.stage = b.dataset.value; return await loadFeed(); }
  if (['kanshan-start','kanshan-check','kanshan-refresh'].includes(action)) {const view=detailView(state.detail.id);view.kanshanOpened=true;view.kanshanPollStart=0;if(action==='kanshan-refresh')view.kanshanRevealed=null;return loadKanshanPage(state.detail.id,{start:action==='kanshan-start',refresh:action==='kanshan-refresh'});}
  if (action === 'answer-page') return app.querySelector('.answer-deck')?.answerMove?.(Number(b.dataset.step));
  if (action === 'answer-followup') {const view=detailView(state.detail.id);const a=state.detail.answers.find(a=>a.id===Number(b.dataset.id));if(!a)return;view.answerId=a.id;if(view.aiAnswerId!==a.id){view.aiDrafts=view.aiDrafts||{};view.aiDrafts[view.aiAnswerId||'question']=view.aiDraft;view.aiDraft=view.aiDrafts[a.id]||`关于这条回答「${a.body.slice(0,200)}」，资料中有什么可以补充或需要注意的地方？`;view.aiAnswerId=a.id;}view.aiOpen=true;saveDetailView(state.detail.id);renderDetail();loadAIState(state.detail.id);return;}

  if(action==='toggle-replies'){
   const panel=document.getElementById(b.getAttribute('aria-controls')),opening=panel.hidden;
   panel.hidden=!opening;b.setAttribute('aria-expanded',String(opening));
   b.closest('.reading-answer').classList.toggle('thread-open',opening);
   if(opening&&!matchMedia('(prefers-reduced-motion: reduce)').matches)panel.animate([{opacity:0,transform:'translateY(-4px)'},{opacity:1,transform:'translateY(0)'}],{duration:240,easing:'ease-out'});
   return;
  }
  if (action === 'answer-save' || action === 'answer-unhelpful') {
   const saving=action==='answer-save', key=(saving?'saved-answer:':'unhelpful-answer:')+b.dataset.id;
   const active=!stored(key,false);store(key,active);b.classList.toggle('voted',active);b.setAttribute('aria-pressed',String(active));
   if(saving){
    b.setAttribute('aria-label',active?'取消收藏':'收藏回答');
    b.classList.remove('is-save-popping');
    if(active){void b.offsetWidth;b.classList.add('is-save-popping');}
   }
   return notice(saving?(active?'已收藏在当前浏览器':'已取消收藏'):(active?'已记录在当前浏览器':'已取消反馈'));
  }
  if (action === 'detail') return await showDetail(Number(b.dataset.id));
  if (action === 'reopen-detail') return await showDetail(Number(b.dataset.id), {captureFeed:false});
  if (action === 'toggle-ai') {
   const view = detailView(state.detail.id); view.scrollTop = app.scrollTop; view.aiOpen = !view.aiOpen; saveDetailView(state.detail.id); renderDetail();
   if (view.aiOpen) loadAIState(state.detail.id);
   return;
  }
  if (action === 'refresh-ai') return loadAIState(state.detail.id);
  if (action === 'use-followup') {
   const view = detailView(state.detail.id); const turn = view.aiSnapshot?.turns?.[Number(b.dataset.turnIndex)]; const text = turn?.followups?.[Number(b.dataset.followupIndex)];
   const input = app.querySelector('#ai-question'); if (!input || !text) return;
   input.value = text; view.aiDraft = text; saveDetailView(state.detail.id); app.querySelector('#ai-draft-count').textContent = String(text.length); input.focus(); input.scrollIntoView({block:'center'}); return;
  }
  if (action === 'ask-from-ai') {
   const view = detailView(state.detail.id); const turnIndex = Number(b.dataset.turnIndex); const turn = view.aiSnapshot?.turns?.[turnIndex]; if (!turn?.question) return;
   view.scrollTop = app.scrollTop; saveDetailView(state.detail.id); return showAsk(turn.question, {type:'ai-turn', questionId:state.detail.id, turnIndex});
  }
  if (action === 'toggle-targets') {
   const picker = app.querySelector('#composer-target-picker'); if (!picker) return;
   picker.hidden = false; b.setAttribute('aria-expanded', 'true');
   requestAnimationFrame(() => picker.querySelector('input:not(:disabled)')?.focus({preventScroll:true}));
   return;
  }
  if (action === 'finish-targets') {
   const targets = selectedComposerTargets();
   const picker = app.querySelector('#composer-target-picker'); const trigger = app.querySelector('[data-action="toggle-targets"]');
   if (picker) picker.hidden = true; if (trigger) { trigger.setAttribute('aria-expanded', 'false'); trigger.focus(); }
   return;
  }
  if (action === 'remove-target') {
   const form = app.querySelector('#ask-form'); const selected = selectedComposerTargets(form);
   const input = composerTargetInputs(form).find(candidate => candidate.value === b.dataset.value);
   if (input) input.checked = false; syncComposerUI(); return;
  }
  if (action === 'retry') return await boot();
  if (action === 'vote') { const answerId = Number(b.dataset.id); b.disabled = true; const result = await api('/vote', {answer_id:answerId, active:b.dataset.voted !== 'true'}); updateVoteState(answerId, result); b.dataset.voted = String(result.voted); b.classList.toggle('voted', result.voted); b.setAttribute('aria-pressed', String(result.voted)); b.setAttribute('aria-label', result.voted ? '取消赞同' : '赞同回答'); b.innerHTML = b.classList.contains('answer-icon-button') ? `${answerActionIcon('up')}<span class="answer-action-count">${formatVoteCount(result.votes)}</span>` : `${voteHeartHTML(result.voted)} <span>${formatVoteCount(result.votes)}</span>`; playVoteHeart(b); }
 } catch (e) { notice(e.message); } finally { b.disabled = false; }
});
phone.addEventListener('keydown', event => {
 const card = event.target.closest?.('.qa-feed-card[data-question-id]');
 if (!card || event.target !== card || (event.key !== 'Enter' && event.key !== ' ')) return;
 event.preventDefault(); showDetail(Number(card.dataset.questionId)).catch(error => notice(error.message));
});
app.addEventListener('input', event => {
 if (event.target.id === 'ai-question' && state.detail) {
  const view = detailView(state.detail.id); view.aiDraft = event.target.value; saveDetailView(state.detail.id);
  const count = app.querySelector('#ai-draft-count'); if (count) count.textContent = String(event.target.value.length);
 }
 if (event.target.id === 'question-title' || event.target.id === 'question-body') syncComposerUI();
});
app.addEventListener('change', event => {
 if (event.target.matches?.('#ask-form input[name="stage"], #ask-form input[name="direction"]')) return updateComposerChoices({announce:true});
 if (!event.target.matches?.('#ask-form input[name="targets"]')) return;
 const selected = selectedComposerTargets();
 if (selected.length > 6) { event.target.checked = false; notice('最多选择 6 个阶段'); }
 syncComposerUI();
});
app.addEventListener('submit', async event => {
 event.preventDefault(); const form = event.target;
 if (form.matches('.reply-form')) return submitReply(form);
 if (form.id === 'ai-question-form') return submitAIQuestion(form);
 if (form.id === 'stage-switch-form') return saveStagePicker(form);
 const submit = form.querySelector('[type=submit]') || app.querySelector(`[type="submit"][form="${form.id}"]`); if (!submit || submit.disabled) return;
 submit.disabled = true; if (form.id === 'ask-form') form.dataset.submitting = 'true'; let writeSucceeded = false;
 const data = Object.fromEntries(new FormData(form));
 try {
  if (form.id === 'profile-form') { const user = await api('/profile', data); state.user.stage = user.stage; state.stage = 'all'; await loadFeed(); notice('阶段已更新'); }
  if (form.id === 'ask-form') {
   data.title = String(data.title || '').trim();
   if (data.title.length > 100) { app.querySelector('#question-title-status')?.classList.add('is-error'); app.querySelector('#question-title')?.focus(); throw new Error('请把问题编辑到 100 字以内后发布'); }
   data.targets = selectedComposerTargets(form);
   if (data.targets.length > 6) { app.querySelector('[data-action="toggle-targets"]')?.focus(); throw new Error('最多选择 6 个希望回答的阶段'); }
   data.stage = form.elements.stage.value || null;
   delete data.direction; delete data.target;
   const q = await api('/questions', data); writeSucceeded = true; state.composerOrigin = null;
   removeStored(form.dataset.draftKey || 'composer:feed'); removeStored('composer:active');
   try { await showDetail(q.id, {captureFeed:false}); notice('问题已保存，等一个新视角'); }
   catch (_) { showSavedRecovery(q.id, 'question'); notice('问题已保存，请勿重复发布'); }
  }
  if (form.id === 'answer-form') {
   const questionId = Number(form.dataset.questionId) || state.detail.id;
   if(answerEditor.uploading)throw new Error('图片正在添加，请稍等');
   form.dataset.submitting='true';saveAnswerEditorDraft();
   const result = await api('/answers', {body:String(data.body||'').trim(), question_id:questionId, tags:[...answerEditor.tags],topics:[...answerEditor.topics],images:[...answerEditor.images]}); writeSucceeded = true;
   removeStored('answer-draft:'+questionId);
   detailView(questionId).answerStage = state.user.stage;
   try { await showDetail(questionId, {captureFeed:false, focusAnswerId:result.id}); notice('回答已保存'); }
   catch (_) { showSavedRecovery(questionId, 'answer'); notice('回答已保存，请勿重复发布'); }
  }
 } catch (e) {
  notice(form.id === 'ask-form' && e instanceof TypeError ? '网络连接失败，草稿已保留，请稍后重试' : e.message);
 } finally {
  if (!writeSucceeded && form.id === 'ask-form' && form.isConnected) { form.dataset.submitting = 'false'; syncComposerUI(); }
  else if (!writeSucceeded && form.id==='answer-form' && form.isConnected){form.dataset.submitting='false';updateAnswerEditor();}
  else if (!writeSucceeded && submit.isConnected) submit.disabled = false;
 }
});
async function boot() {
 try {
  state.user = await api('/me'); const restore = feedEntryView(stored('feed', null)); state.feedReturn = restore;
  try { await loadFeed({restore}); } catch (error) { if (!restore) throw error; state.mode = 'older'; state.stage = 'all'; state.feedReturn = null; await loadFeed(); }
  startDemoNotifications();
  const activeComposer = stored('composer:active', null);
  if (activeComposer?.origin && typeof activeComposer.prefill === 'string') showAsk(activeComposer.prefill, activeComposer.origin);
 } catch (e) { controls(false); app.innerHTML = `<div class="empty-state"><p>${escape(e.message)}</p><button class="secondary-button" data-action="retry">重新连接</button></div>`; }
}
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
const demoInbox={items:[],unread:0,seen:Number(stored('notifications:seen',0)),timer:0,started:false,latest:0,initialized:false};
function notificationRowsHTML(){
 return demoInbox.items.map(item=>`<button class="notification-row" data-action="notification-open" data-question="${item.question_id}" data-answer="${item.answer_id||''}"><img src="${escape(item.author.avatar)}" alt="" width="34" height="34"><span><strong>${escape(item.author.name)} <small>${item.kind==='like'?'赞了你':item.target_kind==='question'?'回答了你的问题':'追评了你的回答'}</small></strong><p>${escape(item.body)}</p><time>${new Intl.DateTimeFormat('zh-CN',{timeZone:'Asia/Shanghai',hour:'2-digit',minute:'2-digit'}).format(new Date(item.created*1000))} · 演示互动</time></span></button>`).join('')||'<p class="empty-state">发布一个问题或回答，等另一程的人来回应。</p>';
}
function showNotifications(){
 if(state.screen==='feed')captureFeedView();
 cleanupAIPoll();++state.request;controls(false);state.screen='notifications';
 demoInbox.seen=demoInbox.latest;demoInbox.unread=0;store('notifications:seen',demoInbox.seen);
 app.innerHTML=`<div class="app-shell notifications-shell">${bar('消息')}<section class="notifications-list">${notificationRowsHTML()}</section>${bottomTabBarHTML('notifications')}</div>`;
}
async function syncDemoQuestion(qid){
 const fresh=await api('/questions/'+qid);
 if(state.screen!=='detail'||state.detail?.id!==qid)return;
 Object.assign(state.detail,fresh);
 fresh.answers.forEach((answer,i)=>{
  const row=app.querySelector(`.reading-answer[data-answer-id="${answer.id}"]`);
  if(!row){
   const anchor=app.querySelector('.kanshan-answer-page')?.previousElementSibling;
   if(anchor){app.querySelector('.reading-empty')?.remove();anchor.insertAdjacentHTML('afterend',readingAnswerHTML(answer,i)+'<div class="reading-divider" aria-hidden="true"><span>✦</span></div>');}
   return;
  }
  const vote=row.querySelector('[data-action="vote"]');
  if(vote&&!vote.disabled){vote.querySelector('span:last-child').textContent=formatVoteCount(answer.votes);}
  const count=row.querySelector('.reply-count');if(count)count.textContent=answer.replies?.length||'';
  const list=row.querySelector('.reply-list');if(list)list.innerHTML=(answer.replies||[]).map(replyRowHTML).join('');
 });
}
function startDemoNotifications(){
 if(demoInbox.started||!state.user?.demo_interactions)return;
 demoInbox.started=true;
 const poll=async()=>{
  try{
   const result=await api('/notifications'),items=result.items||[];
   const fresh=items.filter(item=>item.id>demoInbox.latest);
   demoInbox.items=items;demoInbox.latest=Math.max(demoInbox.latest,...items.map(item=>item.id),0);
   if(state.screen==='notifications'){
    demoInbox.seen=demoInbox.latest;store('notifications:seen',demoInbox.seen);
    const list=app.querySelector('.notifications-list');if(list&&fresh.length)list.innerHTML=notificationRowsHTML();
   }
   demoInbox.unread=items.filter(item=>item.id>demoInbox.seen).length;
   app.querySelectorAll('.notification-dot').forEach(dot=>dot.hidden=!demoInbox.unread);
   if(demoInbox.initialized&&fresh.length){
    const latest=fresh[0];notice(`${latest.author.name} ${latest.kind==='like'?latest.body:latest.target_kind==='question'?'回答了你的问题':'追评了你的回答'} · 演示互动`);
    const qid=state.detail?.id;if(state.screen==='detail'&&fresh.some(item=>item.question_id===qid))await syncDemoQuestion(qid);
   }
   demoInbox.initialized=true;
  }catch(_){/* Reconnect on the next tick without interrupting writing. */}
  finally{demoInbox.timer=setTimeout(poll,1200);}
 };
 poll();
 window.addEventListener('pagehide',()=>clearTimeout(demoInbox.timer),{once:true});
}
// Navigation motion stays separate from native reading and inline updates.
function pageMotionKey() {
 const detail=state.screen==='detail'?`${state.detail?.id}:${!!state.detailViews.get(state.detail?.id)?.aiOpen}`:'';
 const feed=state.screen==='feed'?`${state.mode}:${state.stage}`:'';
 const article=state.screen==='demo-detail'?app.querySelector('h1')?.textContent:'';
 return [state.screen,state.screen==='demo'||state.screen==='demo-detail'?state.demoChannel:'',detail,feed,article].join('|');
}
function installPageMotion() {
 const reduced=matchMedia('(prefers-reduced-motion: reduce)');
 let previous=null,pending=null,overlay=null,animations=[],expiry=0;
 const cancel=()=>{animations.forEach(animation=>animation.cancel());animations=[];overlay?.remove();overlay=null;};
 const clearPending=()=>{clearTimeout(expiry);pending=null;};
 function capture(direction=1,scoped=false) {
  cancel();clearPending();if(reduced.matches)return;
  const rect=app.getBoundingClientRect(),host=app.parentElement.getBoundingClientRect();
  const copy=app.cloneNode(true);
  const originals=[app,...app.querySelectorAll('*')],copies=[copy,...copy.querySelectorAll('*')];
  const scrolls=originals.map((node,i)=>[copies[i],node.scrollTop,node.scrollLeft]).filter(([,top,left])=>top||left);
  copy.removeAttribute('id');copy.querySelectorAll('[id]').forEach(node=>node.removeAttribute('id'));
  copy.classList.add('page-motion-snapshot');copy.setAttribute('aria-hidden','true');copy.inert=true;
  Object.assign(copy.style,{top:`${rect.top-host.top}px`,left:`${rect.left-host.left}px`,width:`${rect.width}px`,height:`${rect.height}px`});
  const region=scoped?app.querySelector('.feed-layer,.demo-feed'):null;
  if(region){const bounds=region.getBoundingClientRect();copy.style.clipPath=`inset(${Math.max(0,bounds.top-rect.top)}px 0 ${Math.max(0,rect.bottom-bounds.bottom)}px 0)`;}
  pending={copy,scrolls,direction,scoped:!!region};
  expiry=setTimeout(clearPending,5000);
 }
 phone.addEventListener('click',event=>{
  const button=event.target.closest('button,a,[data-question-id]');if(!button||button.disabled)return;
  const action=button.dataset.action;
  const nav=button.closest('.shot-tabs,.channel-tabs,.bottom-tab-bar,.direction-switch,.stage-filter .chips');
  const navigation=['back','stage-picker-back','home','channel','kanshan','stage-settings','profile','notifications','notification-open','ask','answer','demo-open','demo-discuss','reopen-detail','toggle-ai','answer-followup'];
  if(!nav&&!navigation.includes(action)&&!button.matches('[data-question-id]'))return;
  let direction=action==='back'||action==='stage-picker-back'||(action==='toggle-ai'&&state.detailViews.get(state.detail?.id)?.aiOpen)?-1:1;
  if(nav){
   const buttons=[...nav.querySelectorAll('button')];
   const selected=buttons.findIndex(item=>item.matches('.active,.current,.selected,[aria-pressed="true"],[aria-current="page"]'));
   if(selected>=0)direction=buttons.indexOf(button)<selected?-1:1;
  }
  capture(direction,!!nav&&!nav.matches('.bottom-tab-bar'));
 },true);
 phone.addEventListener('keydown',event=>{if((event.key==='Enter'||event.key===' ')&&event.target.matches('.qa-feed-card[data-question-id]'))capture(1);},true);
 phone.addEventListener('submit',event=>{if(event.target.matches('#ask-form,#answer-form,#stage-switch-form,#profile-form'))capture(-1);},true);
 const observer=new MutationObserver(()=>{
  const next=pageMotionKey();if(next===previous)return;
  const first=previous===null;previous=next;cancel();
  if(first||reduced.matches){clearPending();return;}
  const entry=pending;clearPending();
  const direction=entry?.direction||1;
  const content=entry?.scoped?app.querySelector('.feed-layer,.demo-feed')||app:app;
  if(!content.animate)return;
  if(entry){
   overlay=entry.copy;app.parentElement.append(overlay);
   entry.scrolls.forEach(([node,top,left])=>{node.scrollTop=top;node.scrollLeft=left;});
  }
  const options={duration:420,easing:'cubic-bezier(.22,.7,.2,1)',fill:'both'};
  const translate=x=>`translate3d(${x}%,0,0)`;
  // Both surfaces travel together; the shared status bar stays stationary.
  animations.push(content.animate([{transform:translate(direction*100)},{transform:translate(0)}],options));
  if(overlay)animations.push(overlay.animate([{transform:translate(0)},{transform:translate(-direction*100)}],options));
  const running=animations;
  Promise.all(running.map(animation=>animation.finished)).then(()=>{if(animations===running)cancel();},()=>{});
 });
 // Ignore in-place likes, streamed text and native answer scrolling.
 observer.observe(app,{childList:true});
 reduced.addEventListener?.('change',()=>{if(reduced.matches){cancel();clearPending();}});
 window.addEventListener('pagehide',()=>{cancel();clearPending();observer.disconnect();},{once:true});
}

installSharedShell();
installPageMotion();
boot();
