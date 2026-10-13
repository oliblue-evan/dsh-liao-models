/**
 * 审计发现（adversarial audit）的回归测试。
 *
 * 这一组全部来自**独立审计**：四个缺陷都能稳定复现，且都是「功能测试不容易发现」
 * 的类型（节点被 React 替换、跨标题的点击时序、定时器比菜单活得久、名字里含分隔符）。
 * 每个用例都先断言过**修复前的错误行为**，所以它们是真正的回归护栏。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createPluginEnv, settle } from './load-client.mjs';
import { mountModelMenu, defaultSpec, openPanelViaHeading } from './harness.mjs';

/** 与插件 modelKey 等价：JSON 数组编码（键格式 v2）。 */
const moKey = (provider, model) => JSON.stringify([provider, model]);

const PANEL = 'dsh-model-organizer-panel';
const KEY = 'dsh-model-organizer-state-v1';

const panelOf = (env) => env.document.getElementById(PANEL);
/** 始终按**当前 DOM** 取模型按钮（不能用旧引用 —— 这正是 BUG1 的前提）。 */
const liveItem = (env, title) =>
  Array.from(env.document.querySelectorAll('button[role="menuitemradio"]')).filter(
    (b) => b.getAttribute('title') === title
  )[0];
const stateOf = (env) => JSON.parse(env.window.localStorage.getItem(KEY));

test('★ BUG1：模型行被 React 替换后，隐藏标记必须重新贴上（视图签名不变）', async () => {
  // 触发条件：先隐藏某模型，再让 React 按 key 替换行节点 —— 而每个来源的模型数
  // 保持不变，于是 viewSignature（只统计「标题 + 每組几条」）完全相同。
  // 修复前：markersIntact 只核对分组标记与徽标，不看 data-mo-hidden，
  //        快速路径直接返回 → 隐藏的模型又显示出来（而 localStorage 仍说它被隐藏）。
  const env = createPluginEnv();
  const view = mountModelMenu(env.document, {
    menuId: 'ms',
    pane: 'model',
    selected: null,
    providers: [
      { id: 'P', label: 'P', models: [{ id: 'a1', name: 'a1' }, { id: 'a2', name: 'a2' }] },
      { id: 'Q', label: 'Q', models: [{ id: 'b1', name: 'b1' }, { id: 'b2', name: 'b2' }] },
    ],
  });
  await settle(env.window, 300);

  // 通过 UI 隐藏 a2
  openPanelViaHeading(env, view);
  panelOf(env).querySelector('[data-act="manage"]').click();
  Array.from(panelOf(env).querySelectorAll('[data-act="hide"]'))
    .filter((b) => b.getAttribute('data-key') === moKey('P','a2'))[0]
    .click();
  assert.equal(liveItem(env, 'a2').getAttribute('data-mo-hidden'), '1', '前置条件：已标记隐藏');
  assert.deepEqual(stateOf(env).hidden, [moKey('P','a2')], '前置条件：偏好已记录');

  // 模拟 React 把每一行都换成全新节点（数量不变）
  for (const title of ['a1', 'a2', 'b1', 'b2']) {
    const old = liveItem(env, title);
    const fresh = old.cloneNode(true);
    for (const attr of ['data-mo-hidden', 'data-mo-section', 'data-mo-collapsed', 'data-mo-badge', 'data-mo-current']) {
      fresh.removeAttribute(attr);
    }
    old.replaceWith(fresh);
  }
  assert.equal(liveItem(env, 'a2').getAttribute('data-mo-hidden'), null, '前置条件：新节点上没有标记');

  await settle(env.window, 500);
  assert.equal(
    liveItem(env, 'a2').getAttribute('data-mo-hidden'),
    '1',
    '★ 行节点被替换后，隐藏标记必须被重新贴上（否则隐藏的模型会重新出现）'
  );
  assert.equal(liveItem(env, 'a1').getAttribute('data-mo-hidden'), null, '不该误伤未隐藏的模型');
  env.dispose();
});

