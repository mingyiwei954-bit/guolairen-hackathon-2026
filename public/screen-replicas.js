/* Editable text and DOM recreation of the three user-provided mobile screenshots. */
const SHOT_DATA = {
 recommend: [
  {title:'现在社会各阶层的年轻人都处于什么状态？',author:'苏达子有点懒',text:'97年，22年211硕士毕业考上省直，一直不喜欢现在的工作，但是父母以命相逼不让辞职。家里给我买了…',counts:['410','163','257']},
  {title:'未来几年最好的投资是什么？',author:'做多知乎',badge:'1.9 万人关注',text:'ai 缺什么，你就投什么 目前是存储，你买 mu 过几个月是 cpu，你就买 intc 过一年是发电机/逆变器，你就…',counts:['1.2 万','1.4 万','606']},
  {title:'你有没有什么忠告想告诉刚刚毕业的年轻人？',author:'相忘于江湖',text:'赶快考公考编进体制内，别有丝毫犹豫。国内20年之内大概率会越来越卷，每年都会有一千多万大学毕业…',counts:['1525','1513','793']},
  {title:'什么样的性格适合体制内？',author:'Pioneer',text:'我告诉你，真正适合体制内的性格只有一种，那就是对自我价值实现毫无兴趣且拥有极高情绪隔离能力的“…',counts:['9146','1 万','489']},
  {title:'AI泡沫会在今年或者明年破裂吗，为什么？',author:'山海之间',text:'关于新技术，每个人都有自己的观察。把时间拉长一点，再看看变化发生在哪里。',counts:['216','80','63']}
 ],
 hot: [
  {title:'广汽集团发布公告，筹划购买一汽股份持有的某整车合资公司部分股权，会带来哪些影响？',heat:'497',image:'cars'},
  {title:'北京一独居者离世，无配偶、子女、兄弟姐妹，叔舅姑姨九人争遗产，法院判房产归国家，如何从法律角度解读？',heat:'410',image:'family',discussion:'9 亲戚争独居者遗产房子…'},
  {title:'哪个著名演员，演好人非常像，演坏人也非常像？',heat:'183',image:'actor'},
  {title:'程序员为干私活腾空间 17 小时删光公司 89TB 数据，获刑五年十个月，暴露哪些问题？',heat:'179',image:'server'}
 ],
 follow: [
  {title:'CHINA GT 上海站发生重大撞车起火事故，车手放弃比赛救人；耐克将被移出标普 100 指…',author:'知乎日报',date:'09-08 · 发表了文章',text:'嘿，这里是知乎早报！编辑部小李为广大知友准备了每日必看的热点消息和编辑精选的优质内容，更有答…',counts:['190','37','14']},
  {title:'📍 知乎黑客松校园行，北理站人气开场，再带你认识一些有趣的年轻人',author:'知乎日报',date:'09-12 · 发布了想法',text:'把一个好奇的问题，变成一次真诚的交流。今天，一起听听不同阶段的声音。',counts:['120','26','18']}
 ]
};
const SHOT_IMAGES = {
 cars:'https://picx.zhimg.com/v2-2064ef96fda7c10283829ff45a5c3dd0_400x224.jpg?source=1def8aca',
 family:'https://picx.zhimg.com/v2-1d34dbec6e50e25265739a4a5e58b3e7_400x224.png',
 actor:'https://pica.zhimg.com/80/v2-f3716c9b851095dad51ff9530bd47411_400x224.webp?source=1def8aca',
 server:'https://picx.zhimg.com/80/v2-55e700650a1bd3111c1578dc3f7a9670_400x224.webp?source=1def8aca'
};
function shotSvg(name) {
 const paths={micro:'<rect x="9" y="2" width="6" height="12" rx="3"/><path d="M5 10v2a7 7 0 0 0 14 0v-2M12 19v3M9 22h6"/>',wifi:'<path d="M2 8c6-5 14-5 20 0M6 12c4-3 8-3 12 0M10 16c1.4-1 2.6-1 4 0"/><circle cx="12" cy="20" r="1" fill="currentColor"/>',person:'<circle cx="12" cy="7" r="4" fill="currentColor" stroke="none"/><path d="M4 22v-3a8 8 0 0 1 16 0v3" fill="currentColor" stroke="none"/>',calendar:'<rect x="4" y="5" width="16" height="17" rx="2"/><path d="M8 2v6M16 2v6"/><text x="12" y="18" text-anchor="middle" font-size="11" fill="#29b5de" stroke="none">14</text>',like:'<path d="M8 21H4V10h4m0 11h11l2-12h-7l1-5c0-3-3-3-3-1L8 10Z"/>',flame:'<path d="M12 2c-1 6-8 7-8 13a8 8 0 0 0 16 0c0-4-2-6-4-8 0 3-2 4-2 4 1-4 0-7-2-9Z"/>',ban:'<circle cx="12" cy="12" r="9"/><path d="m6 6 12 12" stroke="#f58967"/>',friends:'<circle cx="10" cy="8" r="4" fill="white" stroke="none"/><circle cx="17" cy="8" r="3" fill="#b1ebff" stroke="none"/><path d="M2 22v-4a7 7 0 0 1 14 0v4M16 14c5 0 7 2 7 8h-5" fill="white" stroke="none"/>',dog:'<path d="M5 20 4 9l3-5 3 5h4l3-5 3 6-1 10Z" fill="white" stroke="white"/><circle cx="10" cy="12" r="1" fill="#222" stroke="none"/><ellipse cx="17" cy="14" rx="4" ry="3" fill="#444" stroke="none"/>'};
 return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[name]||paths.dog}</svg>`;
}
function shotHeader(id) {
 const labels=[['follow','关注'],['recommend','推荐'],['hot','热榜'],['story','故事'],['knowledge','知识'],['guolairen','过来人']];
 return `<header class="shot-header"><div class="shot-status" aria-label="手机展示状态栏"><span>22:30 ${shotSvg('person')}</span><div><i class="shot-signal"><b></b><b></b><b></b><b></b></i>${shotSvg('wifi')}<strong class="shot-battery">100</strong></div></div><div class="shot-search"><span>${id==='follow'?'有政治天赋的人的特点':'你会嫌弃父母穷吗'}</span><button data-action="shot-notice" aria-label="语音搜索">${shotSvg('micro')}</button><button class="shot-search-button" data-action="search">搜索</button></div><nav class="shot-tabs" aria-label="内容频道">${labels.map(([key,label])=>`<button data-action="${key==='guolairen'?'home':'channel'}" data-channel="${key}" class="${id===key?'active':''}">${label}</button>`).join('')}<button data-action="shot-notice">圈子</button><button data-action="shot-notice">专栏</button></nav></header>`;
}
function shotAvatar(index,large=false) {return `<span class="shot-avatar ${large?'large':''} shot-avatar-${index%4}" aria-hidden="true">${shotSvg(index%2?'friends':'dog')}</span>`;}
function shotActions(item,channel,index) {
 return `<div class="shot-actions">${['vote','save','comment'].map((kind,i)=>`<button data-action="${i===2?'demo-open':'shot-mark'}" data-channel="${channel}" data-index="${index}" data-original="${item.counts[i]}" aria-label="${['赞同','收藏','评论'][i]} ${item.counts[i]}" aria-pressed="false">${shotActionIcon(kind)}<span>${item.counts[i]}</span></button>`).join('')}<button data-action="shot-hide" aria-label="${channel==='follow'?'更多':'不感兴趣'}" class="shot-dismiss">${channel==='follow'?'···':'×'}</button></div>`;
}
function shotRecommend() {return mockItems('recommend').map((item,i)=>`<article class="shot-item"><button class="shot-question" data-action="demo-open" data-channel="recommend" data-index="${i}">${escape(item.title)}</button><div class="shot-author">${shotAvatar(i)}<span>${escape(item.author)}</span>${item.badge?`<small>${item.badge}</small>`:''}</div><p class="shot-excerpt">${escape(item.text)}</p>${shotActions(item,'recommend',i)}</article>`).join('');}
function shotThumb(kind) {
 if(SHOT_IMAGES[kind])return `<img class="shot-thumb" src="${escape(SHOT_IMAGES[kind])}" alt="" referrerpolicy="no-referrer">`;
 const art={cars:'<rect width="70" height="70" fill="#acbaca"/><ellipse cx="37" cy="23" rx="24" ry="19" fill="#dfe5e9"/><ellipse cx="37" cy="23" rx="19" ry="14" fill="#234261"/><text x="37" y="30" font-size="19" text-anchor="middle" fill="white">一汽</text><circle cx="19" cy="59" r="16" fill="#28496e"/><circle cx="57" cy="58" r="16" fill="#d8494c"/>',family:'<rect width="70" height="70" fill="#efcdae"/><path d="m20 50 5-27 10-9 12 9 4 27Z" fill="#e2b144" stroke="#555"/><text x="35" y="42" text-anchor="middle" font-size="10">遗产</text><circle cx="9" cy="39" r="7" fill="#fff"/><path d="M3 46h13v24H3" fill="#e16b3c"/><circle cx="60" cy="38" r="7" fill="#fff"/><path d="M54 45h13v25H54" fill="#949485"/>',actor:'<rect width="70" height="70" fill="#a4b0a8"/><path d="M12 70V43c0-31 46-32 46 0v27" fill="#3d474b"/><ellipse cx="35" cy="31" rx="16" ry="23" fill="#bfad95"/><path d="M18 27V12q20-21 34 2v14l-8-16-22 6" fill="#2b3030"/><path d="m24 31 6 0m10 0h6M29 43q8 5 15 0" stroke="#584e43" stroke-width="2"/>',server:'<rect width="70" height="70" fill="#032439"/>'+[0,1,2,3].map(i=>`<rect x="${i*18}" y="5" width="14" height="63" fill="#075d81"/>`+[0,1,2,3,4,5,6].map(j=>`<rect x="${i*18+2}" y="${j*9+8}" width="10" height="3" fill="#31b5e2"/>`).join('')).join('')};
 return `<svg class="shot-thumb" viewBox="0 0 70 70" aria-hidden="true">${art[kind]}</svg>`;
}
function shotHot() {return `<div class="shot-shortcuts">${[['calendar','知乎日报'],['like','每周必看'],['flame','错过热议'],['ban','辟谣专区']].map(([icon,label])=>`<button data-action="shot-shortcut" data-label="${label}">${shotSvg(icon)}<span>${label}</span></button>`).join('')}</div><button class="shot-news" data-action="shot-notice"><span>关注</span>卫龙进口魔芋粉检出二氧化硫超标</button>${mockItems('hot').map((item,i)=>`<article class="shot-hot-item"><span class="shot-number shot-number-${i}">${i+1}</span><div class="shot-hot-main"><div class="shot-hot-line"><button class="shot-question" data-action="demo-open" data-channel="hot" data-index="${i}">${item.title}</button>${item.image?shotThumb(item.image):''}</div><p class="shot-heat">${item.heat} 万热度</p>${item.discussion?`<button class="shot-discussion" data-action="demo-open" data-channel="hot" data-index="${i}"><span>🔥 ${item.discussion}</span><em>302 万人正在热议</em><b>›</b></button>`:''}</div></article>`).join('')}`;}
function shotGallery() {return `<div class="shot-gallery"><div class="shot-photo-scene"><svg viewBox="0 0 150 185" preserveAspectRatio="xMidYMid slice" aria-hidden="true"><rect width="150" height="185" fill="#adc5c5"/><path d="M0 110 150 100v85H0Z" fill="#818b79"/>${[[65,27,22],[92,49,35],[52,70,35],[108,83,35],[79,102,42]].map(([x,y,r])=>`<circle cx="${x}" cy="${y}" r="${r}" fill="#586164"/>`).join('')}<path d="m60 155 12-43 16 22 8-15 18 39" fill="#f1a126"/><path d="M16 159 30 142h72l31 23-6 12H14Z" fill="#ebeddf" stroke="#333"/><circle cx="35" cy="173" r="10" fill="#252525"/><circle cx="112" cy="173" r="10" fill="#252525"/></svg><small>谢谢你，你是孤胆英雄</small></div><div class="shot-document"><strong>严正声明</strong>${Array.from({length:8},(_,i)=>`<p>${i===0?'我方在赛事现场发生事故后，立即配合开展相关工作。':'关于本次事件的具体情况，我们将持续核实并公开说明，感谢大家的关注与支持。'}</p>`).join('')}</div><div class="shot-sheet"><b>购买渠道　购买日期</b>${Array.from({length:24},(_,i)=>`<div>官方商城　2026.${i%9+1}.${i%28+1}</div>`).join('')}</div></div>`;}
function shotFollow() {return `<div class="shot-follow-shortcuts"><button data-action="shot-shortcut" data-label="发现好友"><span>${shotSvg('friends')}<i></i></span><b>发现好友</b></button><button data-action="shot-shortcut" data-label="知乎日报"><span>${shotSvg('dog')}<i></i></span><b>知乎日报</b></button></div><div class="shot-follow-filters" role="group" aria-label="关注筛选">${['精选','最新','想法'].map((t,i)=>`<button data-action="shot-follow-filter" aria-pressed="${i===0}">${t}</button>`).join('')}</div><div class="shot-follow-posts">${mockItems('follow').map((item,i)=>`<article class="shot-follow-item" data-kind="${item.kind||'文章'}"><div class="shot-follow-author">${shotAvatar(0,true)}<div><span>${item.author}</span><small>${item.date}</small></div><b class="shot-creator">人人都是<br>创作者<span>✦</span></b></div><button class="shot-question" data-action="demo-open" data-channel="follow" data-index="${i}">${item.title}</button><p class="shot-excerpt">${item.text}</p>${item.id==='sample:follow:0'?shotGallery():''}${shotActions(item,'follow',i)}</article>`).join('')}</div>`;}
function renderScreenshotChannel(id) {
 prepareDemoScreen();state.screen='demo';state.demoChannel=id;
 app.innerHTML=`<div class="app-shell demo-shell shot-shell">${shotHeader(id)}<section class="demo-feed shot-feed" aria-label="${{follow:'关注',recommend:'推荐',hot:'热榜'}[id]}频道示例内容" tabindex="0">${id==='recommend'?shotRecommend():id==='hot'?shotHot():shotFollow()}<p class="shot-disclaimer">界面演示 · 内容与互动数据为截图示例</p></section>${bottomTabBarHTML('home')}</div>`;
 requestAnimationFrame(()=>{const v=app.querySelector('.shot-feed');if(v&&state.demoChannel===id)v.scrollTop=state.demoScroll.get(id)||0;});
}

function shotActionIcon(kind) {
 if(kind!=='comment')return demoIcon(kind);
 return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.65" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 18c1-2 1-4 1-6a10 10 0 1 0-10 10c2 0 4-.5 6-1l4 1Z"/></svg>';
}
