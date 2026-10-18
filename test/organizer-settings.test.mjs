/**
 * 设置卡（React 组件，注册进 plugins.bundle.config）的行为测试。
 *
 * 覆盖三件事：
 *   1. 注册契约 —— 槽位名、key（必须是包名）、locale 命名空间；
 *   2. 每个控件都能改到 localStorage 里的偏好；
 *   3. **跨世界同步** —— 设置页改了，DOM 增强侧（模型菜单）要立刻跟上；
 *      反向（菜单里点置顶）设置页也要刷新。这是本插件唯一的双世界架构，
 *      最容易出「设置改了但界面没反应」的 bug。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createPluginEnv, mountSettingsCard, settle } from './load-client.mjs';
import { mountModelMenu, defaultSpec, openPanelViaHeading } from './harness.mjs';

const KEY = 'dsh-liao-models-state-v1';
const SLOT = 'plugins.bundle.config|dsh-liao-models';

const stateOf = (env) => JSON.parse(env.window.localStorage.getItem(KEY));
const panelOf = (env) => env.document.getElementById('dsh-liao-models-panel');
const panel = (env) => env.document.getElementById('dsh-liao-models-panel');

/** 渲染设置卡并等 React 把 effects 跑完。 */
async function renderCard(env, props) {
  const card = mountSettingsCard(env, props);
  await settle(env.window, 50);
  return card;
}

/** 按可见文本找按钮。 */
function buttonByText(container, text) {
  return Array.from(container.querySelectorAll('button')).filter((b) => b.textContent === text || b.getAttribute('aria-label') === text)[0];
}

test('★ 注册契约：槽位名/key/locale 都必须是官方约定', async () => {
  const env = createPluginEnv();
  const entry = env.registrations.get(SLOT);
  assert.ok(entry, '设置卡应注册进 plugins.bundle.config');
  assert.equal(entry.spec.name, 'plugins.bundle.config');
  // key 必须是 **npm 包名**（槽位契约：以 bundle 的包名为键）
  assert.equal(entry.spec.key, 'dsh-liao-models');
  assert.equal(entry.spec.locale, 'model-organizer', '应声明 locale 命名空间');
  assert.equal(typeof entry.Component, 'function');
  env.dispose();
});

test('★ 插件声明 inject slots/locale（否则拿不到槽位）', () => {
  const env = createPluginEnv({ autoMount: false });
  assert.deepEqual(env.plugin.inject, ['slots', 'locale']);
  env.dispose();
});

test('设置卡只在 view=page 时渲染（槽位契约）', async () => {
  const env = createPluginEnv();
  const card = await renderCard(env, { view: 'row' });
  assert.equal(card.container.textContent, '', '非 page 视图不该渲染任何内容');
  card.unmount();
  const card2 = await renderCard(env, { view: 'page' });
  assert.ok(card2.container.textContent.length > 0, 'page 视图应有内容');
  card2.unmount();
  env.dispose();
});

test('★ 字号设置：只作用于插件面板，不污染宿主', async () => {
  const env = createPluginEnv();
  mountModelMenu(env.document, defaultSpec());
  await settle(env.window);
  const card = await renderCard(env);

  buttonByText(card.container, '14').click();
  await settle(env.window, 300);

  assert.equal(stateOf(env).fontSize, 14, '字号应持久化');
  const panel = panelOf(env);
  assert.equal(panel.style.getPropertyValue('--mo-fs'), '14px', '字号应落到面板元素上');
  // 关键：不能写到 documentElement（那会影响宿主界面 = 越界）
  assert.equal(
    env.document.documentElement.style.getPropertyValue('--mo-fs'),
    '',
    '★ 不得把字号写到 documentElement（越界影响宿主）'
  );
  card.unmount();
  env.dispose();
});