test('★ BUG2：240ms 内点两个**不同**来源标题，不应被当成双击切模式', async () => {
  // 修复前只判断「有没有待决定时器」，于是点第二个来源（相隔 60ms）会变成切模式，
  // 而用户想要的「打开第二个来源」永远不执行。
  const env = createPluginEnv();
  const view = mountModelMenu(env.document, defaultSpec());
  await settle(env.window, 300);
  const heading = (i) => view.sections[i].querySelector('[data-menu-group-heading]');
  const modeNow = () => (env.window.localStorage.getItem(KEY) === null ? 'hover' : stateOf(env).mode);

  assert.equal(modeNow(), 'hover', '前置条件：默认悬浮模式');

  heading(0).dispatchEvent(new env.window.MouseEvent('click', { bubbles: true }));
  await new Promise((r) => env.window.setTimeout(r, 60));
  heading(1).dispatchEvent(new env.window.MouseEvent('click', { bubbles: true }));
  await settle(env.window, 400);

  assert.equal(modeNow(), 'hover', '★ 点两个不同标题不该切模式');
  assert.equal(panelOf(env).hidden, false, '应打开第二个来源的面板');
  assert.equal(
    panelOf(env).querySelector('.mo-title').textContent,
    'Natsuki 网关',
    '打开的应是第二个来源'
  );
  env.dispose();
});

test('★ BUG3：单击标题后菜单在 240ms 内消失，不得留下空白孤儿浮层', async () => {
  // 修复前：scan() 收起了面板，但待决定时器随后仍执行 openPanel() ——
  // 此时 menuEl 为 null，renderPanel() 直接 return，于是留下一个
  // **空白但可见**的 role="dialog" 浮层盖在页面上。
  const env = createPluginEnv();
  const view = mountModelMenu(env.document, defaultSpec());
  await settle(env.window, 300);

  view.sections[0].querySelector('[data-menu-group-heading]')
    .dispatchEvent(new env.window.MouseEvent('click', { bubbles: true }));
  // 在 240ms 判定窗口内把菜单关掉（模拟内核 close）
  await new Promise((r) => env.window.setTimeout(r, 30));
  view.root.remove();
  await settle(env.window, 500);

  assert.equal(panelOf(env).hidden, true, '★ 菜单消失后不得留下可见的孤儿面板');
  assert.equal(env.document.getElementById('dsh-model-organizer-panel').hidden, true, '菜单消失后面板也应收起');
  // 面板内容为空时更不该可见 —— 一并确认它确实没有渲染内容
  assert.equal(panelOf(env).getAttribute('hidden') !== null, true, '已有内容仍必须不可见');
  env.dispose();
});

test('★ BUG4：来源名本身含 :: 时，清空别名应还原**模型原名**', async () => {
  // 修复前从 key 反解原名：`A::B::c` 按第一个 :: 切分得到 `B::c`（残缺）。
  const env = createPluginEnv();
  mountModelMenu(env.document, {
    menuId: 'w',
    pane: 'model',
    selected: null,
    providers: [{ id: 'x', label: 'A::B', models: [{ id: 'c', name: 'c' }] }],
  });
  await settle(env.window, 300);

  // 划过来源标题直接进入该来源的详情视图（不再需要先从总览点一行来源）。
  openPanelViaHeading(env);
  panelOf(env).querySelector('[data-act="manage"]').click();

  const aliasInput = panelOf(env).querySelector('[data-act="alias"]');
  const rowName = () => panelOf(env).querySelector('[data-act="choose"] .mo-row-name').textContent;

  aliasInput.value = '别名';
  aliasInput.dispatchEvent(new env.window.Event('input', { bubbles: true }));
  assert.equal(rowName(), '别名', '别名应生效');

  aliasInput.value = '';
  aliasInput.dispatchEvent(new env.window.Event('input', { bubbles: true }));
  assert.equal(rowName(), 'c', '★ 清空别名应还原模型原名，而不是残缺的 `B::c`');
  assert.equal(stateOf(env).aliases[moKey('A::B','c')], undefined, '别名应被删除');
  env.dispose();
});

