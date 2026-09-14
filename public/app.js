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
const FILTER_FADE_DISTANCE = 210;
const FILTER_SCROLL_JITTER = 1.75;
const FILTER_DIRECTION_CONFIRM = 5;
const STORAGE_PREFIX = 'past-voices-v1:';
let filterVisibilityProgress = 1;
let filterViewport = null;
let filterStack = null;
let filterScrollCleanup = null;
let filterFrame = 0;
let filterLastScrollTop = 0;
let filterActiveDirection = 0;
let filterCandidateDirection = 0;
let filterCandidateDistance = 0;
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
async function api(path, data) {
 const response = await fetch('/api' + path, { method: data === undefined ? 'GET' : 'POST', headers: data === undefined ? {} : {'Content-Type':'application/json'}, body: data === undefined ? undefined : JSON.stringify(data) });
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
function syncComposerUI({save = true} = {}) {
 const form = app.querySelector('#ask-form');
 if (!form) return;
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
   answerStage: saved.answerStage || 'all', scrollTop: Number(saved.scrollTop) || 0,
   aiOpen: !!saved.aiOpen, aiDraft: typeof saved.aiDraft === 'string' ? saved.aiDraft : '',
   aiSnapshot: null, aiLoading: false, aiSubmitting: false, aiUncertain: false, aiError: ''
  });
 }
 return state.detailViews.get(id);
}
function saveDetailView(id) {
 const view = detailView(id);
 store('detail:' + id, {answerStage:view.answerStage, scrollTop:view.scrollTop, aiOpen:view.aiOpen, aiDraft:view.aiDraft});
}
function cleanupAIPoll() { clearTimeout(aiPollTimer); aiPollTimer = 0; aiPollStartedAt = 0; }
function cleanupFilterControls() {
 if (filterScrollCleanup) filterScrollCleanup();
 if (filterFrame) cancelAnimationFrame(filterFrame);
 filterViewport = null; filterStack = null; filterScrollCleanup = null;
 filterFrame = 0;
}
function syncFilterSpacerHeight() {
 const layer = filterStack?.closest('.feed-layer');
 if (!layer || filterStack.classList.contains('is-hidden')) return;
 const height = filterStack.getBoundingClientRect().height;
 if (height > 0) layer.style.setProperty('--filter-controls-height', `${height}px`);
}
function applyFilterVisibility() {
 filterFrame = 0;
 if (!filterStack || !filterViewport) return;
 const progress = clamp(filterVisibilityProgress, 0, 1);
 if (progress > 0 && filterStack.classList.contains('is-hidden')) {
  filterStack.classList.remove('is-hidden');
  filterStack.removeAttribute('aria-hidden');
  filterStack.inert = false;
 }
 filterStack.style.setProperty('--filter-progress', progress.toFixed(4));
 filterStack.style.setProperty('--filter-offset', `${(-7 * (1 - progress)).toFixed(2)}px`);
 if (progress === 0 && !filterStack.classList.contains('is-hidden')) {
  filterStack.classList.add('is-hidden');
  filterStack.setAttribute('aria-hidden', 'true');
  filterStack.inert = true;
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
 syncFilterSpacerHeight();
 filterStack.style.setProperty('--filter-progress', filterVisibilityProgress.toFixed(4));
 filterStack.style.setProperty('--filter-offset', `${(-7 * (1 - filterVisibilityProgress)).toFixed(2)}px`);
 if (filterVisibilityProgress === 0) {
  filterStack.classList.add('is-hidden');
  filterStack.setAttribute('aria-hidden', 'true');
  filterStack.inert = true;
 }
 const onScroll = () => {
  if (!filterViewport) return;
  const rawScrollTop = filterViewport.scrollTop;
  const maxScroll = Math.max(0, filterViewport.scrollHeight - filterViewport.clientHeight);
  if (rawScrollTop < 0 || rawScrollTop > maxScroll + 2) return;
  const currentScrollTop = clamp(rawScrollTop, 0, maxScroll);
  const delta = currentScrollTop - filterLastScrollTop;
  filterLastScrollTop = currentScrollTop;
  if (Math.abs(delta) < FILTER_SCROLL_JITTER) return;
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
const CHANNEL_TABS = [['recommend','推荐'], ['hot','热榜'], ['story','故事'], ['knowledge','知识']];
function channelTabsHTML(active = 'guolairen') {
 const demoTabs = CHANNEL_TABS.map(([id, label]) => `<button data-action="channel" data-channel="${id}" class="${active === id ? 'active' : ''}" ${active === id ? 'aria-current="page"' : ''}>${label}</button>`).join('');
 return `<nav class="channel-tabs" aria-label="内容频道">${demoTabs}<button data-action="home" class="${active === 'guolairen' ? 'active' : ''}" ${active === 'guolairen' ? 'aria-current="page"' : ''}>过来人</button><button data-action="unavailable" data-label="关注">关注</button></nav>`;
}
function topNavigationHTML(active = 'guolairen') {
 return `<header class="top-navigation-group"><div class="search-bar" role="search" aria-label="社区搜索"><span class="search-placeholder"><span class="search-icon" aria-hidden="true"></span>搜索你感兴趣的问题</span><button type="button" data-action="search">搜索</button></div>${channelTabsHTML(active)}</header>`;
}
function bottomTabBarHTML(active = 'home') { return `<nav class="bottom-tab-bar" aria-label="主导航"><button data-action="home" class="${active === 'home' ? 'current' : ''}" ${active === 'home' ? 'aria-current="page"' : ''} aria-label="首页"><svg class="tab-icon tab-icon-home" viewBox="2 3 20 19" aria-hidden="true" focusable="false"><path d="M3.2 10.1 11 4.25a1.65 1.65 0 0 1 2 0l7.8 5.85v9.05a1.75 1.75 0 0 1-1.75 1.75H4.95a1.75 1.75 0 0 1-1.75-1.75Z" fill="currentColor"/><path d="M12 14.5v4" fill="none" stroke="#fff" stroke-linecap="round" stroke-width="1.8"/></svg><span>首页</span></button><button data-action="kanshan" class="${active === 'kanshan' ? 'current' : ''}" ${active === 'kanshan' ? 'aria-current="page"' : ''} aria-label="看山"><svg class="tab-icon tab-icon-mountain" viewBox="2.5 4.5 19 18.5" aria-hidden="true" focusable="false"><path d="M5.2 20.15c-1.3-1.12-1.6-3.15-1.27-5.25l1.16-7.72c.22-1.48 1.93-2.08 3-1.04l1.96 1.92A9.4 9.4 0 0 1 12 7.85c.67 0 1.32.07 1.95.21l1.96-1.92c1.07-1.04 2.78-.44 3 1.04l1.16 7.72c.33 2.1.03 4.13-1.27 5.25-1.32 1.14-3.65 1.35-6.8 1.35s-5.48-.21-6.8-1.35Z" fill="none" stroke="currentColor" stroke-linejoin="round" stroke-width="1.8"/><circle cx="9.25" cy="14.25" r="1.05" fill="currentColor"/><circle cx="14.75" cy="14.25" r="1.05" fill="currentColor"/></svg><span>看山</span></button><button class="ask-entry" data-action="ask" aria-label="提出一个问题"><svg class="tab-create-icon" viewBox="0 0 42 32" aria-hidden="true" focusable="false"><rect width="42" height="32" rx="16" fill="currentColor"/><path d="M21 10v12M15 16h12" fill="none" stroke="#fff" stroke-linecap="round" stroke-width="2"/></svg></button><button data-action="unavailable" data-label="消息" aria-label="消息"><svg class="tab-icon tab-icon-message" viewBox="1.5 3 21 18" aria-hidden="true" focusable="false"><rect x="3" y="5" width="18" height="14" rx="3.8" fill="none" stroke="currentColor" stroke-width="1.8"/><circle cx="9" cy="12" r="1.15" fill="currentColor"/><circle cx="15" cy="12" r="1.15" fill="currentColor"/></svg><span>消息</span></button><button data-action="profile" aria-label="未登录，设置我的阶段"><svg class="tab-icon tab-icon-profile" viewBox="2 2 20 20" aria-hidden="true" focusable="false"><circle cx="12" cy="12" r="8.7" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M9 14.35c.78.82 1.78 1.23 3 1.23s2.22-.41 3-1.23" fill="none" stroke="currentColor" stroke-linecap="round" stroke-width="1.7"/></svg><span>未登录</span></button></nav>`; }
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
 return `<div class="demo-author"><span class="demo-avatar" aria-hidden="true">${DEMO_AUTHORS[index][0]}</span><span>${DEMO_AUTHORS[index]}</span><small>${channel==='story'?'故事创作者':'分享生活中的观察'}</small><span class="demo-author-menu" aria-hidden="true">···</span></div>`;
}
function demoActionsHTML(channel,index) {
 const key = channel+':'+index;
 return `<div class="demo-actions"><button data-action="demo-mark" data-key="vote:${key}" aria-pressed="${demoMarks.has('vote:'+key)}">${demoIcon('vote')}<span>${demoMarks.has('vote:'+key)?'已赞同':'赞同'}</span></button><button data-action="demo-mark" data-key="save:${key}" aria-pressed="${demoMarks.has('save:'+key)}">${demoIcon('save')}<span>${demoMarks.has('save:'+key)?'已收藏':'收藏'}</span></button><button data-action="demo-open" data-channel="${channel}" data-index="${index}">${demoIcon('comment')}<span>评论</span></button><button data-action="demo-open" data-channel="${channel}" data-index="${index}" aria-label="查看更多示例">${demoIcon('more')}</button></div>`;
}
function demoRowHTML(item, index, channel) {
 const open=`data-action="demo-open" data-channel="${channel}" data-index="${index}"`;
 if(channel==='hot')return `<article class="demo-row demo-hot-row"><span class="demo-rank ${index<3?'demo-rank-leading':''}">${index+1}</span><div class="demo-row-body"><button class="demo-title demo-title-button" ${open}>${escape(item.title)}</button><p class="demo-excerpt">${escape(item.excerpt)}</p><div class="demo-hot-meta"><span aria-label="示例热度">♨ ${[488,418,306,219,180][index]} 万热度</span><button data-action="demo-share">${demoIcon('share')}分享</button></div></div></article>`;
 const story=channel==='story'; const knowledge=channel==='knowledge';
 return `<article class="demo-row demo-${channel}-row">${demoAuthorHTML(index,channel)}${story?`<div class="demo-genre">${DEMO_STORY_TYPES[index]}<span>短篇 · 完结示例</span></div>`:''}${knowledge?`<div class="demo-knowledge-topic">${DEMO_KNOWLEDGE_TYPES[index]} · 每天读懂一个概念</div>`:''}<button class="demo-title demo-title-button" ${open}>${escape(item.title)}</button><p class="demo-excerpt">${escape(item.excerpt)}</p>${story?`<button class="demo-read-story" ${open}>继续阅读 <span>›</span></button>`:''}${demoActionsHTML(channel,index)}</article>`;
}
function demoSubnavHTML(id) {
 if(id==='hot')return '<div class="demo-section-label"><strong>全站热榜</strong><span>榜单与热度均为演示</span></div>';
 if(id==='story')return '<div class="demo-section-label demo-story-heading"><strong>盐选故事</strong><span>好故事，自有回响</span></div>';
 if(id==='knowledge')return '<div class="demo-section-label"><strong>今日精选</strong><span>让好奇心多走一步</span></div>';
 return '';
}
function renderDemoChannel(id) {
 const channel = DEMO_CHANNELS[id]; if (!channel) return;
 prepareDemoScreen(); state.screen = 'demo'; state.demoChannel = id; state.kanshanSuggestion = null;
 app.innerHTML = `<div class="app-shell demo-shell">${topNavigationHTML(id)}<section class="demo-feed demo-feed-${id}" aria-label="${escape(channel.label)}频道示例内容" tabindex="0"><p class="demo-caption">频道预览 · 内容、昵称与互动数据均为示例</p>${demoSubnavHTML(id)}${channel.items.map((item,index)=>demoRowHTML(item,index,id)).join('')}</section>${bottomTabBarHTML('home')}</div>`;
 requestAnimationFrame(() => { const viewport = app.querySelector('.demo-feed'); if (viewport && state.demoChannel===id) viewport.scrollTop = state.demoScroll.get(id) || 0; });
}
function showDemoArticle(channel,index) {
 const item=DEMO_CHANNELS[channel]?.items[index]; if(!item)return;
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
 app.innerHTML = `<div class="app-shell demo-shell">${topNavigationHTML('kanshan')}<section class="demo-feed demo-kanshan" aria-label="看山示例页"><div class="demo-kanshan-heading"><span>Hi，我是刘看山，你的 AI 朋友</span><strong>畅所欲问</strong><small>本页为本地交互示例，未接入实时 AI 或搜索服务。</small></div><div class="demo-kanshan-suggestions" aria-label="示例问题">${KANSHAN_SUGGESTIONS.map((item, index) => `<button type="button" data-action="kanshan-suggestion" data-index="${index}">${escape(item.question)}${item.home ? ' ↗' : ''}</button>`).join('')}</div>${kanshanSuggestionHTML()}<div class="demo-kanshan-input"><input type="text" value="体验版暂不支持自由对话" aria-label="体验版暂不支持自由对话" disabled><button type="button" data-action="ask">去提问</button></div></section>${bottomTabBarHTML('kanshan')}</div>`;
}
function showCachedFeed() {
 const restore = state.feedReturn || stored('feed', null);
 state.composerOrigin = null;
 if (!state.feed.length) return returnToFeed();
 if (restore) { state.mode = restore.mode || state.mode; state.stage = restore.stage || 'all'; }
 renderFeed(restore); return Promise.resolve();
}
function bar(title, trailing = '') { return `<div class="screen-bar"><button data-action="back">← 返回</button><span>${escape(title)}</span><span class="screen-bar-trailing">${trailing}</span></div>`; }
function answerFooterHTML(a, qid, detail = false) { return `<footer class="answer-footer"><button data-action="vote" data-id="${a.id}" data-voted="${!!a.voted}" class="${a.voted ? 'voted' : ''}" aria-label="${a.voted ? '取消赞同' : '赞同回答'}" aria-pressed="${!!a.voted}">${a.voted ? '♥' : '♡'} <span>${a.votes}</span></button>${detail ? '<span>来自这一程的声音</span>' : `<button data-action="detail" data-id="${qid}">听听其他回答 ↗</button>`}</footer>`; }
function answerHTML(a, qid, detail = false) { return `<article class="qa-card detail-answer-card" data-answer-id="${a.id}"><div class="answer-meta"><span class="answer-line"></span><span>${escape(stageName(a.stage))} · ${answerKind(a)}</span></div><p class="answer-text">${escape(a.body)}</p>${answerFooterHTML(a, qid, detail)}</article>`; }
function feedAnswerHTML(a, qid) { return `<div class="answer-section"><div class="answer-tags" aria-label="回答标签">${a.stage ? `<span class="stage-tag">${escape(stageName(a.stage))} · ${answerKind(a)}</span>` : ''}</div><div class="answer-content"><p class="answer-text">${escape(a.body)}</p></div></div>${answerFooterHTML(a, qid)}`; }
function cardHTML(q) {
 const targets = questionTargets(q);
 const targetTags = targets.length ? `<span class="target-stage-tag">想听${escape(stageName(targets[0]))}</span>${targets.length > 1 ? `<span class="target-stage-count">另${targets.length - 1}个阶段</span>` : ''}` : '';
 return `<article class="qa-card qa-feed-card" data-question-id="${q.id}" role="link" tabindex="0" aria-label="查看问题：${escape(q.title)}"><div class="question-section"><div class="question-content"><h2>${escape(q.title)}</h2></div><div class="question-tags" aria-label="问题标签">${q.stage ? `<span class="stage-tag">${escape(stageName(q.stage))}</span>` : ''}${targetTags}</div></div>${q.answer ? feedAnswerHTML(q.answer, q.id) : `<div class="answer-section"><div class="answer-tags" aria-hidden="true"></div><div class="answer-content"><p class="empty-answer">这一程的声音，还在路上。<br>暂时没有所选阶段的回答。</p></div></div><footer class="answer-footer"><span>等待一个新视角</span><button data-action="detail" data-id="${q.id}">去回答 ↗</button></footer>`}</article>`;
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
 filterVisibilityProgress = clamp(Number(view?.filterProgress ?? 1), 0, 1);
 const naturalHeight = stack.getBoundingClientRect().height;
 if (naturalHeight > 0) stack.closest('.feed-layer')?.style.setProperty('--filter-controls-height', `${naturalHeight}px`);
 stack.style.setProperty('--filter-progress', filterVisibilityProgress.toFixed(4));
 stack.style.setProperty('--filter-offset', `${(-7 * (1 - filterVisibilityProgress)).toFixed(2)}px`);
 if (filterVisibilityProgress === 0) {
  stack.classList.add('is-hidden'); stack.setAttribute('aria-hidden', 'true'); stack.inert = true;
 } else {
  stack.classList.remove('is-hidden'); stack.removeAttribute('aria-hidden'); stack.inert = false;
 }
 viewport.scrollTop = clamp(Number(view?.scrollTop) || 0, 0, Math.max(0, viewport.scrollHeight - viewport.clientHeight));
 if (view?.anchorId) {
  const anchor = viewport.querySelector(`[data-question-id="${view.anchorId}"]`);
  if (anchor) viewport.scrollTop = clamp(viewport.scrollTop + anchor.getBoundingClientRect().top - viewport.getBoundingClientRect().top - (Number(view.anchorOffset) || 0), 0, Math.max(0, viewport.scrollHeight - viewport.clientHeight));
 }
 requestAnimationFrame(() => {
  bindFilterControls();
  if (view?.focusedQuestionId) app.querySelector(`[data-question-id="${view.focusedQuestionId}"]`)?.focus({preventScroll:true});
 });
}
function renderFeed(restore = null) {
 cleanupFilterControls();
 cleanupAIPoll(); state.aiRequest++;
 if (!restore) filterVisibilityProgress = 1;
 state.screen = 'feed'; controls(true);
 app.innerHTML = `<div class="app-shell">${topNavigationHTML()}<div class="feed-layer"><div class="filter-controls-stack" role="group" aria-label="内容筛选"><section class="direction-layer"><div class="direction-switch" aria-label="浏览方向"><button data-action="mode" data-value="older" class="${state.mode === 'older' ? 'selected' : ''}" aria-pressed="${state.mode === 'older'}">听过来人说</button><button data-action="mode" data-value="younger" class="${state.mode === 'younger' ? 'selected' : ''}" aria-pressed="${state.mode === 'younger'}">听没过来人说</button></div></section><section class="stage-filter-layer"><div class="stage-filter" aria-label="回答者阶段筛选"><div class="chips"><button data-action="filter" data-value="all" class="${state.stage === 'all' ? 'active' : ''}" aria-pressed="${state.stage === 'all'}">全部</button>${state.allowed.map(id => `<button data-action="filter" data-value="${id}" class="${state.stage === id ? 'active' : ''}" aria-pressed="${state.stage === id}">${escape(stageName(id))}</button>`).join('')}</div></div></section></div><section class="feed-viewport" aria-label="问答内容流" tabindex="0"><div class="filter-controls-spacer" aria-hidden="true"></div>${state.feed.length ? state.feed.map(cardHTML).join('') : '<div class="empty-state">这一边暂时还没有回声。<br>换一个方向，或先留下你的问题。</div>'}</section></div>${bottomTabBarHTML()}</div>`;
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
function showProfile() { ++state.request; state.screen = 'profile'; controls(false); app.innerHTML = `${bar('我的阶段')}<section class="form-screen"><h2>你正走到哪一程？</h2><p class="helper">用阶段认识彼此，不用头衔定义彼此。<br>阶段由你自己选择，会随问题和回答一起显示。</p><form id="profile-form"><label for="profile-stage">我目前的阶段</label><select id="profile-stage" name="stage">${options(state.user.stage)}</select><p class="helper">体验版按求学、工作、退休的顺序组织浏览方向，不代表经验或能力的高低。默认阶段为大学，可随时修改。</p><button class="primary-button" type="submit">保存我的阶段</button></form><p class="helper">当前使用本浏览器的访客身份保存操作，尚未接入知乎账号。</p></section>`; app.scrollTop = 0; }
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
 app.innerHTML = `${composerBar}<section class="composer-screen">${fromAI ? '<p class="composer-context-note">已带入刚才的追问，可继续修改后发布。</p>' : ''}<form id="ask-form" class="composer-form" data-draft-key="${escape(draftKey)}" data-source-seed="${escape(sourceSeed)}"><div class="composer-field composer-question-field"><label for="question-title">问题</label><textarea id="question-title" name="title" required maxlength="100" aria-describedby="question-title-status" placeholder="写下你真正想问的问题">${escape(draft.title)}</textarea><p id="question-title-status" class="field-status" aria-live="polite"></p></div><div class="composer-field composer-background-field"><label for="question-body">补充背景 <span>选填</span></label><textarea id="question-body" name="body" maxlength="1000" aria-describedby="question-body-status" placeholder="补充经历或困惑，让回答更贴近你"></textarea><p id="question-body-status" class="field-status" aria-live="polite"></p></div><fieldset class="composer-personal"><legend>我的阶段 <small>选填，仅用于这条问题</small></legend><div class="composer-personal-options">${stageChoices}</div></fieldset><fieldset class="composer-direction"><legend>提问方向</legend><div class="composer-personal-options">${directions}</div></fieldset><section class="composer-target-section" aria-labelledby="composer-target-heading"><div class="composer-target-heading"><div><strong id="composer-target-heading">想听谁说</strong><small>只是表达期待，不限制其他阶段回答</small></div><span id="question-target-status" class="field-status" aria-live="polite"></span></div><div class="composer-target-summary"><div class="composer-selected-targets" aria-label="已选择阶段"></div><button type="button" class="composer-target-add" data-action="toggle-targets" aria-expanded="false" aria-controls="composer-target-picker"># 想听谁说</button></div><div id="composer-target-picker" class="composer-target-picker" hidden><fieldset><legend class="sr-only">选择希望回答的阶段，可不选，最多六个</legend><div class="composer-target-options">${targetChoices}</div><p id="composer-target-empty" class="helper" hidden>这个方向没有可选阶段，可以切换提问方向。</p></fieldset><div class="composer-target-picker-footer"><span>可不选，也可以多选</span><button type="button" data-action="finish-targets">完成</button></div></div></section></form></section>`;
 app.querySelector('#question-body').value = draft.body;
 app.scrollTop = 0; updateComposerChoices();
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
function renderDetail({focusAnswerId = null, restoreScroll = true} = {}) {
 const q = state.detail; if (!q) return;
 const view = detailView(q.id);
 const requestedStages = questionTargets(q);
 const stages = availableAnswerStages(q);
 if (view.answerStage !== 'all' && !stages.includes(view.answerStage)) view.answerStage = 'all';
 const answers = view.answerStage === 'all' ? q.answers : q.answers.filter(answer => answer.stage === view.answerStage);
 const stageLabel = view.answerStage === 'all' ? '全部阶段' : stageName(view.answerStage);
 controls(false); state.screen = 'detail';
 app.innerHTML = `${bar('这一问，听大家说')}<section class="detail-screen"><article class="qa-card detail-question-card"><div class="question-meta">${q.stage ? `<span class="stage-tag">${escape(stageName(q.stage))}</span>` : ''}${requestedStages.length ? `<span>想听 · ${requestedStages.map(id => escape(stageName(id))).join('、')}</span>` : ''}</div><h2>${escape(q.title)}</h2>${q.body ? `<p class="question-body">${escape(q.body)}</p>` : ''}</article><div class="detail-actions"><button class="primary-button" data-action="answer">说说我的看法</button></div><section class="detail-answers" aria-labelledby="answer-section-title"><div class="detail-section-heading"><div><strong id="answer-section-title">听不同阶段的人说</strong><span>${q.answers.length} 条 · 按赞同数排列</span></div><div class="detail-stage-filter chips" role="group" aria-label="同题回答阶段筛选"><button data-action="detail-stage" data-value="all" class="${view.answerStage === 'all' ? 'active' : ''}" aria-pressed="${view.answerStage === 'all'}">全部</button>${stages.map(id => `<button data-action="detail-stage" data-value="${id}" class="${view.answerStage === id ? 'active' : ''}" aria-pressed="${view.answerStage === id}">${escape(stageName(id))}</button>`).join('')}</div></div><div class="section-caption">${escape(stageLabel)}的回答 · ${answers.length} 条</div>${answers.length ? answers.map(answer => answerHTML(answer, q.id, true)).join('') : '<div class="empty-state">这一阶段还没有回答。你的经历，也许能带来第一个新视角。</div>'}</section><section class="detail-ai-section"><button class="detail-ai-toggle" type="button" data-action="toggle-ai" aria-expanded="${view.aiOpen}" aria-controls="detail-ai-panel"><span><strong>带着资料继续问</strong><small>AI 依据资料整理 · 最多三问 · 来源可查</small></span><span aria-hidden="true">${view.aiOpen ? '收起' : '展开'}</span></button><div id="detail-ai-panel" class="detail-ai-panel" ${view.aiOpen ? '' : 'hidden'} aria-live="polite">${view.aiOpen ? aiPanelHTML(q, view) : ''}</div></section></section>`;
 if (focusAnswerId) {
  requestAnimationFrame(() => { const answer = app.querySelector(`[data-answer-id="${focusAnswerId}"]`); if (answer) { answer.tabIndex = -1; answer.scrollIntoView({block:'center'}); answer.focus({preventScroll:true}); view.scrollTop = app.scrollTop; saveDetailView(q.id); } });
 } else if (restoreScroll) app.scrollTop = clamp(view.scrollTop || 0, 0, Math.max(0, app.scrollHeight - app.clientHeight));
 saveDetailView(q.id);
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
 if (captureFeed && state.screen === 'feed') captureFeedView(id);
 if (state.screen === 'detail' && state.detail) { const current = detailView(state.detail.id); current.scrollTop = app.scrollTop; saveDetailView(state.detail.id); }
 cleanupAIPoll(); state.aiRequest++;
 const ticket = ++state.request; const q = await api('/questions/' + id); if (ticket !== state.request) return;
 state.detail = q; state.screen = 'detail'; renderDetail({focusAnswerId});
 const view = detailView(id); if (view.aiOpen) loadAIState(id);
}
function showAnswer() { ++state.request; cleanupAIPoll(); const q = state.detail; state.screen = 'answer'; controls(false); app.innerHTML = `${bar('说说我的看法')}<section class="form-screen"><h2>${escape(q.title)}</h2><p class="helper">你的回答将带上「${escape(stageName(state.user.stage))} · 自述」标签。分享亲身感受就好。</p><form id="answer-form"><label for="answer-body">从你所在的这一程看呢？</label><textarea id="answer-body" name="body" required maxlength="1200" placeholder="不用标准答案，说说你自己的经历。"></textarea><button class="primary-button" type="submit">留下我的回答</button></form></section>`; app.scrollTop = 0; }
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
async function handleBack() {
 if (state.screen === 'answer') return showDetail(state.detail.id, {captureFeed:false});
 if (state.screen === 'ask') {
  saveCurrentComposerDraft(); removeStored('composer:active');
  if (state.composerOrigin?.type === 'ai-turn') return showDetail(state.composerOrigin.questionId, {captureFeed:false});
  return returnToFeed();
 }
 if (state.screen === 'detail' && state.detail) { const view = detailView(state.detail.id); view.scrollTop = app.scrollTop; saveDetailView(state.detail.id); }
 return returnToFeed();
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
  if (action === 'demo-share') return notice('这是一条榜单示例，可进入过来人发起真实讨论');
  if (action === 'demo-open') return showDemoArticle(b.dataset.channel,Number(b.dataset.index));
  if (action === 'demo-mark') {
   const key=b.dataset.key;if(demoMarks.has(key))demoMarks.delete(key);else demoMarks.add(key);
   const marked=demoMarks.has(key);b.setAttribute('aria-pressed',String(marked));b.querySelector('span').textContent=key.startsWith('vote:')?(marked?'已赞同':'赞同'):(marked?'已收藏':'收藏');return;
  }
  if (action === 'demo-discuss') {
   const item=DEMO_CHANNELS[b.dataset.channel]?.items[Number(b.dataset.index)];if(!item)return;
   await showCachedFeed();return showAsk(item.title,{type:'demo-item',channel:b.dataset.channel,index:Number(b.dataset.index)});
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
  if (action === 'search') return notice('搜索尚未接入体验版，先从过来人问答逛起吧');
  if (action === 'unavailable') return notice(`${b.dataset.label || '这个入口'}尚未接入体验版`);
  if (action === 'profile') { if (state.screen === 'feed') captureFeedView(); return showProfile(); }
  if (action === 'ask') { if (state.screen === 'feed') captureFeedView(); return showAsk('', {type:'feed'}); }
  if (action === 'answer') { const view = detailView(state.detail.id); view.scrollTop = app.scrollTop; saveDetailView(state.detail.id); return showAnswer(); }
  if (action === 'back') return await handleBack();
  if (action === 'mode') { state.mode = b.dataset.value; state.stage = 'all'; return await loadFeed(); }
  if (action === 'filter') { state.stage = b.dataset.value; return await loadFeed(); }
  if (action === 'detail-stage') { const view = detailView(state.detail.id); view.scrollTop = app.scrollTop; view.answerStage = b.dataset.value; saveDetailView(state.detail.id); return renderDetail(); }
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
  if (action === 'vote') { const answerId = Number(b.dataset.id); b.disabled = true; const result = await api('/vote', {answer_id:answerId, active:b.dataset.voted !== 'true'}); updateVoteState(answerId, result); b.dataset.voted = String(result.voted); b.classList.toggle('voted', result.voted); b.setAttribute('aria-pressed', String(result.voted)); b.setAttribute('aria-label', result.voted ? '取消赞同' : '赞同回答'); b.innerHTML = `${result.voted ? '♥' : '♡'} <span>${result.votes}</span>`; }
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
 if (form.id === 'ai-question-form') return submitAIQuestion(form);
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
   const questionId = state.detail.id; const result = await api('/answers', {body:data.body, question_id:questionId}); writeSucceeded = true;
   detailView(questionId).answerStage = state.user.stage;
   try { await showDetail(questionId, {captureFeed:false, focusAnswerId:result.id}); notice('回答已保存'); }
   catch (_) { showSavedRecovery(questionId, 'answer'); notice('回答已保存，请勿重复发布'); }
  }
 } catch (e) {
  notice(form.id === 'ask-form' && e instanceof TypeError ? '网络连接失败，草稿已保留，请稍后重试' : e.message);
 } finally {
  if (!writeSucceeded && form.id === 'ask-form' && form.isConnected) { form.dataset.submitting = 'false'; syncComposerUI(); }
  else if (!writeSucceeded && submit.isConnected) submit.disabled = false;
 }
});
async function boot() {
 try {
  state.user = await api('/me'); const restore = stored('feed', null); state.feedReturn = restore;
  try { await loadFeed({restore}); } catch (error) { if (!restore) throw error; state.mode = 'older'; state.stage = 'all'; state.feedReturn = null; await loadFeed(); }
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
boot();
