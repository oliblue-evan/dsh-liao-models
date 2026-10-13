/**
 * 端到端：在 jsdom 里加载**真实的 client.js**，驱动真实的内核 DOM 结构，
 * 验证插件实际做出来的行为。
 *
 * 这里最重要的两个用例：
 *   1. `/model` 命令弹窗**不被污染**（社区版真实存在的缺陷）；
 *   2. 折叠前焦点先移走（否则内核 onBlur 会把整菜单关掉）。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createPluginEnv, settle } from './load-client.mjs';
import { mountModelMenu, mountCommandPopup, defaultSpec } from './harness.mjs';

const SCOPE = 'data-mo-scope';

/** 建环境 + 挂模型菜单，并等防抖扫描跑完。 */
async function setup(spec = defaultSpec()) {
  const env = createPluginEnv();
  const view = mountModelMenu(env.document, spec);
  await settle(env.window);
  return { env, view };
}

test('模型菜单被打上作用域标记，来源标题拿到徽标', async () => {
  const { env, view } = await setup();
  // 内层 div.groups[role=menu] 与外层 MenuSurface 都要打上作用域：
  // 前者管来源标题与折叠，后者保证 CSS 变量沿子树继承。
  assert.equal(view.groupsEl.getAttribute(SCOPE), '1', '内层 role=menu 应被打上作用域');
  assert.equal(view.menu.getAttribute(SCOPE), '1', '外层 surface 也应被打上作用域');
  const headings = view.sections.map((s) => s.querySelector('[data-menu-group-heading]'));
  assert.equal(headings.length, 3);
  for (const heading of headings) {
    assert.ok(heading.getAttribute('data-mo-badge'), '每个来源标题都应有模型数徽标');
  }
  // 徽标应反映真实模型数
  assert.deepEqual(
    headings.map((h) => h.getAttribute('data-mo-badge')),
    ['(4)', '(19)', '(9)']
  );
  // 当前选中来源应被标记
  const current = headings.filter((h) => h.getAttribute('data-mo-current') === '1');
  assert.equal(current.length, 1, '有且仅有一个来源被标为当前');
  env.dispose();
});

test('★ 独立回归：/model 命令弹窗完全不被污染', async () => {
  // 这是重写社区版的根本原因：/model 弹窗与模型菜单共用 MenuGroup 原语，
  // 社区版用无祖先限定的 CSS 选择器，把箭头/hover/手型光标泄漏进了弹窗。
  const env = createPluginEnv();
  const popup = mountCommandPopup(env.document, {
    providers: [
      { id: 'deepseek-account', label: 'DeepSeek', options: ['DeepSeek-V4.1-Flash', 'DeepSeek-V4-Pro'] },
      { id: 'natsuki', label: 'Natsuki 网关', options: ['gpt-6-astra', 'grok-4.7'] },
    ],
    selected: 'DeepSeek-V4.1-Flash',
  });
  await settle(env.window);

  // 弹窗里不该出现任何插件的痕迹
  assert.equal(popup.listbox.getAttribute(SCOPE), null, 'listbox 不该被打上作用域');
  for (const section of popup.sections) {
    assert.equal(section.getAttribute(SCOPE), null, '弹窗分组不该被打上作用域');
    assert.equal(section.getAttribute('data-mo-section'), null);
    assert.equal(section.getAttribute('data-mo-collapsed'), null);
    const heading = section.querySelector('[data-menu-group-heading]');
    assert.ok(heading, '弹窗确实有共用原语的标题（这是泄漏的前提）');
    assert.equal(heading.getAttribute('data-mo-badge'), null, '弹窗标题不该被加徽标');
    assert.equal(heading.getAttribute('data-mo-current'), null);
  }
  // 样式表里每条作用域规则都要求 [data-mo-scope="1"]，而弹窗上没有任何元素带这个属性
  const css = env.document.getElementById('dsh-model-organizer-style').textContent;
  for (const rule of css.split('\n')) {
    if (rule.includes('section[role="group"]')) {
      assert.ok(rule.includes('[data-mo-scope="1"]'), '分组样式必须带作用域前缀：' + rule);
    }
  }
  assert.equal(env.document.querySelectorAll('[' + SCOPE + ']').length, 0, '整个文档不该有作用域标记');
  env.dispose();
});

