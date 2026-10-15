import test from 'node:test';
import assert from 'node:assert/strict';
import { createPluginEnv, mountSettingsCard, settle } from './load-client.mjs';
const KEY='dsh-model-organizer-state-v1';
async function setup(t){const env=createPluginEnv();const card=mountSettingsCard(env);await settle(env.window,40);for(let n=0;n<40&&!card.container.querySelector('[role="combobox"]');n++)await settle(env.window,10);t.after(()=>{card.unmount();env.dispose();});return{env,card,root:card.container};}
const combo=(root,label)=>[...root.querySelectorAll('[role="combobox"]')].find(n=>n.getAttribute('aria-label')===label);
const menu=(env,trigger)=>env.document.getElementById(trigger.getAttribute('aria-controls'));
const key=(env,node,key)=>node.dispatchEvent(new env.window.KeyboardEvent('keydown',{key,bubbles:true,cancelable:true}));
test('compact controls use segments or switches; remaining dropdowns are owned and return focus',async t=>{
 const {env,root}=await setup(t);assert.equal(root.querySelector('select'),null);assert.equal(root.querySelectorAll('[role="combobox"]').length,2);
 assert.ok(root.querySelector('[data-setting="density"]'));assert.ok(root.querySelector('[aria-label="记住搜索与位置"][role="switch"]'));
 const sort=combo(root,'模型排序');sort.focus();sort.click();await settle(env.window,10);
 const list=menu(env,sort);assert.ok(list);assert.equal(root.contains(list),false);assert.equal(list.closest('[data-plugin]').dataset.plugin,'dsh-model-organizer');
 assert.equal(list.querySelector('[aria-selected="true"]').dataset.value,'default');list.querySelector('[data-value="name"]').click();await settle(env.window,10);
 assert.equal(sort.dataset.value,'name');assert.equal(JSON.parse(env.window.localStorage.getItem(KEY)).sortOrder,'name');assert.equal(env.document.activeElement,sort);assert.equal(env.document.querySelector('[role="listbox"]'),null);
});
test('keyboard navigation previews without saving; Escape cancels; Home/End and Enter commit',async t=>{
 const {env,root}=await setup(t);const sort=combo(root,'模型排序');sort.focus();key(env,sort,'ArrowDown');await settle(env.window,10);
 key(env,sort,'End');await settle(env.window,10);assert.equal(sort.dataset.value,'default');assert.equal(menu(env,sort).querySelector('[data-active="true"]').dataset.value,'price-desc');
 key(env,sort,'Escape');await settle(env.window,10);assert.equal(sort.dataset.value,'default');assert.equal(sort.getAttribute('aria-expanded'),'false');
 key(env,sort,' ');await settle(env.window,10);key(env,sort,'End');await settle(env.window,10);key(env,sort,'Enter');await settle(env.window,10);assert.equal(sort.dataset.value,'price-desc');
 sort.click();await settle(env.window,10);key(env,sort,'Home');await settle(env.window,10);key(env,sort,'Enter');await settle(env.window,10);assert.equal(sort.dataset.value,'default');
 sort.click();await settle(env.window,10);key(env,sort,'Tab');await settle(env.window,10);assert.equal(sort.getAttribute('aria-expanded'),'false');
});
test('only one menu opens; outside pointer or focus closes without overwriting settings',async t=>{
 const {env,root}=await setup(t);const sort=combo(root,'模型排序'),series=combo(root,'系列初始状态');series.closest('details').open=true;sort.click();await settle(env.window,10);series.click();await settle(env.window,10);
 assert.equal(env.document.querySelectorAll('[role="listbox"]').length,1);assert.equal(sort.getAttribute('aria-expanded'),'false');assert.ok(menu(env,series));
 env.document.body.dispatchEvent(new env.window.Event('pointerdown',{bubbles:true}));await settle(env.window,10);assert.equal(series.getAttribute('aria-expanded'),'false');
 sort.click();await settle(env.window,10);series.focus();await settle(env.window,10);assert.equal(sort.getAttribute('aria-expanded'),'false');assert.equal(sort.dataset.value,'default');
});
test('popup flips upward near bottom, clamps right edge and updates on resize',async t=>{
 const {env,root}=await setup(t);const sort=combo(root,'模型排序');Object.defineProperty(env.window,'innerWidth',{configurable:true,value:500});Object.defineProperty(env.window,'innerHeight',{configurable:true,value:600});
 sort.getBoundingClientRect=()=>({left:430,right:730,top:550,bottom:584,width:300,height:34});sort.click();await settle(env.window,10);
 let portal=menu(env,sort).parentElement;assert.equal(portal.dataset.placement,'above');assert.equal(portal.style.left,'192px');assert.equal(portal.style.width,'300px');assert.ok(parseFloat(portal.style.top)<550);
 sort.getBoundingClientRect=()=>({left:20,right:300,top:40,bottom:74,width:280,height:34});env.window.dispatchEvent(new env.window.Event('resize'));await settle(env.window,10);portal=menu(env,sort).parentElement;assert.equal(portal.dataset.placement,'below');assert.equal(portal.style.top,'80px');
});
test('disabled settings cannot open; disclosure close and unmount remove portals',async t=>{
 const {env,card,root}=await setup(t);root.querySelector('[aria-label="按模型系列分组"][role="switch"]').click();await settle(env.window,10);const series=combo(root,'系列初始状态');series.closest('details').open=true;assert.equal(series.disabled,true);series.click();await settle(env.window,10);assert.equal(series.getAttribute('aria-expanded'),'false');
 root.querySelector('[aria-label="按模型系列分组"][role="switch"]').click();await settle(env.window,10);series.click();await settle(env.window,10);assert.ok(menu(env,series));series.closest('details').open=false;await settle(env.window,10);assert.equal(series.getAttribute('aria-expanded'),'false');
 const sort=combo(root,'模型排序');sort.click();await settle(env.window,10);assert.ok(menu(env,sort));card.unmount();assert.equal(env.document.querySelector('.mo-select-portal'),null);env.window.dispatchEvent(new env.window.Event('resize'));env.document.body.dispatchEvent(new env.window.Event('pointerdown',{bubbles:true}));
});