test('★ 清空偏好：删用户数据但保留设置', async () => {
  const env = createPluginEnv();
  const view = mountModelMenu(env.document, defaultSpec());
  await settle(env.window);

  // 先造出用户数据：置顶 + 隐藏 + 别名
  openPanelViaHeading(env, view);
  panelOf(env).querySelector('[data-act="manage"]').click();
  const fav = Array.from(panelOf(env).querySelectorAll('[data-act="fav"]'))[0];
  fav.click();
  const hide = Array.from(panelOf(env).querySelectorAll('[data-act="hide"]'))[0];
  if (hide) hide.click();
  await settle(env.window, 200);
  const before = stateOf(env);
  assert.ok(before.favorites.length + before.hidden.length > 0, '前置条件：应有用户数据');

  const card = await renderCard(env);
  // 宿主禁用 confirm 时仍必须经过页内确认，不能直接删除。
  env.window.confirm = () => { throw new Error('host confirm unavailable'); };
  const resetBtn = buttonByText(card.container, '清空');
  assert.ok(resetBtn, '应有清空按钮');
  resetBtn.click();
  await settle(env.window, 50);
  assert.deepEqual(stateOf(env), before, '打开确认区不能修改偏好');
  assert.equal(env.document.activeElement.textContent, '取消', '焦点先落在安全的取消操作');
  buttonByText(card.container, '确认清空').click();
  await settle(env.window, 300);

  const after = stateOf(env);
  assert.deepEqual(after.favorites, [], '置顶应清空');
  assert.deepEqual(after.hidden, [], '隐藏应清空');
  assert.deepEqual(after.recents, [], '最近应清空');
  assert.deepEqual(after.aliases, {}, '别名应清空');
  // 设置项必须保留
  assert.equal(after.mode, before.mode, '★ 模式（设置）不该被清掉');
  assert.equal(after.fontSize, before.fontSize, '★ 字号设置不该被清掉');
  buttonByText(card.container, '14').click();
  await settle(env.window, 50);
  buttonByText(card.container, '撤销清空').click();
  await settle(env.window, 100);
  const restored = stateOf(env);
  for (const key of ['favorites', 'hidden', 'recents', 'aliases']) assert.deepEqual(restored[key], before[key]);
  assert.equal(restored.fontSize, 14, '撤销只恢复记录，保留新字号');
  assert.ok(card.container.querySelector('[role="status"]').textContent.includes('已恢复'));
  card.unmount();
  env.dispose();
});

test('清空可被确认框取消（不误删数据）', async () => {
  const env = createPluginEnv();
  const view = mountModelMenu(env.document, defaultSpec());
  await settle(env.window);
  openPanelViaHeading(env, view);
  panelOf(env).querySelector('[data-act="manage"]').click();
  Array.from(panelOf(env).querySelectorAll('[data-act="fav"]'))[0].click();
  const before = stateOf(env);
  assert.ok(before.favorites.length > 0);

  const card = await renderCard(env);
  buttonByText(card.container, '清空').click();
  await settle(env.window, 50);
  buttonByText(card.container, '取消').click();
  await settle(env.window, 300);
  assert.deepEqual(stateOf(env).favorites, before.favorites, '取消后数据应原封不动');
  assert.equal(buttonByText(card.container, '确认清空'), undefined);
  card.unmount();
  env.dispose();
});

test('★ 反向同步：菜单里点置顶 → 设置页不报错且读到最新数据', async () => {
  const env = createPluginEnv();
  const view = mountModelMenu(env.document, defaultSpec());
  await settle(env.window);
  const card = await renderCard(env);

  // DOM 侧写偏好（用户点置顶）
  openPanelViaHeading(env, view);
  panelOf(env).querySelector('[data-act="manage"]').click();
  Array.from(panelOf(env).querySelectorAll('[data-act="fav"]'))[0].click();
  await settle(env.window, 300);

  assert.ok(stateOf(env).favorites.length > 0, '置顶应写入');
  // 设置页仍应正常渲染（订阅刷新不抛错）
  assert.ok(card.container.textContent.includes('浮框字号'), '设置页应保持可用');
  assert.equal(card.container.querySelector('.mo-stat strong').textContent, String(stateOf(env).favorites.length));
  card.unmount();
  env.dispose();
});

