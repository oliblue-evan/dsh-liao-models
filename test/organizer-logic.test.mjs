/**
 * 纯逻辑单测：偏好规范化、置顶/最近、别名、模糊搜索、排序、签名判定。
 *
 * 这些函数是插件全部判断力的所在（DOM 部分只负责把它们的结果画出来），
 * 所以它们在 node 里被直接测，不依赖任何 DOM。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { clientScope } from './extract-client.mjs';

const S = clientScope([
  'STATE_VERSION', 'DEFAULT_MODE', 'MODES', 'RECENTS_CAP', 'FAVORITES_CAP', 'ALIAS_MAX',
  'modelKey', 'migrateLegacyKey', 'isMode', 'emptyState', 'normalizeState', 'serializeState', 'toggleInList',
  'removeFromList', 'pushRecent', 'resolveLabel', 'normalizeQuery', 'isSubsequence',
  'matchesQuery', 'rankEntries', 'isModelMenuSignature', 'nextMode', 'shouldCollapseByDefault',
]);

test('modelKey 是单射：不同 (来源, 模型) 必须得到不同键', () => {
  // v1 曾用 `provider + '::' + model` 拼接，两个分量都不转义 ——
  // ("A::B","c") 与 ("A","B::c") 会撞成同一个键，隐藏/置顶一个会连带影响另一个。
  // v2 改为 JSON 数组编码，天然可逆。
  assert.notEqual(S.modelKey('A::B', 'c'), S.modelKey('A', 'B::c'), '含 :: 的来源名不得与含 :: 的模型名相撞');
  assert.notEqual(S.modelKey('A', 'B'), S.modelKey('AB', ''), '普通相邻分量不得相撞');
  assert.notEqual(S.modelKey('A', 'A'), S.modelKey('A::A', ''), '重复分量不得相撞');
  // 可逆：解出来必须还是原值
  assert.deepEqual(JSON.parse(S.modelKey('A::B', 'c')), ['A::B', 'c']);
  assert.deepEqual(JSON.parse(S.modelKey('A', 'B::c')), ['A', 'B::c']);
  // 引号 / 反斜杠也要能正确往返
  const tricky = S.modelKey('he said "hi"', 'back\\slash');
  assert.deepEqual(JSON.parse(tricky), ['he said "hi"', 'back\\slash']);
  // 稳定性：同样的入参永远同样的键
  assert.equal(S.modelKey('DeepSeek', 'DeepSeek-V4.1-Flash'), S.modelKey('DeepSeek', 'DeepSeek-V4.1-Flash'));
});

test('v1 → v2 键迁移：老偏好仍能对上', () => {
  // 旧键按**第一个** :: 切分（当时的语义），迁移后应与新键一致。
  assert.equal(S.migrateLegacyKey('DeepSeek::DeepSeek-V4.1-Flash'), S.modelKey('DeepSeek', 'DeepSeek-V4.1-Flash'));
  assert.equal(S.migrateLegacyKey('Natsuki 网关::grok-4.7'), S.modelKey('Natsuki 网关', 'grok-4.7'));
  // 没有分隔符的条目保持原样（不做无依据的猜测）
  assert.equal(S.migrateLegacyKey('没有分隔符'), '没有分隔符');
  assert.equal(S.migrateLegacyKey(''), '');
});

test('normalizeState 把 v1 偏好迁移成 v2 键', () => {
  const upgraded = S.normalizeState(JSON.stringify({
    version: 1,
    mode: 'panel',
    favorites: ['DeepSeek::DeepSeek-V4-Pro'],
    recents: ['Natsuki 网关::grok-latest'],
    aliases: { 'DeepSeek::DeepSeek-V4.1-Flash': '小闪' },
    hidden: ['Free 模型::free-v4-flash'],
  }));
  assert.equal(upgraded.version, S.STATE_VERSION, '版本应升到当前');
  assert.deepEqual(upgraded.favorites, [S.modelKey('DeepSeek', 'DeepSeek-V4-Pro')], '置顶键应迁移');
  assert.deepEqual(upgraded.recents, [S.modelKey('Natsuki 网关', 'grok-latest')], '最近键应迁移');
  assert.deepEqual(upgraded.hidden, [S.modelKey('Free 模型', 'free-v4-flash')], '隐藏键应迁移');
  assert.deepEqual(Object.keys(upgraded.aliases), [S.modelKey('DeepSeek', 'DeepSeek-V4.1-Flash')], '别名键应迁移');
  assert.equal(upgraded.aliases[S.modelKey('DeepSeek', 'DeepSeek-V4.1-Flash')], '小闪');
  assert.equal(upgraded.mode, 'hover', 'panel 模式迁移为 hover，模型偏好仍保留');
  // collapsed 字段已随 list 模式移除，不再出现在状态里
  assert.equal('collapsed' in upgraded, false, 'collapsed 字段应已移除');
  // 已是 v2 的数据不该被二次迁移（JSON 里带引号，若再切 :: 会破坏）
  const again = S.normalizeState(S.serializeState(upgraded));
  assert.deepEqual(again.favorites, upgraded.favorites, 'v2 数据往返不得变化');
  assert.deepEqual(Object.keys(again.aliases), Object.keys(upgraded.aliases));
});

test('emptyState 默认模式是 hover，容量与版本就位', () => {
  const state = S.emptyState();
  assert.equal(state.mode, 'hover');
  assert.equal(state.version, S.STATE_VERSION);
  assert.deepEqual(state.favorites, []);
  assert.deepEqual(state.recents, []);
  assert.deepEqual(state.aliases, {});
  assert.deepEqual(state.hidden, []);
});

test('normalizeState 对坏数据逐字段降级，不整体丢弃', () => {
  // 数组不是合法状态
  assert.equal(S.normalizeState([1, 2, 3]).mode, 'hover');
  // null / 空串 / 非法 JSON
  assert.equal(S.normalizeState(null).mode, 'hover');
  assert.equal(S.normalizeState('').mode, 'hover');
  assert.equal(S.normalizeState('{坏 JSON').mode, 'hover');
  // 部分合法：mode 保住，坏字段降级
  const mixed = S.normalizeState(JSON.stringify({
    mode: 'panel',
    favorites: ['a', '', 42, 'a', 'b'],
    recents: 'not-an-array',
    aliases: { k: '  别名  ', bad: 7, empty: '   ' },
    hidden: ['x'],
  }));
  assert.equal(mixed.mode, 'hover');
  assert.deepEqual(mixed.favorites, ['a', 'b'], '应去空、去重、丢非字符串');
  assert.deepEqual(mixed.recents, [], '非数组应降级为空');
  assert.deepEqual(mixed.aliases, { k: '别名' }, '别名应修剪并丢空值');
  assert.deepEqual(mixed.hidden, ['x']);
});


test('normalizeState 拒绝非法 mode 并回落默认（含已移除的 list）', () => {
  assert.equal(S.normalizeState({ mode: 'nope' }).mode, 'hover');
  assert.equal(S.normalizeState({ mode: 'panel' }).mode, 'hover');
  // ★ 老用户 localStorage 里可能存着已移除的 'list'：必须回落而不是留在非法态
  assert.equal(S.normalizeState({ mode: 'list' }).mode, 'hover', 'list 已移除应回落 hover');
});

test('normalizeState 强制各种上限', () => {
  const many = [];
  for (let i = 0; i < 50; i++) many.push('m' + i);
  assert.equal(S.normalizeState({ favorites: many }).favorites.length, S.FAVORITES_CAP);
  assert.equal(S.normalizeState({ recents: many }).recents.length, S.RECENTS_CAP);
  const longAlias = S.normalizeState({ aliases: { k: 'x'.repeat(200) } }).aliases.k;
  assert.equal(longAlias.length, S.ALIAS_MAX);
  // hidden 不限量（用户可能藏很多）
  assert.equal(S.normalizeState({ hidden: many }).hidden.length, 50);
});

test('serializeState 落盘的永远是干净数据（可往返）', () => {
  const round = S.normalizeState(S.serializeState({ mode: 'panel', favorites: ['a', 'a', ''], aliases: { k: ' v ' } }));
  assert.equal(round.mode, 'hover');
  assert.deepEqual(round.favorites, ['a']);
  assert.deepEqual(round.aliases, { k: 'v' });
});

test('toggleInList 置顶/取消置顶：新项置前、重复调用还原、遵守上限', () => {
  assert.deepEqual(S.toggleInList([], 'a', 3), ['a']);
  assert.deepEqual(S.toggleInList(['a', 'b'], 'c', 3), ['c', 'a', 'b']);
  assert.deepEqual(S.toggleInList(['a', 'b'], 'a', 3), ['b'], '再次切换应取消');
  assert.deepEqual(S.toggleInList(['a', 'b', 'c'], 'd', 3), ['d', 'a', 'b'], '应截断到上限');
  // cap<=0 不限量
  assert.deepEqual(S.toggleInList([], 'x', 0), ['x']);
  // 不改原数组
  const original = ['a'];
  S.toggleInList(original, 'b', 5);
  assert.deepEqual(original, ['a']);
});

test('removeFromList 移除而不改原数组', () => {
  const original = ['a', 'b'];
  assert.deepEqual(S.removeFromList(original, 'a'), ['b']);
  assert.deepEqual(S.removeFromList(original, 'zz'), ['a', 'b']);
  assert.deepEqual(original, ['a', 'b']);
});

test('pushRecent 去重置前并截断', () => {
  assert.deepEqual(S.pushRecent([], 'a'), ['a']);
  assert.deepEqual(S.pushRecent(['a', 'b'], 'b'), ['b', 'a'], '已在表内应移到最前');
  let list = [];
  for (let i = 0; i < 20; i++) list = S.pushRecent(list, 'm' + i);
  assert.equal(list.length, S.RECENTS_CAP);
  assert.equal(list[0], 'm19', '最新的在最前');
});

test('resolveLabel 有别名用别名，否则用原名', () => {
  assert.equal(S.resolveLabel({ k: '短名' }, 'k', '很长很长的原始模型名'), '短名');
  assert.equal(S.resolveLabel({}, 'k', '原名'), '原名');
  assert.equal(S.resolveLabel({ k: '   ' }, 'k', '原名'), '原名', '空白别名应视为没有');
  assert.equal(S.resolveLabel(null, 'k', '原名'), '原名');
});

test('normalizeQuery 修剪并小写', () => {
  assert.equal(S.normalizeQuery('  DSV4  '), 'dsv4');
  assert.equal(S.normalizeQuery(null), '');
  assert.equal(S.normalizeQuery(undefined), '');
  assert.equal(S.normalizeQuery(42), '');
});

test('isSubsequence 模糊匹配：不连续特征字母也命中', () => {
  assert.equal(S.isSubsequence('deepseek-v4-flash', 'dsv4f'), true);
  assert.equal(S.isSubsequence('deepseek-v4-flash', ''), true, '空查询命中一切');
  assert.equal(S.isSubsequence('deepseek-v4-flash', 'zzz'), false);
  assert.equal(S.isSubsequence('abc', 'acb'), false, '顺序必须一致');
  assert.equal(S.isSubsequence('abc', 'abcd'), false, '查询比目标长则不命中');
});

test('matchesQuery 别名与原名都能命中', () => {
  const entry = { key: 'k', label: '长名', raw: 'DeepSeek-V4.1-Flash' };
  assert.equal(S.matchesQuery(entry, {}, ''), true);
  assert.equal(S.matchesQuery(entry, {}, 'dsv4'), true, '原名模糊命中');
  assert.equal(S.matchesQuery(entry, { k: 'ds' }, 'ds'), true, '别名命中');
  assert.equal(S.matchesQuery(entry, { k: 'pony' }, 'pony'), true, '别名指向原名之外也能命中');
  assert.equal(S.matchesQuery(entry, {}, 'zzz'), false);
});

test('rankEntries 打分：完全命中 > 前缀 > 子串 > 子序列，且稳定', () => {
  const entries = [
    { key: 'k1', label: 'Sub', raw: 'xx-kimi-k3' },     // 子串
    { key: 'k2', label: 'Pre', raw: 'kimi-k2.6' },      // 前缀
    { key: 'k3', label: 'Exact', raw: 'kimi' },         // 完全
    { key: 'k4', label: 'Seq', raw: 'k-i-m-i-x' },      // 子序列
  ];
  const ranked = S.rankEntries(entries, {}, 'kimi');
  assert.deepEqual(ranked.map((r) => r.key), ['k3', 'k2', 'k1', 'k4']);
  assert.deepEqual(ranked.map((r) => r.score), [0, 1, 2, 3]);
});

test('rankEntries 空输入与同分稳定', () => {
  assert.deepEqual(S.rankEntries([], {}, 'a'), []);
  assert.deepEqual(S.rankEntries(null, {}, 'a'), []);
  const same = [
    { key: 'a', label: 'A', raw: 'same' },
    { key: 'b', label: 'B', raw: 'same' },
  ];
  assert.deepEqual(S.rankEntries(same, {}, 'same').map((r) => r.key), ['a', 'b'], '同分保持原序');
});

test('isModelMenuSignature：composer 模型菜单为真，其余表面全部为假', () => {
  const modelMenu = { isMenuRole: true, hasGroupSections: true, hasRadioItems: true, insideListbox: false };
  assert.equal(S.isModelMenuSignature(modelMenu), true);

  // ★ 关键：/model 命令弹窗共用 MenuGroup，但它是 listbox 且选项不是 menuitemradio
  assert.equal(S.isModelMenuSignature({ ...modelMenu, insideListbox: true }), false, '/model 弹窗必须排除');
  assert.equal(S.isModelMenuSignature({ ...modelMenu, hasRadioItems: false }), false, 'listbox 选项不是 radio');
  // root pane：没有分组
  assert.equal(S.isModelMenuSignature({ isMenuRole: true, hasGroupSections: false, hasRadioItems: false, insideListbox: false }), false);
  // effort pane：有 radio 但无分组
  assert.equal(S.isModelMenuSignature({ isMenuRole: true, hasGroupSections: false, hasRadioItems: true, insideListbox: false }), false);
  // 外层 surface 在 model pane 是 role=group，不是 menu
  assert.equal(S.isModelMenuSignature({ isMenuRole: false, hasGroupSections: true, hasRadioItems: true, insideListbox: false }), false);
  // 坏输入
  assert.equal(S.isModelMenuSignature(null), false);
  assert.equal(S.isModelMenuSignature(undefined), false);
  assert.equal(S.isModelMenuSignature({}), false);
  // 严格 true：不接受 truthy 的 1 / 'yes'
  assert.equal(S.isModelMenuSignature({ isMenuRole: 1, hasGroupSections: true, hasRadioItems: true, insideListbox: false }), false);
});

test('nextMode 始终返回唯一的 hover 模式', () => {
  assert.equal(S.nextMode('hover'), 'hover');
  assert.equal(S.nextMode('panel'), 'hover');
  assert.equal(S.MODES.length, 1, '只应有 hover');
  // 老数据里的 list 会被 isMode 拒掉并回落默认（见 normalizeState 用例）
  assert.equal(S.nextMode('list'), 'hover', '未知模式按索引 -1 处理，不崩');
});

test('isMode 只认 hover（panel / list 已移除）', () => {
  assert.equal(S.isMode('hover'), true);
  assert.equal(S.isMode('panel'), false);
  assert.equal(S.isMode('list'), false, 'list 模式已移除，必须被拒');
  assert.equal(S.isMode('inline'), false);
  assert.equal(S.isMode(null), false);
});

test('shouldCollapseByDefault：原生列表一律折叠（与模式无关）', () => {
  // 早期还有 list 模式需要按来源记忆展开状态；该模式移除后恒折叠。
  assert.equal(S.shouldCollapseByDefault(), true);
});
