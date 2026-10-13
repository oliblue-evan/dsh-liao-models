import test from 'node:test';
import assert from 'node:assert/strict';
import { createPluginEnv, settle } from './load-client.mjs';
import { mountModelMenu, defaultSpec, openPanelViaHeading } from './harness.mjs';
import { attachKernelBehavior, realClick } from './kernel-behavior.mjs';

const keyOf = (provider, model) => JSON.stringify([provider, model]);
const stateOf = (env) => JSON.parse(env.window.localStorage.getItem('dsh-model-organizer-state-v1'));
const input = (env, node, value) => {
  node.value = value;
  node.dispatchEvent(new env.window.Event('input', { bubbles: true }));
};
const key = (env, node, name, options = {}) => node.dispatchEvent(new env.window.KeyboardEvent('keydown', { key: name, bubbles: true, cancelable: true, ...options }));
async function setup() {
  const env = createPluginEnv();
  const view = mountModelMenu(env.document, defaultSpec());
  await settle(env.window);
  const panel = openPanelViaHeading(env, view);
  return { env, view, panel };
}

test('浏览列表直接置顶：星标与模型按钮并列，不触发选择或关闭', async (t) => {
  const { env, view, panel } = await setup();
  t.after(() => env.dispose());
  const kernel = attachKernelBehavior(env.document, view);
  t.after(() => kernel.detach());
  let chosen = 0;
  view.items.forEach((node) => node.addEventListener('click', () => chosen++));
  assert.equal(panel.querySelector('button button'), null, '不得嵌套交互按钮');
  const star = panel.querySelector('[data-act="fav"]');
  realClick(env.window, star);
  assert.equal(chosen, 0);
  assert.equal(kernel.isOpen(), true);
  assert.equal(panel.hidden, false);
  assert.deepEqual(stateOf(env).favorites, [keyOf('DeepSeek', 'DeepSeek-V4.1-Flash')]);
  assert.equal(panel.querySelector('[data-act="fav"]').getAttribute('aria-pressed'), 'true');
});

test('悬浮后真实点击来源标题仍保持面板，不让非交互标题夺走内核焦点', async (t) => {
  const { env, view, panel } = await setup();
  t.after(() => env.dispose());
  const kernel = attachKernelBehavior(env.document, view);
  t.after(() => kernel.detach());
  view.trigger.focus();
  const heading = view.sections[0].querySelector('[data-menu-group-heading]');
  realClick(env.window, heading);
  await settle(env.window, 300);
  assert.equal(panel.hidden, false);
  assert.equal(kernel.isOpen(), true);
  assert.equal(env.document.activeElement, view.trigger);
});

test('整理默认限定当前来源，搜索含隐藏模型；全部来源入口扩大范围', async (t) => {
  const { env, panel } = await setup();
  t.after(() => env.dispose());
  panel.querySelector('[data-act="manage"]').click();
  assert.equal(panel.querySelectorAll('[data-act="alias"]').length, 4);
  assert.ok(Array.from(panel.querySelectorAll('[data-act="choose"]')).every((row) => JSON.parse(row.dataset.key)[0] === 'DeepSeek'));
  panel.querySelector('[data-act="hide"]').click();
  input(env, panel.querySelector('.mo-search'), 'DeepSeek-V4.1-Flash');
  assert.ok(panel.querySelector('[data-act="unhide"]'), '搜索应允许找到隐藏项并恢复');
  panel.querySelector('[data-act="unhide"]').click();
  assert.deepEqual(stateOf(env).hidden, []);
  panel.querySelector('[data-act="clear-search"]').click();
  panel.querySelector('[data-act="manage-all"]').click();
  assert.equal(panel.querySelectorAll('[data-act="alias"]').length, 32);
  assert.equal(panel.querySelector('[data-act="manage-all"]').hidden, true);
});