test('词典：zh/en 键集一致，且组件在缺 t 时兜底中文', async () => {
  const env = createPluginEnv();
  // 不带 t 渲染 → 兜底中文
  const card = await renderCard(env, { view: 'page' });
  assert.ok(card.container.textContent.includes('浮框字号'), '缺词典时应兜底中文');
  card.unmount();
  // 带 t 渲染 → 用宿主取词
  const card2 = await renderCard(env, {
    view: 'page',
    t: (key) => 'EN:' + key,
  });
  assert.ok(card2.container.textContent.includes('EN:settings.fontSize'), '应优先用槽位传入的 t');
  card2.unmount();
  env.dispose();
});

test('dispose 后设置卡订阅不再刷新（不泄漏）', async () => {
  const env = createPluginEnv();
  mountModelMenu(env.document, defaultSpec());
  await settle(env.window);
  const card = await renderCard(env);
  card.unmount();
  // 卸载后改偏好不应抛错
  assert.doesNotThrow(() => {
    env.window.localStorage.setItem(KEY, JSON.stringify({ version: 3, mode: 'panel' }));
    env.window.dispatchEvent(new env.window.Event('storage'));
  });
  env.dispose();
});

test('字号预览标记当前选项；无记录时清空不可用', async () => {
  const env = createPluginEnv();
  const card = await renderCard(env);
  const selected = card.container.querySelector('.mo-options [aria-pressed="true"]');
  assert.equal(selected.getAttribute('aria-label'), '13');
  assert.equal(card.container.querySelector('.mo-preview').style.fontSize, '13px');
  assert.equal(buttonByText(card.container, '清空').disabled, true);
  buttonByText(card.container, '12').click();
  await settle(env.window, 100);
  assert.equal(card.container.querySelector('.mo-preview').style.fontSize, '12px');
  assert.equal(card.container.querySelector('.mo-options [aria-pressed="true"]').getAttribute('aria-label'), '12');
  card.unmount(); env.dispose();
});

test('清空后的新记录使撤销失效，避免覆盖菜单的新选择', async () => {
  const env = createPluginEnv();
  const view = mountModelMenu(env.document, defaultSpec());
  await settle(env.window);
  openPanelViaHeading(env, view);
  panelOf(env).querySelector('[data-act="manage"]').click();
  panelOf(env).querySelector('[data-act="fav"]').click();
  const card = await renderCard(env);
  buttonByText(card.container, '清空').click();
  await settle(env.window, 50);
  // Escape 只取消页内确认，不清空或冒泡关闭宿主。
  const event = new env.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true });
  buttonByText(card.container, '取消').dispatchEvent(event);
  await settle(env.window, 50);
  assert.equal(buttonByText(card.container, '确认清空'), undefined);
  assert.equal(stateOf(env).favorites.length, 1);
  buttonByText(card.container, '清空').click();
  await settle(env.window, 50);
  buttonByText(card.container, '确认清空').click();
  await settle(env.window, 100);
  assert.ok(buttonByText(card.container, '撤销清空'));
  panelOf(env).querySelector('[data-act="fav"]').click();
  await settle(env.window, 150);
  assert.equal(stateOf(env).favorites.length, 1);
  assert.equal(buttonByText(card.container, '撤销清空'), undefined);
  card.unmount(); env.dispose();
});

test('设置槽独立持有样式，旧卡卸载不移除新卡的样式', async () => {
  const env = createPluginEnv();
  const first = await renderCard(env);
  const second = await renderCard(env);
  const style = () => env.document.getElementById('dsh-liao-models-settings-style');
  assert.ok(style().textContent.includes('.mo-settings .mo-hero'));
  first.unmount();
  assert.ok(style(), '旧设置卡清理必须保留新卡样式');
  second.unmount();
  assert.equal(style(), null, '最后一张卡卸载时清理自己的样式');
  env.dispose();
});
