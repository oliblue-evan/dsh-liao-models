/**
 * 结构契约：`client.js` 的单文件组织方式必须可被测试可靠地切开。
 *
 * 客户端 bundle 是单文件（宿主把它拼进 combo 脚本、以传统脚本执行），所以"纯逻辑"
 * 与"界面"的边界只能靠标记声明。这里把这份约定钉住：
 *   · 标记各出现一次（多了/少了都说明结构被动过）；
 *   · 区块里确实有测试需要的那些符号；
 *   · 区块里**不许出现 React / DOM**（那是它能被 `new Function` 直接求值的前提）。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { clientSource, pureLogicBlock } from './extract-client.mjs';

/** 测试要用到的符号（`organizer-logic` / `scope-guard` 都依赖它们）。 */
const REQUIRED = [
  'STATE_VERSION', 'DEFAULT_MODE', 'MODES', 'RECENTS_CAP', 'FAVORITES_CAP', 'ALIAS_MAX',
  'modelKey', 'migrateLegacyKey', 'isMode', 'emptyState', 'normalizeState', 'serializeState', 'toggleInList',
  'removeFromList', 'pushRecent', 'resolveLabel', 'normalizeQuery', 'isSubsequence',
  'matchesQuery', 'rankEntries', 'isModelMenuSignature', 'nextMode', 'shouldCollapseByDefault',
];

test('纯逻辑标记各出现一次', () => {
  const source = clientSource();
  assert.equal(source.split('// #region 纯逻辑').length - 1, 1);
  assert.equal(source.split('// #endregion 纯逻辑').length - 1, 1);
});

test('纯逻辑区块包含测试依赖的全部符号', () => {
  const block = pureLogicBlock();
  const missing = REQUIRED.filter(
    (name) => !new RegExp('(function|const)\\s+' + name + '\\b').test(block)
  );
  assert.deepEqual(missing, [], '这些符号不在纯逻辑区块里了：' + missing.join(', '));
});

test('纯逻辑区块不含 React / DOM（这是它能被直接求值的前提）', () => {
  // 只看代码行：注释里就写着"不含 DOM"，注释会把自己判成违规
  const code = pureLogicBlock()
    .split('\n')
    .filter((line) => !/^\s*(\/\/|\*|\/\*)/.test(line))
    .join('\n');
  for (const forbidden of ['React', 'document.', 'window.', 'useState', 'useEffect']) {
    assert.equal(
      code.includes(forbidden),
      false,
      `纯逻辑区块里不该出现 ${forbidden}`
    );
  }
});

test('客户端 bundle 采用 loader 工厂格式且 id 与包名一致', () => {
  const source = clientSource();
  assert.match(source, /window\.__ModuleLoader__\.load\(/);
  assert.match(source, /id:\s*'dsh-liao-models'/);
  assert.match(source, /factory\(require\)/);
});

test('作用域纪律：所有 CSS 规则都挂在 [data-mo-scope] 之下', () => {
  // 这是本插件相对社区版的核心修正 —— 样式不得出现无祖先限定的
  // section[role="group"] 选择器，否则会泄漏进共用了 MenuGroup 原语的 /model 弹窗。
  const source = clientSource();
  const cssBlock = source.slice(source.indexOf('function buildCss()'), source.indexOf('function ensureStyle'));
  assert.ok(cssBlock.length > 0, '找不到 buildCss');
  // 任何出现 section[role="group"] 的 CSS 行都必须经由 scope 变量拼接
  const bad = cssBlock
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.includes('section[role="group"]'))
    .filter((line) => !line.includes('scope +'));
  assert.deepEqual(bad, [], '这些 CSS 行没有作用域前缀，会泄漏到 /model 弹窗：\n' + bad.join('\n'));
  // 作用域属性必须由 JS 判定后写入，而不是靠 CSS 猜
  assert.match(source, /SCOPE_ATTR = 'data-mo-scope'/);
  assert.match(source, /setAttribute\(SCOPE_ATTR, '1'\)/);
});