test('厂商内搜索不重复来源，清空搜索和 Escape 保持面板与输入焦点', async (t) => {
  const { env, view, panel } = await setup();
  t.after(() => env.dispose());
  openPanelViaHeading(env, view, 1);
  const kernel = attachKernelBehavior(env.document, view);
  t.after(() => kernel.detach());
  const search = panel.querySelector('.mo-search');
  search.focus();
  input(env, search, 'grok');
  assert.equal(panel.querySelector('.mo-row-sub'), null);
  key(env, search, 'Escape');
  assert.equal(search.value, '');
  assert.equal(env.document.activeElement, search);
  assert.equal(panel.hidden, false);
  assert.equal(kernel.isOpen(), true);
  input(env, search, '不存在');
  panel.querySelector('[data-act="clear-search"]').click();
  assert.equal(search.value, '');
  assert.equal(env.document.activeElement, search);
});

test('键盘搜索跳过不可用模型，方向键导航后回车交给原生按钮', async (t) => {
  const { env, view, panel } = await setup();
  t.after(() => env.dispose());
  view.items[0].disabled = true;
  const search = panel.querySelector('.mo-search');
  search.focus();
  input(env, search, 'DeepSeek');
  let clicked = null;
  view.items.forEach((node) => node.addEventListener('click', () => { clicked = node.title; }));
  key(env, search, 'ArrowDown');
  const row = env.document.activeElement;
  assert.equal(row.dataset.act, 'choose');
  assert.notEqual(row.dataset.disabled, '1');
  key(env, row, 'ArrowUp');
  assert.equal(env.document.activeElement, search);
  key(env, search, 'Enter');
  assert.ok(clicked);
  assert.notEqual(clicked, view.items[0].title);
  assert.equal(panel.hidden, true);
});

test('中文输入法组合期间的回车不会选择模型', async (t) => {
  const { env, view, panel } = await setup();
  t.after(() => env.dispose());
  const search = panel.querySelector('.mo-search');
  input(env, search, 'DeepSeek');
  let clicked = false;
  view.items.forEach((node) => node.addEventListener('click', () => { clicked = true; }));
  key(env, search, 'Enter', { isComposing: true });
  assert.equal(clicked, false);
  assert.equal(panel.hidden, false);
});

test('置顶不让长列表跳回顶部，键盘焦点回到同一颗星', async (t) => {
  const { env, panel } = await setup();
  t.after(() => env.dispose());
  const list = panel.querySelector('.mo-list');
  list.scrollTop = 180;
  const star = panel.querySelectorAll('[data-act="fav"]')[2];
  const modelKey = star.dataset.key;
  star.focus();
  star.click();
  assert.equal(list.scrollTop, 180);
  assert.equal(env.document.activeElement.dataset.key, modelKey);
  assert.equal(env.document.activeElement.dataset.act, 'fav');
});

test('达到置顶上限时给出提示，保留原有置顶', async (t) => {
  const env = createPluginEnv({ autoMount: false });
  t.after(() => env.dispose());
  const existing = Array.from({ length: 12 }, (_, i) => keyOf('old', String(i)));
  env.window.localStorage.setItem('dsh-model-organizer-state-v1', JSON.stringify({ version: 4, favorites: existing }));
  env.plugin.apply(env.ctx);
  const view = mountModelMenu(env.document, defaultSpec());
  await settle(env.window);
  const panel = openPanelViaHeading(env, view);
  panel.querySelector('[data-act="fav"]').click();
  assert.deepEqual(stateOf(env).favorites, existing);
  assert.match(panel.querySelector('.mo-foot').textContent, /最多置顶 12/);
});

test('面板按原生菜单外框定位，避免覆盖菜单内较宽的搜索框', async (t) => {
  const { env, view } = await setup();
  t.after(() => env.dispose());
  view.menu.getBoundingClientRect = () => ({ left: 350, right: 600, top: 40 });
  view.groupsEl.getBoundingClientRect = () => ({ left: 360, right: 480, top: 80 });
  const panel = openPanelViaHeading(env, view, 1);
  assert.equal(panel.style.left, '608px');
  assert.equal(panel.style.top, '40px');
});
