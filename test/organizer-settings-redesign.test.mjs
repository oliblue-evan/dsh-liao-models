import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createPluginEnv, mountSettingsCard, settle, chooseSetting } from './load-client.mjs';
const KEY='dsh-liao-models-state-v1';
const key=JSON.stringify(['id','sample','deepseek-flash']);
const records={favorites:[key],recents:[key],hidden:[],aliases:{[key]:'小闪'},collapsedSeries:['saved-collapse']};
const groups=[{id:'sample',name:'示例渠道',models:[{id:'deepseek-flash',name:'DeepSeek Flash · x0.11'},{id:'deepseek-pro',name:'DeepSeek Pro · x0.51'}]}];
const button=(root,text)=>[...root.querySelectorAll('button')].find(x=>x.textContent===text);
const state=env=>JSON.parse(env.window.localStorage.getItem(KEY));
const change=(env,control,value)=>chooseSetting(env,env.document,control.getAttribute('aria-label'),value);
async function setup(t,{catalog=groups}={}){
 const env=createPluginEnv({autoMount:false});
 env.window.localStorage.setItem(KEY,JSON.stringify({version:6,fontSize:14,groupSeries:false,sortOrder:'price-desc',...records}));
 const listeners=new Set();
 env.ctx.get=name=>name==='modelDirectories'?{catalog:{store:{getSnapshot:()=>({value:{groups:catalog}}),subscribe:cb=>{listeners.add(cb);return()=>listeners.delete(cb);}}}}:null;
 env.plugin.apply(env.ctx);const card=mountSettingsCard(env);await settle(env.window,60);
 t.after(()=>{card.unmount();env.dispose();});return {env,card,root:card.container,listeners};
}
test('unified preview reacts to sorting, grouping and font, while defaults preserve all records',async t=>{
 const {env,root}=await setup(t);const names=()=>[...root.querySelectorAll('.mo-preview-model')].map(x=>x.dataset.key);
 assert.equal(root.querySelectorAll('.mo-preview').length,1);
 assert.deepEqual(names(),['pro','flash']);assert.equal(root.querySelector('.mo-preview').style.fontSize,'14px');
 const select=root.querySelector('[role="combobox"][aria-label="模型排序"]');await change(env,select,'price-asc');await settle(env.window,30);assert.deepEqual(names(),['flash','pro']);
 root.querySelector('[role="switch"]').click();await settle(env.window,30);assert.ok(root.querySelector('.mo-preview-group'));
 assert.equal(root.querySelectorAll('[data-indented="true"]').length,2);
 assert.ok(root.querySelector('.mo-preview-alias').title);assert.equal(root.querySelectorAll('.mo-preview-model').length,2,'alias stays in one model row');
 button(root,'恢复默认').click();await settle(env.window,30);
 const saved=state(env);assert.equal(saved.fontSize,13);assert.equal(saved.groupSeries,true);assert.equal(saved.sortOrder,'default');
 for(const [field,value] of Object.entries(records))assert.deepEqual(saved[field],value);
 assert.equal(root.querySelector('.mo-preview').style.fontSize,'13px');
 assert.ok(root.querySelector('[role="status"]').textContent.includes('模型记录保持不变'));
});
test('record tools and help start collapsed; cancel and undo keep display preferences',async t=>{
 const {env,root}=await setup(t);
 assert.ok([...root.querySelectorAll('details')].every(x=>!x.open));
 const tools=root.querySelector('.mo-data-tools');tools.open=true;button(root,'清空').click();await settle(env.window,30);
 assert.equal(env.document.activeElement.textContent,'取消');button(root,'取消').click();await settle(env.window,30);assert.deepEqual(state(env).aliases,records.aliases);
 button(root,'清空').click();await settle(env.window,30);button(root,'确认清空').click();await settle(env.window,30);
 assert.deepEqual(state(env).collapsedSeries,[]);assert.equal(state(env).sortOrder,'price-desc');
 button(root,'撤销清空').click();await settle(env.window,30);assert.deepEqual(state(env).collapsedSeries,records.collapsedSeries);
});
test('settings opens the existing manager without a composer menu; edits stable IDs and never selects a model',async t=>{
 const {env,root,listeners}=await setup(t);const trigger=button(root,'整理模型');trigger.click();await settle(env.window,40);
 const panel=env.document.getElementById('dsh-liao-models-panel');assert.equal(panel.hidden,false);assert.equal(panel.getAttribute('role'),'dialog');
 assert.equal(panel.querySelector('[data-act="manage-off"]').hidden,false);assert.equal(panel.querySelector('[data-act="manage"]').hidden,true);
 assert.equal(panel.querySelectorAll('[data-act="choose"]').length,2);
 const row=[...panel.querySelectorAll('[data-act="choose"]')].find(x=>x.dataset.key===key);assert.equal(row.dataset.key,key);row.click();
 const input=env.document.activeElement;assert.equal(input.dataset.key,key);input.value='修改后的名字';input.dispatchEvent(new env.window.Event('input',{bubbles:true}));await settle(env.window,40);
 assert.equal(state(env).aliases[key],'修改后的名字');assert.deepEqual(state(env).recents,records.recents);
 panel.querySelector('[data-act="alias-done"]').click();panel.querySelector('[data-act="hide"]').click();await settle(env.window,40);
 panel.querySelector('[data-filter="hidden"]').click();assert.equal(panel.querySelectorAll('[data-act="unhide"]').length,1);panel.querySelector('[data-act="unhide"]').click();assert.deepEqual(state(env).hidden,[]);
 panel.querySelector('[data-act="manage-off"]').click();assert.equal(panel.hidden,true);assert.equal(env.document.activeElement,trigger);
 trigger.click();await settle(env.window,30);assert.equal(panel.hidden,false);
 // A directory refresh rerenders the manager without closing it.
 listeners.forEach(cb=>cb());assert.equal(panel.hidden,false);assert.equal(panel.querySelectorAll('[data-act="choose"]').length,2);
});
test('missing catalog produces a useful message, and leaving settings closes its owned manager',async t=>{
 const first=await setup(t,{catalog:[]});button(first.root,'整理模型').click();await settle(first.env.window,30);
 assert.ok(first.root.querySelector('[role="status"]').textContent.includes('模型目录尚未就绪'));
 assert.equal(first.env.document.getElementById('dsh-liao-models-panel').hidden,true);
 first.card.unmount();first.env.dispose();
 // Use a separate environment after cleanup, like navigating away and returning.
 const env=createPluginEnv({autoMount:false});env.ctx.get=()=>({catalog:{store:{getSnapshot:()=>({value:{groups}}),subscribe:()=>()=>{}}}});env.plugin.apply(env.ctx);
 const card=mountSettingsCard(env);await settle(env.window,40);button(card.container,'整理模型').click();await settle(env.window,30);
 const panel=env.document.getElementById('dsh-liao-models-panel');assert.equal(panel.hidden,false);card.unmount();assert.equal(panel.hidden,true);env.dispose();
});
test('assembled settings semantic snapshot keeps all existing controls and clear boundaries',async t=>{
 const {env,root}=await setup(t);const sorter=root.querySelector('[role="combobox"][aria-label="模型排序"]');sorter.click();await settle(env.window,10);const actual={
 sections:[...root.querySelectorAll('section')].map(x=>x.getAttribute('aria-label')),
 controls:[...root.querySelectorAll('.mo-control-label')].map(x=>x.textContent),
 sortOptions:[...env.document.getElementById(sorter.getAttribute('aria-controls')).querySelectorAll('[role="option"]')].map(x=>x.textContent),
 stats:[...root.querySelectorAll('.mo-stat')].map(x=>x.textContent),
 folded:[...root.querySelectorAll('details>summary')].map(x=>x.textContent),
 };
 assert.deepEqual(actual,JSON.parse(readFileSync(new URL('./snapshots/settings-redesign.json',import.meta.url),'utf8')));
});
test('compact preview follows initial family collapse without changing real model records',async t=>{
 const {env,root}=await setup(t);const toggle=root.querySelector('[aria-label="按模型系列分组"][role="switch"]');toggle.click();await settle(env.window,20);
 await chooseSetting(env,root,'系列初始状态','collapsed');assert.equal(root.querySelectorAll('.mo-preview-model').length,0);
 await chooseSetting(env,root,'系列初始状态','expanded');assert.equal(root.querySelectorAll('.mo-preview-model').length,2);
 for(const [field,value] of Object.entries(records))assert.deepEqual(state(env)[field],value);
});
