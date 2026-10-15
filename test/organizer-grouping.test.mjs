import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { clientScope } from './extract-client.mjs';
import { createPluginEnv, settle, mountSettingsCard } from './load-client.mjs';
import { mountModelMenu, openPanelViaHeading } from './harness.mjs';
import { attachKernelBehavior, realClick } from './kernel-behavior.mjs';
const logic = clientScope(['modelSeries', 'modelMultiplier', 'orderEntries', 'normalizeState', 'resetUserData', 'matchesQuery']);
const KEY = 'dsh-model-organizer-state-v1';
const entry = (name, label = name) => ({ key: JSON.stringify(['A',name]), name, raw: name, label });
const spec = { providers: [
  { id: 'a', label: 'Alpha', models: [
    { id:'deepseek-v4-pro',name:'DeepSeek-V4-Pro · x0.51' },
    { id:'gpt-6.1-sol',name:'gpt-6.1-sol' },
    { id:'deepseek-v4.1-flash',name:'DeepSeek-V4.1-Flash · x0.11' },
    { id:'custom',name:'Unclassified' },
  ] },
  { id: 'b', label: 'Beta', models: [{ id:'deepseek-v4-pro',name:'DeepSeek-V4-Pro · x0.5' }] },
] };
const type = (env,node,value) => { node.value=value;node.dispatchEvent(new env.window.Event('input',{bubbles:true})); };
const chooseRows = panel => [...panel.querySelectorAll('[data-act="choose"]')];
async function setup(t, state) {
  const env=createPluginEnv({autoMount:false});t.after(()=>env.dispose());
  if(state)env.window.localStorage.setItem(KEY,JSON.stringify({version:6,...state}));
  env.plugin.apply(env.ctx);const view=mountModelMenu(env.document,spec);await settle(env.window);
  return {env,view,panel:openPanelViaHeading(env,view)};
}