test('★ 回归：持续变动下扫描不能被防抖饿死', async () => {
  // 纯防抖的问题：每次变动都 clearTimeout 重排 120ms，只要变动间隔始终小于窗口，
  // scan() 就永远轮不到执行 —— 插件会一直停在旧状态。
  // 修法：加「最长等待」上限，超过就立刻扫描（而不是继续顺延）。
  const env = createPluginEnv({ autoMount: false });
  const view = mountModelMenu(env.document, defaultSpec());
  env.plugin.apply(env.ctx);
  await settle(env.window, 300);
  assert.equal(view.menu.getAttribute('data-mo-scope'), '1', '前置条件：已增强');

  // 清掉标记，制造「需要重新扫描」的状态
  view.menu.removeAttribute('data-mo-scope');
  for (const section of view.sections) {
    section.removeAttribute('data-mo-section');
    section.removeAttribute('data-mo-collapsed');
    const heading = section.querySelector('[data-menu-group-heading]');
    if (heading) heading.removeAttribute('data-mo-badge');
  }
  assert.equal(view.menu.getAttribute('data-mo-scope'), null, '前置条件：标记已清空');

  // 每 50ms 制造一次变动，持续 1.5s（间隔远小于 120ms 防抖窗口）
  const interval = env.window.setInterval(() => {
    const noise = env.document.createElement('span');
    noise.className = 'mo-noise';
    env.document.body.appendChild(noise);
  }, 50);
  await settle(env.window, 1500);
  env.window.clearInterval(interval);

  assert.equal(view.menu.getAttribute('data-mo-scope'), '1', '★ 持续变动下也应恢复增强（未被饿死）');
  assert.deepEqual(
    view.sections.map((s) => s.querySelector('[data-menu-group-heading]').getAttribute('data-mo-badge')),
    ['(4)', '(19)', '(9)'],
    '标记应被重建'
  );
  env.dispose();
});

test('★ 回归：偏好里存有已下架模型时，快速路径不能永久失效', async () => {
  // markersIntact 曾用「数量全等」比较：一旦 state.hidden 里留着已从目录移除的模型，
  // 它就永远返回 false → 每轮扫描都退化成全量 enhance，在持续变动时反复重写属性。
  const env = createPluginEnv({ autoMount: false });
  const view = mountModelMenu(env.document, {
    menuId: 'ms',
    pane: 'model',
    selected: null,
    providers: [
      { id: 'P', label: 'P', models: [{ id: 'a1', name: 'a1' }, { id: 'a2', name: 'a2' }] },
      { id: 'Q', label: 'Q', models: [{ id: 'b1', name: 'b1' }, { id: 'b2', name: 'b2' }] },
    ],
  });
  env.plugin.apply(env.ctx);
  await settle(env.window, 300);

  const panelOf = () => env.document.getElementById(PANEL);
  const liveItem = (t) =>
    Array.from(env.document.querySelectorAll('button[role="menuitemradio"]')).filter((b) => b.getAttribute('title') === t)[0];

  openPanelViaHeading(env, view);
  panelOf(env).querySelector('[data-act="manage"]').click();
  Array.from(panelOf(env).querySelectorAll('[data-act="hide"]'))
    .filter((b) => b.getAttribute('data-key') === moKey('P','a2'))[0]
    .click();
  assert.deepEqual(stateOf(env).hidden, [moKey('P','a2')], '前置条件：已记录隐藏');

  // 模拟来源目录刷新：该模型从内核里消失（偏好里仍留着陈旧记录）
  liveItem('a2').remove();
  await settle(env.window, 400);

  // 统计一次无关变动触发的重写次数 —— 快速路径有效时应为 0
  let badgeWrites = 0;
  const original = env.window.Element.prototype.setAttribute;
  env.window.Element.prototype.setAttribute = function (name, value) {
    if (name === 'data-mo-badge') badgeWrites += 1;
    return original.call(this, name, value);
  };
  for (let i = 0; i < 3; i++) {
    env.document.body.appendChild(env.document.createElement('span'));
    await settle(env.window, 250);
  }
  env.window.Element.prototype.setAttribute = original;

  assert.equal(badgeWrites, 0, '★ 陈旧隐藏项不该让快速路径永久失效（否则每次扫描都全量重写）');
  // 但其余模型的标记必须仍然正确
  assert.equal(liveItem('a1').getAttribute('data-mo-hidden'), null, '未隐藏的模型不该有标记');
  assert.deepEqual(stateOf(env).hidden, [moKey('P','a2')], '陈旧记录保留在偏好里（不清除用户数据）');
  env.dispose();
});