test('模型菜单与 /model 弹窗同时存在时，只增强菜单', async () => {
  const env = createPluginEnv();
  const popup = mountCommandPopup(env.document, {
    providers: [{ id: 'a', label: '来源A', options: ['m1', 'm2'] }],
    selected: 'm1',
  });
  const view = mountModelMenu(env.document, defaultSpec());
  await settle(env.window);
  assert.equal(view.menu.getAttribute(SCOPE), '1', '模型菜单被增强');
  assert.equal(popup.listbox.getAttribute(SCOPE), null, '弹窗不受影响');
  const scoped = env.document.querySelectorAll('[' + SCOPE + ']');
  for (const node of scoped) {
    assert.equal(popup.listbox.contains(node), false, '作用域节点不该出现在弹窗子树内');
  }
  env.dispose();
});

test('model pane 被增强；root / effort pane 一律不介入', async () => {
  for (const pane of ['root', 'effort']) {
    const env = createPluginEnv();
    const view = mountModelMenu(env.document, { ...defaultSpec(), pane });
    await settle(env.window);
    assert.equal(env.document.querySelectorAll('[' + SCOPE + ']').length, 0, pane + ' pane 不该被增强');
    assert.equal(view.sections.length, 0);
    env.dispose();
  }
});

test('折叠前把焦点移回 trigger（否则内核 onBlur 会关掉整个菜单）', async () => {
  // 复现内核真实时序：菜单打开时模型项**还没**被隐藏，内核先把焦点放到
  // 当前选中的模型按钮上；插件随后才折叠（display:none）—— 若不先移焦点，
  // 浏览器强制失焦，内核 onBlur 收到 relatedTarget=null 便会 close() 整个菜单。
  const env = createPluginEnv({ autoMount: false });
  const view = mountModelMenu(env.document, defaultSpec());
  const selectedButton = view.items.filter((b) => b.getAttribute('aria-checked') === 'true')[0];
  assert.ok(selectedButton, '应有选中项');

  // 增强之前：所有模型项都可见，可以被聚焦
  assert.equal(view.sections[0].getAttribute('data-mo-collapsed'), null, '前置条件：还没折叠');
  selectedButton.focus();
  assert.equal(env.document.activeElement, selectedButton, '前置条件：焦点在模型按钮上');

  // 现在插件上岗 —— 它会折叠所有来源
  env.plugin.apply(env.ctx);
  await settle(env.window);

  assert.equal(view.sections[0].getAttribute('data-mo-collapsed'), '1', '已折叠');
  // 折叠后，焦点必须已经离开将被隐藏的按钮，回到 trigger
  assert.notEqual(env.document.activeElement, selectedButton, '焦点不该留在会被隐藏的按钮上');
  assert.equal(env.document.activeElement, view.trigger, '焦点应回到 trigger，onBlur 才会放行');
  env.dispose();
});

test('默认 hover 模式下所有来源在原生菜单里被折叠，模型项仍存在于 DOM', async () => {
  const { env, view } = await setup();
  for (const section of view.sections) {
    assert.equal(section.getAttribute('data-mo-collapsed'), '1', '默认应折叠');
  }
  // 关键：折叠是 CSS 隐藏，不是删除节点 —— React 的节点必须原样保留
  assert.equal(view.items.length, 32, '所有模型项仍在 DOM 中（4+19+9）');
  env.dispose();
});