test('families use IDs before raw names, support provider namespaces and ignore aliases',()=>{
  assert.equal(logic.modelSeries({...entry('主力'),modelId:'vendor/deepseek-v4.1-flash'}),'DeepSeek');
  assert.equal(logic.modelSeries({...entry('DeepSeek'),modelId:'openai/gpt-6.1-sol'}),'GPT');
  assert.equal(logic.modelSeries(entry('gpt-6.1-sol','小助手')),'GPT');
  assert.equal(logic.modelSeries(entry('notdeepseek-custom')),'其他');
  assert.equal(logic.matchesQuery({key:JSON.stringify(['id','a','channel/deepseek-v4-pro']),raw:'主力'}, {},'deepseek-v4-pro'),true);
});
test('multiplier parsing handles final arrows, explicit free, missing and malformed values',()=>{
  for(const [name,value] of [['DS · x0.15→x0.08',.08],['DS · x0.00→免费',0],['DS · 免费',0],['DS · ×0.51',.51],['DS · x0.05 X',.05],['free-model',null],['gpt-6.1',null],['DS · x-2',null]])assert.equal(logic.modelMultiplier(name),value,name);
});
test('sort is numeric and stable, unknown remains last both ways; default preserves original',()=>{
  const models=['DS · x10','DS · x2','DS unknown','DS · 免费','DS · x2'].map(name=>entry(name));
  assert.deepEqual(logic.orderEntries(models,'price-asc','',{}).map(x=>x.name),['DS · 免费','DS · x2','DS · x2','DS · x10','DS unknown']);
  assert.equal(logic.orderEntries(models,'price-desc','',{}).at(-1).name,'DS unknown');
  assert.deepEqual(logic.orderEntries(models,'default','',{}),models);
  assert.deepEqual(logic.orderEntries([entry('gpt-10'),entry('gpt-2')],'name','',{}).map(x=>x.name),['gpt-2','gpt-10']);
});
test('new settings normalize individually and resetting records preserves browsing preferences',()=>{
  const state=logic.normalizeState({version:6,groupSeries:false,sortOrder:'price-desc',collapsedSeries:['a'],favorites:['x']});
  const reset=logic.resetUserData(state);assert.equal(reset.groupSeries,false);assert.equal(reset.sortOrder,'price-desc');assert.deepEqual(reset.collapsedSeries,[]);
  assert.equal(logic.normalizeState({groupSeries:'bad',sortOrder:'bad'}).groupSeries,true);
  assert.equal(logic.normalizeState({sortOrder:'bad'}).sortOrder,'default');
});
test('series collapse persists, search expands matches temporarily, keyboard skips collapsed models',async t=>{
  const {env,view,panel}=await setup(t);
  panel.querySelector('[data-family="DeepSeek"] [data-act="series"]').click();
  assert.equal(panel.querySelector('[data-family="DeepSeek"] .mo-series-models').hidden,true);
  const search=panel.querySelector('.mo-search');search.focus();search.dispatchEvent(new env.window.KeyboardEvent('keydown',{key:'ArrowDown',bubbles:true,cancelable:true}));
  assert.equal(env.document.activeElement.dataset.name,'gpt-6.1-sol');
  type(env,search,'deepseek');assert.equal(panel.querySelector('[data-family="DeepSeek"] .mo-series-models').hidden,false);
  type(env,search,'');assert.equal(panel.querySelector('[data-family="DeepSeek"] .mo-series-models').hidden,true);
  panel.querySelector('[data-act="close"]').click();openPanelViaHeading(env,view);
  assert.equal(panel.querySelector('[data-family="DeepSeek"] .mo-series-models').hidden,true);
  assert.equal(JSON.parse(env.window.localStorage.getItem(KEY)).collapsedSeries.length,1);
});
test('global search preserves keyword, groups providers and keeps aliased rows single-line',async t=>{
  const aliasKey=JSON.stringify(['Alpha','DeepSeek-V4.1-Flash · x0.11']);
  const {env,panel}=await setup(t,{aliases:{[aliasKey]:'速用'}});
  type(env,panel.querySelector('.mo-search'),'deepseek');assert.equal(chooseRows(panel).length,2);
  panel.querySelector('[data-scope="all"]').click();assert.equal(panel.querySelector('.mo-search').value,'deepseek');
  assert.equal(panel.querySelectorAll('.mo-result-provider').length,2);
  assert.equal(panel.querySelector('.mo-summary').textContent,'2 个厂商 · 3 个模型');
  assert.equal(panel.querySelector('.mo-row-sub'),null);assert.equal(panel.querySelectorAll('.mo-alias-mark').length,1);
  assert.match(chooseRows(panel).find(row=>row.textContent.includes('速用')).title,/DeepSeek-V4.1-Flash/);
  panel.querySelector('[data-scope="local"]').click();assert.equal(chooseRows(panel).length,2);
});
test('provider browsing remembers keyword, scope and scroll without changing native selection',async t=>{
  const {env,view,panel}=await setup(t);const kernel=attachKernelBehavior(env.document,view);t.after(()=>kernel.detach());
  type(env,panel.querySelector('.mo-search'),'deepseek');panel.querySelector('.mo-list').scrollTop=84;
  openPanelViaHeading(env,view,1);type(env,panel.querySelector('.mo-search'),'pro');
  openPanelViaHeading(env,view,0);assert.equal(panel.querySelector('.mo-search').value,'deepseek');assert.equal(panel.querySelector('.mo-list').scrollTop,84);
  realClick(env.window,panel.querySelector('[data-act="sort-menu"]'));
  assert.equal(panel.querySelector('.mo-sort-menu').hidden,false);
  realClick(env.window,panel.querySelector('[data-order="price-asc"]'));
  assert.equal(panel.querySelector('.mo-sort-menu').hidden,true);
  assert.equal(chooseRows(panel)[0].dataset.name,'DeepSeek-V4.1-Flash · x0.11');
  assert.equal(JSON.parse(env.window.localStorage.getItem(KEY)).sortOrder,'price-asc');
  assert.equal(kernel.isOpen(),true);
  let selected=0;view.items[2].addEventListener('click',()=>selected++);realClick(env.window,chooseRows(panel)[0]);assert.equal(selected,1);
});
test('settings toggle applies to open panel and flat global results keep provider headers',async t=>{
  const {env,panel}=await setup(t);const card=mountSettingsCard(env);t.after(()=>card.unmount());await settle(env.window,70);
  const toggle=card.container.querySelector('[role="switch"][aria-label="按模型系列分组"]');assert.ok(toggle);toggle.click();await settle(env.window,50);
  assert.equal(panel.querySelector('[data-act="series"]'),null);
  panel.querySelector('[data-scope="all"]').click();assert.equal(panel.querySelectorAll('.mo-result-provider').length,2);
  assert.equal(panel.querySelector('.mo-row-sub'),null);assert.equal(JSON.parse(env.window.localStorage.getItem(KEY)).groupSeries,false);
});
test('compact header owns count and actions; scope shares search, sort Escape leaves query intact',async t=>{
  const {env,panel}=await setup(t);
  assert.ok(panel.querySelector('.mo-head .mo-summary'));
  assert.ok(panel.querySelector('.mo-head [data-act="manage"]'));
  assert.ok(panel.querySelector('.mo-search-wrap [data-scope="all"]'));
  assert.equal(panel.querySelector('.mo-toolbar'),null);
  type(env,panel.querySelector('.mo-search'),'deepseek');
  panel.querySelector('[data-act="sort-menu"]').click();
  panel.querySelector('[data-order="name"]').dispatchEvent(new env.window.KeyboardEvent('keydown',{key:'Escape',bubbles:true,cancelable:true}));
  assert.equal(panel.querySelector('.mo-sort-menu').hidden,true);
  assert.equal(panel.querySelector('.mo-search').value,'deepseek');
  assert.equal(panel.hidden,false);
});
test('assembled menu has a stable credential-free grouped-search semantic snapshot',async t=>{
  const {env,panel}=await setup(t);type(env,panel.querySelector('.mo-search'),'deepseek');panel.querySelector('[data-scope="all"]').click();
  assert.equal(panel.querySelector('.mo-series-heading'),null,'a single matching family does not repeat a heading under every provider');
  const actual={summary:panel.querySelector('.mo-summary').textContent,providers:[...panel.querySelectorAll('.mo-result-provider')].map(group=>({name:group.getAttribute('aria-label'),models:[...group.querySelectorAll('.mo-row-name')].map(x=>x.textContent)}))};
  assert.deepEqual(actual,JSON.parse(readFileSync(new URL('./snapshots/grouped-search.json',import.meta.url),'utf8')));
});