test('★ 同名模型分属不同来源时，隐藏互不影响', async () => {
  // 真实场景：多个网关都提供同名模型（例如都叫 glm-5.3）。
  // 键是 `来源::模型`，所以必须能各自独立隐藏；用只看模型名的实现会误伤。
  const env = createPluginEnv();
  mountModelMenu(env.document, {
    menuId: 'ms',
    pane: 'model',
    selected: null,
    providers: [
      { id: 'P', label: '来源P', models: [{ id: 'p-m', name: 'm' }, { id: 'p-x', name: 'x' }] },
      { id: 'Q', label: '来源Q', models: [{ id: 'q-m', name: 'm' }, { id: 'q-y', name: 'y' }] },
    ],
  });
  await settle(env.window, 400);

  const all = () => Array.from(env.document.querySelectorAll('button[role="menuitemradio"]'));
  const providerOf = (b) => b.closest('section[role="group"]').querySelector('[data-menu-group-heading]').textContent;
  const find = (prov, title) => all().filter((b) => providerOf(b) === prov && b.getAttribute('title') === title)[0];

  openPanelViaHeading(env);
  panelOf(env).querySelector('[data-act="manage"]').click();
  panelOf(env).querySelector('[data-act="manage-all"]').click();
  const hideBtn = Array.from(panelOf(env).querySelectorAll('[data-act="hide"]'))
    .filter((b) => b.getAttribute('data-key') === moKey('来源Q','m'))[0];
  assert.ok(hideBtn, '应能找到「来源Q::m」的隐藏按钮');
  hideBtn.click();

  assert.equal(find('来源Q', 'm').getAttribute('data-mo-hidden'), '1', '来源Q 的 m 应被隐藏');
  assert.equal(find('来源P', 'm').getAttribute('data-mo-hidden'), null, '★ 来源P 的同名 m 不该被误伤');
  assert.deepEqual(stateOf(env).hidden, [moKey('来源Q','m')]);
  env.dispose();
});

test('★ 偏好里含已下架模型/来源时，界面正常且不渲染幽灵条目', async () => {
  const env = createPluginEnv({ autoMount: false });
  mountModelMenu(env.document, {
    menuId: 'ms',
    pane: 'model',
    selected: null,
    providers: [
      { id: 'P', label: 'P', models: [{ id: 'a1', name: 'a1' }, { id: 'a2', name: 'a2' }] },
      { id: 'Q', label: 'Q', models: [{ id: 'b1', name: 'b1' }] },
    ],
  });
  // 先写入含陈旧条目的偏好，再 apply
  env.window.localStorage.setItem(KEY, JSON.stringify({
    version: 2, // 键已是 v2 格式，别再走 v1 迁移
    mode: 'hover',
    favorites: [moKey('不存在','幽灵'), moKey('P','a1')],
    recents: [moKey('没了','也没了')],
    aliases: { [moKey('P', 'a1')]: '别名A', [moKey('P', 'a2')]: '别名B' },
    hidden: [moKey('P','a2'), moKey('幽灵','x')],
  }));
  env.plugin.apply(env.ctx);
  await settle(env.window, 500);

  const item = (t) =>
    Array.from(env.document.querySelectorAll('button[role="menuitemradio"]')).filter((b) => b.getAttribute('title') === t)[0];
  assert.equal(item('a2').getAttribute('data-mo-hidden'), '1', '存在的隐藏项仍应生效');
  assert.equal(item('a1').getAttribute('data-mo-hidden'), null, '未隐藏项不该被标记');

  openPanelViaHeading(env);
  const names = Array.from(panelOf(env).querySelectorAll('.mo-row-name')).map((n) => n.textContent);
  assert.ok(names.includes('别名A'), '存在的别名应生效');
  assert.equal(names.some((n) => n.includes('幽灵')), false, '★ 不存在的置顶不该渲染成幽灵条目');
  assert.equal(names.some((n) => n.includes('没了')), false, '不存在的最近也不该渲染');
  // 陈旧数据保留在偏好里，不清除用户数据
  assert.ok(stateOf(env).hidden.includes(moKey('幽灵','x')));
  env.dispose();
});

