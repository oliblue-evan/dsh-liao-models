import test from 'node:test';
import assert from 'node:assert/strict';
import { clientScope } from './extract-client.mjs';
import { createPluginEnv, mountSettingsCard, settle, chooseSetting } from './load-client.mjs';
import { mountModelMenu, openPanelViaHeading } from './harness.mjs';
const L=clientScope(['normalizeState','resetUserData','makePreferenceBackup','readPreferenceBackup','mergePreferenceBackup','effectiveSort']);
const KEY='dsh-liao-models-state-v1';
const key=(p,m)=>JSON.stringify(['id',p,m]);
const spec={providers:[{id:'A',label:'A',models:[{id:'deepseek-pro',name:'DeepSeek Pro · x0.5'},{id:'deepseek-flash',name:'DeepSeek Flash · x0.1'}]},{id:'B',label:'B',models:[{id:'gpt-2',name:'GPT 2'},{id:'gpt-1',name:'GPT 1'}]}]};
const state=env=>JSON.parse(env.window.localStorage.getItem(KEY));
const choose=panel=>[...panel.querySelectorAll('[data-act="choose"]')].filter(x=>!x.closest('[hidden]'));
const type=(env,input,value)=>{input.value=value;input.dispatchEvent(new env.window.Event('input',{bubbles:true}));};
const btn=(root,text)=>[...root.querySelectorAll('button')].find(x=>x.textContent===text);
const change=chooseSetting;
async function setup(t,initial={}){
 const env=createPluginEnv({autoMount:false});env.window.localStorage.setItem(KEY,JSON.stringify(L.normalizeState({version:6,...initial})));env.ctx.get=()=>({catalog:{store:{getSnapshot:()=>({value:{groups:spec.providers.map(p=>({id:p.id,name:p.label,models:p.models}))}}),subscribe:()=>()=>{}}}});env.plugin.apply(env.ctx);
 const view=mountModelMenu(env.document,spec);await settle(env.window);const panel=openPanelViaHeading(env,view);const card=mountSettingsCard(env);await settle(env.window,40);
 t.after(()=>{card.unmount();env.dispose();});return {env,view,panel,root:card.container};
}
test('all preferences normalize, preserve old records and survive clear independently',()=>{
 const old={version:6,favorites:[key('A','deepseek-pro')],aliases:{[key('A','deepseek-pro')]:'主力'}};
 const defaults=L.normalizeState(old);assert.equal(defaults.panelWidth,360);assert.equal(defaults.openOn,'hover');assert.equal(defaults.recentCount,8);
 const normalized=L.normalizeState({...old,density:'relaxed',panelWidth:440,panelHeight:85,openOn:'click',hoverDelay:300,searchScope:'all',reopen:'clear',seriesState:'collapsed',showFavorites:false,showRecents:false,recentCount:12,sortMode:'provider',providerSorts:{A:'price-desc',B:'bad'}});
 assert.deepEqual(normalized.providerSorts,{A:'price-desc'});assert.equal(L.effectiveSort(normalized,'A'),'price-desc');
 const cleared=L.resetUserData(normalized);assert.deepEqual(cleared.favorites,[]);
 for(const field of ['density','panelWidth','panelHeight','openOn','hoverDelay','searchScope','reopen','seriesState','showFavorites','showRecents','recentCount','sortMode','providerSorts'])assert.deepEqual(cleared[field],normalized[field]);
 assert.equal(L.normalizeState({...old,panelWidth:100000,hoverDelay:-1,seriesState:'bad'}).panelWidth,360);
 assert.deepEqual(L.normalizeState(old).aliases,old.aliases);
});
test('live size and density controls update both preview and actual panel without host styles',async t=>{
 const {env,panel,root}=await setup(t);await change(env,root,'列表密度','compact');await change(env,root,'浮框宽度',440);await change(env,root,'最大高度',85);await settle(env.window,50);
 assert.equal(panel.style.width,'440px');assert.equal(panel.style.maxHeight,'85vh');assert.equal(panel.dataset.density,'compact');
 assert.equal(root.querySelector('.mo-preview').style.width,'440px');assert.equal(root.querySelector('.mo-preview').dataset.density,'compact');
 assert.equal(env.document.documentElement.style.width,'');
});
test('per-provider order overrides stay isolated and global choice remains the fallback',async t=>{
 const {env,view,panel}=await setup(t,{sortMode:'provider'});
 panel.querySelector('[data-order="price-asc"]').click();assert.match(choose(panel)[0].textContent,/Flash/);
 openPanelViaHeading(env,view,1);assert.match(choose(panel)[0].textContent,/GPT 2/);
 panel.querySelector('[data-order="name"]').click();assert.match(choose(panel)[0].textContent,/GPT 1/);
 openPanelViaHeading(env,view,0);assert.match(choose(panel)[0].textContent,/Flash/);
 assert.equal(state(env).sortOrder,'default');assert.equal(Object.keys(state(env).providerSorts).length,2);
});
test('empty local search can expand globally preserving query; clearing reopen resets query and scroll',async t=>{
 const {env,view,panel,root}=await setup(t,{reopen:'clear'});type(env,panel.querySelector('.mo-search'),'GPT');
 panel.querySelector('[data-act="search-global"]').click();assert.equal(panel.querySelector('.mo-search').value,'GPT');assert.equal(choose(panel).length,2);
 panel.querySelector('.mo-list').scrollTop=80;panel.querySelector('[data-act="close"]').click();openPanelViaHeading(env,view,0);
 assert.equal(panel.querySelector('.mo-search').value,'');assert.equal(panel.querySelector('.mo-list').scrollTop,0);
 await change(env,root,'默认搜索范围','all');await settle(env.window,30);panel.querySelector('[data-act="close"]').click();openPanelViaHeading(env,view,0);assert.equal(panel.querySelector('[data-scope="all"]').getAttribute('aria-pressed'),'true');
});
test('initial collapsed groups can be temporarily expanded; search reveals matches and reopen reapplies initial state',async t=>{
 const {env,view,panel}=await setup(t,{seriesState:'collapsed'});const models=()=>panel.querySelector('.mo-series-models');
 assert.equal(models().hidden,true);panel.querySelector('[data-act="series"]').click();assert.equal(models().hidden,false);
 type(env,panel.querySelector('.mo-search'),'DeepSeek');assert.equal(models().hidden,false);type(env,panel.querySelector('.mo-search'),'');assert.equal(models().hidden,false);
 panel.querySelector('[data-act="close"]').click();openPanelViaHeading(env,view);assert.equal(models().hidden,true);assert.deepEqual(state(env).collapsedSeries,[]);
});
test('click opening and delayed hover cancel on pointer exit and plugin disposal',async t=>{
 const {env,view,panel,root}=await setup(t);panel.querySelector('[data-act="close"]').click();await change(env,root,'厂商展开方式','click');await settle(env.window,30);
 const heading=view.sections[0].querySelector('[data-menu-group-heading]');heading.dispatchEvent(new env.window.MouseEvent('mouseover',{bubbles:true}));assert.equal(panel.hidden,true);
 heading.click();assert.equal(panel.hidden,false);panel.querySelector('[data-act="close"]').click();await change(env,root,'厂商展开方式','hover');await change(env,root,'悬停延迟',150);await settle(env.window,30);
 heading.dispatchEvent(new env.window.MouseEvent('mouseover',{bubbles:true}));assert.equal(panel.hidden,true);heading.dispatchEvent(new env.window.MouseEvent('mouseout',{bubbles:true,relatedTarget:env.document.body}));await settle(env.window,180);assert.equal(panel.hidden,true);
 heading.dispatchEvent(new env.window.MouseEvent('mouseover',{bubbles:true}));await settle(env.window,180);assert.equal(panel.hidden,false);
 panel.querySelector('[data-act="close"]').click();heading.dispatchEvent(new env.window.MouseEvent('mouseover',{bubbles:true}));env.dispose();await settle(env.window,180);assert.equal(env.document.getElementById('dsh-liao-models-panel'),null);
});
test('overview sections and recent display cap never truncate saved records',async t=>{
 const recents=Array.from({length:12},(_,i)=>key('A',`missing-${i}`));recents.splice(0,0,key('A','deepseek-pro'),key('A','deepseek-flash'));
 const {env,panel,root}=await setup(t,{favorites:[key('A','deepseek-pro')],recents,showFavorites:false,showRecents:false,recentCount:4});panel.querySelector('[data-act="overview"]').click();
 assert.equal(choose(panel).length,0);root.querySelector('[aria-label="显示最近"]').click();await settle(env.window,30);assert.equal(choose(panel).length,2);
 await change(env,root,'最近显示数量',12);await settle(env.window,30);assert.equal(state(env).recents.length,14);
});
test('backup validation, merging and replacing preserve local conflicts as advertised',()=>{
 const local=L.normalizeState({fontSize:14,panelWidth:440,favorites:[key('A','one')],hidden:[key('A','two')],aliases:{[key('A','one')]:'本机'}});
 const imported=L.readPreferenceBackup(JSON.stringify(L.makePreferenceBackup({fontSize:12,favorites:[key('A','two'),key('B','three')],hidden:[key('A','one')],aliases:{[key('A','one')]:'导入'}})));
 const merged=L.mergePreferenceBackup(local,imported,'merge');assert.equal(merged.fontSize,14);assert.equal(merged.panelWidth,440);assert.equal(merged.aliases[key('A','one')],'本机');assert.deepEqual(merged.hidden,[key('A','two')]);assert.ok(merged.favorites.includes(key('B','three')));
 assert.deepEqual(L.mergePreferenceBackup(local,imported,'replace'),imported);
 for(const text of ['null','{}',JSON.stringify({format:'dsh-liao-models',version:2,state:local}),JSON.stringify({...L.makePreferenceBackup(local),state:{...local,hidden:['garbage']}}),'x'.repeat(1024*1024+1)])assert.throws(()=>L.readPreferenceBackup(text));
});
test('import requires preview and confirmation, can be undone, and subsequent edits invalidate undo',async t=>{
 const {env,root}=await setup(t,{fontSize:14});const before=state(env);const file=root.querySelector('input[type="file"]');
 const incoming=L.makePreferenceBackup({fontSize:12,aliases:{[key('A','deepseek-pro')]:'Imported'}});
 Object.defineProperty(file,'files',{configurable:true,value:[{size:100,text:async()=>JSON.stringify(incoming)}]});file.dispatchEvent(new env.window.Event('change',{bubbles:true}));await settle(env.window,40);
 assert.deepEqual(state(env),before);assert.ok(btn(root,'确认导入'));await change(env,root,'导入方式','replace');await settle(env.window,20);btn(root,'确认导入').click();await settle(env.window,40);assert.equal(state(env).fontSize,12);
 btn(root,'撤销导入').click();await settle(env.window,40);assert.deepEqual(state(env),before);
 file.dispatchEvent(new env.window.Event('change',{bubbles:true}));await settle(env.window,30);btn(root,'确认导入').click();await settle(env.window,30);await change(env,root,'列表密度','compact');await settle(env.window,30);assert.equal(btn(root,'撤销导入'),undefined);
});
test('export uses a versioned sanitized backup and revokes its download URL',async t=>{
 const {env,root}=await setup(t,{aliases:{[key('A','deepseek-pro')]:'My model'}});let blob,revoked=false,download;
 env.window.URL.createObjectURL=value=>{blob=value;return 'blob:owned-backup';};env.window.URL.revokeObjectURL=url=>{assert.equal(url,'blob:owned-backup');revoked=true;};
 const proto=env.window.HTMLAnchorElement.prototype;const original=proto.click;proto.click=function(){download=this.download;};t.after(()=>{proto.click=original;});
 btn(root,'导出偏好').click();await settle(env.window,30);assert.ok(blob);assert.equal(download,'dsh-liao-models-preferences.json');assert.equal(root.querySelectorAll('a').length,0);
 assert.ok(root.querySelector('[role="status"]').textContent.includes('已生成'));
 const reader=new env.window.FileReader();const text=await new Promise((resolve,reject)=>{reader.onload=()=>resolve(reader.result);reader.onerror=reject;reader.readAsText(blob);});
 const saved=L.readPreferenceBackup(text);assert.deepEqual(saved,state(env));assert.equal(JSON.parse(text).format,'dsh-liao-models');await settle(env.window,1020);assert.equal(revoked,true);
});
test('invalid and oversized imports never change the current preferences',async t=>{
 const {env,root}=await setup(t);const before=state(env);const file=root.querySelector('input[type="file"]');
 for(const value of [{size:2,text:async()=>'{}'},{size:1024*1024+1,text:async()=>{throw new Error('must not read');}}]){
  Object.defineProperty(file,'files',{configurable:true,value:[value]});file.dispatchEvent(new env.window.Event('change',{bubbles:true}));await settle(env.window,30);
  assert.deepEqual(state(env),before);assert.equal(btn(root,'确认导入'),undefined);assert.ok(root.querySelector('[role="status"]').textContent.includes('无法读取'));
 }
});
test('compact layout hides irrelevant controls without losing their saved choices',async t=>{
 const {env,root}=await setup(t,{hoverDelay:300,showRecents:false,recentCount:12});
 assert.equal(root.querySelector('[data-setting="recentCount"]'),null);
 await chooseSetting(env,root,'厂商展开方式','click');assert.equal(root.querySelector('[data-setting="hoverDelay"]'),null);assert.equal(state(env).hoverDelay,300);
 await chooseSetting(env,root,'厂商展开方式','hover');assert.equal(root.querySelector('[data-setting="hoverDelay"] [aria-pressed="true"]').dataset.value,'300');
 root.querySelector('[aria-label="显示最近"]').click();await settle(env.window,20);assert.equal(root.querySelector('[data-setting="recentCount"] [aria-pressed="true"]').dataset.value,'12');
 assert.equal(state(env).recentCount,12);
});