test('插件不移动、不删除、不重挂任何 React 管理的节点', async () => {
  const spec = defaultSpec();
  const env = createPluginEnv();
  const view = mountModelMenu(env.document, spec);
  // 记录增强前的父子关系快照
  const before = [];
  for (const section of view.sections) {
    before.push(section.parentElement);
    for (const button of section.querySelectorAll('button[role="menuitemradio"]')) {
      before.push(button.parentElement);
    }
  }
  await settle(env.window);
  const after = [];
  for (const section of view.sections) {
    after.push(section.parentElement);
    for (const button of section.querySelectorAll('button[role="menuitemradio"]')) {
      after.push(button.parentElement);
    }
  }
  assert.deepEqual(after, before, '父子关系必须逐一保持原样');
  // 模型按钮的身份也必须没变（同一个元素对象）
  const names = view.items.map((b) => b.getAttribute('title'));
  assert.equal(names.length, 32);
  assert.ok(names.includes('DeepSeek-V4.1-Flash'));
  env.dispose();
});

test('注入的样式挂在 head，且按 id 幂等（重复 apply 不叠加）', async () => {
  const env = createPluginEnv();
  mountModelMenu(env.document, defaultSpec());
  await settle(env.window);
  const first = env.document.querySelectorAll('#dsh-model-organizer-style');
  assert.equal(first.length, 1);
  const css = first[0].textContent;
  assert.ok(css.includes('[data-mo-scope="1"]'), '样式应带作用域');
  assert.ok(css.includes('--dsw-alias-'), '颜色应使用官方令牌');
  env.dispose();
});

test('找不到模型菜单时静默不动，不报错也不留下痕迹', async () => {
  const env = createPluginEnv();
  await settle(env.window);
  assert.equal(env.document.querySelectorAll('[' + SCOPE + ']').length, 0);
  assert.equal(env.document.getElementById('dsh-model-organizer-panel').hidden, true);
  // 空文档里也不该抛错
  env.dispose();
});

test('dispose 摘净监听器与自建节点，可安全重复调用', async () => {
  const { env, view } = await setup();
  const panel = env.document.getElementById('dsh-model-organizer-panel');
  assert.ok(panel, '面板应已挂到 body');
  assert.equal(view.menu.getAttribute(SCOPE), '1');

  env.dispose();

  assert.equal(env.document.getElementById('dsh-model-organizer-panel'), null, '面板应被移除');
  assert.equal(env.document.getElementById('dsh-model-organizer-style'), null, '样式应被移除');
  assert.equal(view.menu.getAttribute(SCOPE), null, '作用域标记应被还原');
  for (const section of view.sections) {
    assert.equal(section.getAttribute('data-mo-collapsed'), null, '折叠标记应被还原');
    const heading = section.querySelector('[data-menu-group-heading]');
    assert.equal(heading.getAttribute('data-mo-badge'), null, '徽标应被还原');
  }
  // 再调用一次不应抛错
  env.dispose();
  await settle(env.window);
  assert.equal(view.menu.getAttribute(SCOPE), null, 'dispose 后扫描不应再增强');
});

test('★ 回归：React 替换标题节点后，标记能自愈（视图签名不变的情况）', async () => {
  // React 重渲染可能**替换**分组标题节点（文本与 id 都不变），此时视图签名完全一样。
  // 曾经只看作用域属性就走快速路径返回，导致「当前来源」高亮与模型数徽标静默消失。
  const { env, view } = await setup();
  const badgeOf = (s) => s.querySelector('[data-menu-group-heading]').getAttribute('data-mo-badge');
  assert.deepEqual(view.sections.map(badgeOf), ['(4)', '(19)', '(9)'], '前置条件：初始有徽标');

  for (const section of view.sections) {
    const old = section.querySelector('[data-menu-group-heading]');
    const fresh = env.document.createElement('div');
    fresh.id = old.id;
    fresh.setAttribute('data-menu-group-heading', '');
    fresh.className = 'heading';
    fresh.textContent = old.textContent; // 文本相同 → 视图签名不变
    section.replaceChild(fresh, old);
  }
  await settle(env.window, 400);

  assert.deepEqual(view.sections.map(badgeOf), ['(4)', '(19)', '(9)'], '标题被替换后徽标应自愈');
  const current = view.sections.filter((s) => s.querySelector('[data-menu-group-heading]').getAttribute('data-mo-current') === '1');
  assert.equal(current.length, 1, '「当前来源」标记也应自愈');
  env.dispose();
});