test('★ L2：内核 busy（原生按钮 disabled）时点面板行，不得记录假「最近」', async () => {
  // 面板行是插件自建的、不会 disabled，用户照样能点；而 disabled 的原生按钮
  // 收到 click() 不会触发任何处理器 —— 内核根本没选中。
  // 早期实现先 pushRecent 再 click，于是留下假记录 + 面板静默关闭。
  const env = createPluginEnv();
  const view = mountModelMenu(env.document, {
    menuId: 'ms',
    pane: 'model',
    selected: null,
    providers: [
      { id: 'P', label: 'P', models: [{ id: 'a1', name: 'a1' }] },
      { id: 'Q', label: 'Q', models: [{ id: 'b1', name: 'b1' }] },
    ],
  });
  await settle(env.window, 400);

  // 内核 busy：把每个原生模型项设为 disabled
  for (const b of view.items) b.disabled = true;
  let nativeClicks = 0;
  for (const b of view.items) b.addEventListener('click', () => { nativeClicks += 1; });

  // 划过第二个来源（Q）直接进入它的详情；面板里唯一的 choose 行就是 Q 的模型。
  openPanelViaHeading(env, view, 1);
  const row = panelOf(env).querySelector('[data-act="choose"]');
  assert.ok(row, '应渲染 Q 来源下的模型行');
  assert.equal(row.getAttribute('data-disabled'), '1', '不可用的行应被标记（让用户看得见）');
  assert.equal(row.getAttribute('aria-disabled'), 'true');

  row.click();

  assert.equal(nativeClicks, 0, 'disabled 按钮不会被真正点击');
  const raw = env.window.localStorage.getItem(KEY);
  const recents = raw === null ? [] : JSON.parse(raw).recents;
  assert.deepEqual(recents, [], '★ 静默失败不该写进「最近」');
  assert.equal(panelOf(env).hidden, false, '失败时不该关掉面板');
  env.dispose();
});

test('★ L3：键盘/搜索期间临时取消隐藏，让内核索引与可见集一致', async () => {
  // 隐藏用 CSS display:none，但内核的箭头导航走它自己的 React 数组 ——
  // display:none 的节点无法从数组里移除，所以高亮可能落到用户看不见的行上，
  // 再按 Enter 就选中了看不见的模型。
  const env = createPluginEnv();
  const view = mountModelMenu(env.document, {
    menuId: 'ms',
    pane: 'model',
    selected: null,
    providers: [
      { id: 'P', label: 'P', models: [{ id: 'a1', name: 'a1' }, { id: 'a2', name: 'a2' }, { id: 'a3', name: 'a3' }] },
      { id: 'Q', label: 'Q', models: [{ id: 'b1', name: 'b1' }, { id: 'b2', name: 'b2' }] },
    ],
  });
  await settle(env.window, 400);

  const hiddenNow = () =>
    Array.from(env.document.querySelectorAll('button[role="menuitemradio"]')).filter(
      (b) => b.getAttribute('data-mo-hidden') === '1'
    );

  openPanelViaHeading(env, view);
  panelOf(env).querySelector('[data-act="manage"]').click();
  panelOf(env).querySelector('[data-act="manage-all"]').click();
  Array.from(panelOf(env).querySelectorAll('[data-act="hide"]'))
    .filter((b) => b.getAttribute('data-key') === moKey('Q', 'b1'))[0]
    .click();
  assert.deepEqual(hiddenNow().map((b) => b.getAttribute('title')), ['b1'], '前置条件：b1 已隐藏');

  // 键盘导航 → 隐藏必须被临时取消，否则高亮会落到看不见的行
  // 真实按键来自菜单内的焦点元素，不是 document
  view.trigger.dispatchEvent(new env.window.KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
  await settle(env.window, 300);
  assert.equal(hiddenNow().length, 0, '★ 键盘模式下不得留下 display:none 的行（内核索引仍含它）');
  assert.equal(
    Array.from(env.document.querySelectorAll('button[role="menuitemradio"]')).length,
    5,
    '5 行应全部可见'
  );

  // 鼠标接管 → 恢复隐藏
  view.items[0].dispatchEvent(new env.window.MouseEvent('mousedown', { bubbles: true, cancelable: true, button: 0 }));
  await settle(env.window, 300);
  assert.deepEqual(hiddenNow().map((b) => b.getAttribute('title')), ['b1'], '退出键盘模式后应恢复隐藏');
  env.dispose();
});

test('★ L4：HMR 旧实例延迟拆除，不得删掉活实例的样式表', async () => {
  // 新实例先 boot（拆旧→建新→刷新样式），宿主随后才拆旧的 cordis effect。
  // 旧 disposer 若按全局 id 删样式，删掉的是新实例正在用的 —— 面板裸奔。
  const env = createPluginEnv({ autoMount: false });
  mountModelMenu(env.document, {
    menuId: 'ms',
    pane: 'model',
    selected: null,
    providers: [{ id: 'P', label: 'P', models: [{ id: 'a1', name: 'a1' }] }],
  });

  env.plugin.apply(env.ctx);
  await settle(env.window, 300);
  assert.ok(env.document.getElementById('dsh-model-organizer-style'), '首次 apply 应有样式');

  env.plugin.apply(env.ctx); // 单例守卫会先拆旧实例
  await settle(env.window, 300);
  assert.ok(env.document.getElementById('dsh-model-organizer-style'), '二次 apply 后应有样式');

  // 宿主延迟拆除**旧** effect
  env.disposers[0]();
  await settle(env.window, 200);

  const style = env.document.getElementById('dsh-model-organizer-style');
  const panel = env.document.getElementById('dsh-model-organizer-panel');
  assert.ok(panel, '活实例的面板应仍在');
  assert.ok(style, '★ 活实例的样式表不得被旧 disposer 删除');
  assert.ok(style.textContent.includes('[data-mo-scope="1"]'), '样式内容应完好');
  env.dispose();
});

test('★ L5：徽标只数可见模型（隐藏后不该显示虚高数量）', async () => {
  const env = createPluginEnv();
  mountModelMenu(env.document, {
    menuId: 'ms',
    pane: 'model',
    selected: null,
    providers: [
      { id: 'P', label: 'P', models: [{ id: 'a1', name: 'a1' }, { id: 'a2', name: 'a2' }] },
      { id: 'Q', label: 'Q', models: [{ id: 'b1', name: 'b1' }] },
    ],
  });
  await settle(env.window, 400);
  const badgeOf = (label) =>
    Array.from(env.document.querySelectorAll('section[role="group"]'))
      .filter((s) => s.querySelector('[data-menu-group-heading]').textContent === label)[0]
      .querySelector('[data-menu-group-heading]')
      .getAttribute('data-mo-badge');

  assert.equal(badgeOf('P'), '(2)', '初始应显示 P 的两个模型');

  // 通过偏好直接隐藏 P 的一个模型，再触发重扫
  openPanelViaHeading(env);
  panelOf(env).querySelector('[data-act="manage"]').click();
  Array.from(panelOf(env).querySelectorAll('[data-act="hide"]'))
    .filter((b) => b.getAttribute('data-key') === moKey('P', 'a2'))[0]
    .click();
  panelOf(env).querySelector('[data-act="manage-off"]').click();
  await settle(env.window, 300);

  assert.equal(badgeOf('P'), '(1)', '★ 徽标应排除被隐藏的模型');
  env.dispose();
});

test('★ 键含引号/反斜杠/中文时仍能无损往返', async () => {
  // JSON 数组编码的键会被写进 data-key 属性与 localStorage；若实现里用
  // 字符串拼接或选择器插值，这些字符会破坏往返。这里做端到端确认。
  const env = createPluginEnv();
  mountModelMenu(env.document, {
    menuId: 'ms',
    pane: 'model',
    selected: null,
    providers: [
      { id: 'P', label: 'he said "hi"', models: [{ id: 'm1', name: 'back\\slash' }] },
      { id: 'Q', label: '中文"引号"', models: [{ id: 'm2', name: '模型\\名' }] },
    ],
  });
  await settle(env.window, 400);

  openPanelViaHeading(env);
  panelOf(env).querySelector('[data-act="manage"]').click();
  panelOf(env).querySelector('[data-act="manage-all"]').click();

  const row = panelOf(env).querySelector('[data-act="choose"]');
  const key = row.getAttribute('data-key');
  assert.ok(Array.isArray(JSON.parse(key)), 'data-key 应是可解析的 JSON 数组');
  assert.equal(JSON.parse(key).length, 2, '应含来源与模型两个分量');

  // 隐藏该模型 → 键必须能无损还原出模型名
  panelOf(env).querySelector('[data-act="hide"]').click();
  await settle(env.window, 300);
  const hidden = stateOf(env).hidden;
  assert.equal(hidden.length, 1, '应记录一条隐藏');
  const marked = Array.from(env.document.querySelectorAll('button[role="menuitemradio"]'))
    .filter((b) => b.getAttribute('data-mo-hidden') === '1')
    .map((b) => b.getAttribute('title'));
  assert.equal(marked.length, 1, '只应标记一个原生行');
  assert.equal(JSON.parse(hidden[0])[1], marked[0], '★ 键应无损还原出模型名');

  // 含特殊字符的别名也能存下
  const aliasInput = panelOf(env).querySelector('[data-act="alias"]');
  aliasInput.value = '别"名\\x';
  aliasInput.dispatchEvent(new env.window.Event('input', { bubbles: true }));
  assert.deepEqual(Object.values(stateOf(env).aliases), ['别"名\\x'], '别名应逐字保留');
  env.dispose();
});