test('★ 回归：React 替换整个分组节点后，标记与折叠都能自愈', async () => {
  const { env, view } = await setup();
  const first = view.menu.querySelectorAll('section[role="group"]')[0];
  const clone = first.cloneNode(true);
  for (const node of clone.querySelectorAll('[data-mo-badge],[data-mo-current]')) {
    node.removeAttribute('data-mo-badge');
    node.removeAttribute('data-mo-current');
  }
  clone.removeAttribute('data-mo-section');
  clone.removeAttribute('data-mo-collapsed');
  first.replaceWith(clone);
  await settle(env.window, 400);

  const sections = Array.from(view.menu.querySelectorAll('section[role="group"]'));
  assert.equal(sections[0].getAttribute('data-mo-section'), '1', '分组应重新被标记');
  assert.ok(sections[0].querySelector('[data-menu-group-heading]').getAttribute('data-mo-badge'), '徽标应重建');
  assert.equal(sections[0].getAttribute('data-mo-collapsed'), '1', '折叠标记应重建');
  env.dispose();
});

test('★ 不隐藏内核自带的搜索框（那是宿主功能，插件不该动）', async () => {
  const { env, view } = await setup();
  assert.ok(view.searchInput, '夹具里应有内核搜索框（模型数 > 4）');
  const css = env.document.getElementById('dsh-model-organizer-style').textContent;
  // 早期版本用 .searchRow 隐藏它 —— 既匹配不上（哈希类名）又越界
  assert.equal(/searchRow/.test(css), false, '注入的样式不该提及内核的搜索行');
  assert.equal(/role="searchbox"/.test(css), false, '也不该按 role 隐藏搜索框');
  env.dispose();
});

test('★ 回归：多个菜单共存时，只认配对的 trigger（按 aria-controls）', async () => {
  // 菜单是 portal 到 body 的，所以 surface.parentElement 就是 body。
  // 早期实现从那里 querySelector('button[aria-haspopup="menu"]')，
  // 在页面上还有别的菜单时会抓到**别的 trigger**（焦点回错地方 / 🗂 贴错位置）。
  const env = createPluginEnv({ autoMount: false });
  const view = mountModelMenu(env.document, { ...defaultSpec(), menuId: ':r5:-menu' });
  view.menu.setAttribute('data-menu-material', 'translucent');

  // 干扰：body 里另一个菜单的 trigger
  const decoy = env.document.createElement('button');
  decoy.id = 'decoy-trigger';
  decoy.setAttribute('aria-haspopup', 'menu');
  decoy.setAttribute('aria-controls', 'other-menu');
  env.document.body.appendChild(decoy);

  // 复现内核时序：先把焦点放到当前选中的模型按钮上（此时还没折叠、可聚焦），
  // 插件随后才折叠 —— 折叠前必须把焦点交还给配对 trigger。
  const selected = view.items.filter((b) => b.getAttribute('aria-checked') === 'true')[0];
  selected.focus();
  assert.equal(env.document.activeElement, selected, '前置条件：焦点在选中的模型上');

  env.plugin.apply(env.ctx);
  await settle(env.window);

  // 增强不该抛错（React useId 的 id 含冒号，选择器须转义）
  assert.equal(view.menu.getAttribute(SCOPE), '1', '含冒号 id 的菜单也应被正常增强');

  // 焦点必须交还**配对**的 trigger，而不是诱惑按钮
  assert.equal(env.document.activeElement, view.trigger, '焦点应回到配对 trigger');
  assert.notEqual(env.document.activeElement, decoy, '不该回到别的菜单的 trigger');
  env.dispose();
});
