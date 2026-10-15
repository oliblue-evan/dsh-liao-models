/**
 * dsh-model-organizer —— 客户端半边（浏览器 bundle）。
 *
 * ============================================================================
 * 这是什么
 * ============================================================================
 * 把 composer 的模型选择菜单（`@deepseek-ai/dsh-client-ui-model-selection` 渲染、
 * portal 到 body 的模型面板）从「一条道排到底的长列表」整理成**先看来源、再看模型**：
 *
 *   · 按来源（provider）折叠：菜单里每个来源只占一行标题；
 *   · 悬浮/点击来源 → 插件自建的侧边面板滑出，列出该来源的模型；
 *   · 置顶：把常用模型固定到最前，点击直达；
 *   · 最近：自动记住最近选过的模型；
 *   · 搜索：面板内一个搜索框，同时匹配**别名**与原始名；
 *   · 别名 / 隐藏：给模型起短名字，或把用不上的模型从列表里藏起来。
 *
 * ============================================================================
 * 为什么长得不像官方客户端插件（重要）
 * ============================================================================
 * 官方 `cordis-plugin-development` skill 的规矩是：**不要写组件之外的 DOM、不要
 * append 到 document.body**，UI 应通过 slots 注册 React 组件。这条规矩在这里做不到 ——
 * 模型菜单**没有对应 slot**：它是内核组件内部的 JSX，插件无法用 slot 去改它的渲染。
 * 社区已有的同类插件（dsh-model-fold）同样只能用 DOM 增强，这条路本身是成立的，
 * 但必须把它的代价压到最低。本文件据此定了三条硬纪律：
 *
 *   1) **绝不移动、删除、重挂任何 React 管理的节点。** 对原生节点只做**属性写入**
 *      （data-mo-*）与 CSS 隐藏；所有新增界面都是插件自建、挂在 body 上的 DOM。
 *      这样 React 的协调器永远看不到「多出来的孩子」，也就不会打乱它的 diff。
 *   2) **作用域必须由 JS 判定，不能只靠 CSS 选择器。** 这是本插件与社区版最大的
 *      差别，也是社区版真实存在的缺陷：原生分组结构 `section[role="group"] >
 *      [data-menu-group-heading]` 来自共享原语 `MenuGroup`，**`/model` 命令弹窗
 *      （role="listbox"）也用它**。社区版把标题样式写成不带祖先限定的全局选择器，
 *      于是 `/model` 弹窗的分组标题也被加上了箭头、hover 高亮和手型光标 ——
 *      还是那句 README 里明确否认的话。本插件先跑一遍严格签名判定，通过后才给菜单
 *      打上 `data-mo-scope`，**所有 CSS 规则一律挂在 `[data-mo-scope="1"]` 之下**，
 *      于是样式在物理上不可能离开模型菜单。
 *   3) **只用内核已暴露的钩子，不猜结构。** 分组标题用 `[data-menu-group-heading]`，
 *      模型项用 `button[role="menuitemradio"]`，容器用 `div[role="menu"]`；
 *      选中态读 `aria-checked`，显示名读 `title`。这些是内核有意暴露的语义钩子，
 *      比任何「第几个孩子」式的位置选择器稳定得多。
 *
 * ============================================================================
 * 与官方 React 状态的关系
 * ============================================================================
 * 插件**不复制**内核状态：模型清单、选中项、切换动作都由内核掌握。面板里点一个模型，
 * 做法是**程序化点击菜单里那个真实按钮**（`nativeButton.click()`），于是选中动作
 * 完全由内核自己的 onClick 完成，pending/选中态/失败重试全部照旧。
 *
 * ============================================================================
 * 本文件的结构
 * ============================================================================
 *   · 「纯逻辑」region 区块：不含任何 DOM/React，可被测试直接求值
 *     （`test/extract-client.mjs` 按文件内的 region 标记抽取，
 *      `test/organizer-logic.test.mjs` 单测；该标记在文件中各出现恰好一次）。
 *   · 其余部分：DOM 增强。宿主把各插件 bundle 拼成一个 combo 脚本、以**传统脚本**
 *     执行，所以这里是单文件、不用 ESM import，也不依赖 React。
 */

window.__ModuleLoader__.load({
  id: 'dsh-model-organizer',
  factory(require) {
    // React 来自浏览器模块表（宿主注入），不需要自己装 React / 找 CDN。
    // 只有设置卡（注册进 plugins.bundle.config 槽位）需要 React；
    // 模型菜单的增强仍是纯 DOM（那个菜单没有对应槽位，见文件头说明）。
    const React = require('react');
    const h = React.createElement;
    const { useState, useEffect, useLayoutEffect, useRef } = React;

    // #region 纯逻辑
    // ─────────────────────────────────────────────────────────────────────
    // 这一段不含 DOM / React，测试直接 `new Function` 求值。
    // ─────────────────────────────────────────────────────────────────────

    /** 偏好数据的版本号；字段语义变化时递增，旧数据按版本迁移。 */
    const STATE_VERSION = 6;
    /** 默认交互模式：悬浮展开。 */
    const DEFAULT_MODE = 'hover';
    /** 仅保留悬浮展开；旧 panel/list 偏好规范化为 hover。 */
    const MODES = ['hover'];
    /** 「最近使用」最多记几个。 */
    const RECENTS_CAP = 8;
    /** 置顶数量上限（防止把列表顶满）。 */
    const FAVORITES_CAP = 12;
    /** 别名长度上限。 */
    const ALIAS_MAX = 24;
    /** 面板字号可选项（px）。设置页里选，作用于面板与来源列表。 */
    const FONT_SIZES = [12, 13, 14];
    /** 面板字号默认值。 */
    const DEFAULT_FONT_SIZE = 13;
    /** 旧版（v1）键的分隔符，仅用于迁移。 */
    const LEGACY_KEY_SEP = '::';

    /** 旧显示名二元组：用于兼容旧偏好与缺少宿主目录时的保守降级。 */
    function modelKey(provider, model) {
      return JSON.stringify([String(provider), String(model)]);
    }

    /** 三元组与旧显示名二元组不碰撞；两个 ID 来自宿主已加载的目录。 */
    function stableModelKey(providerId, modelId) {
      return JSON.stringify(['id', String(providerId), String(modelId)]);
    }

    /** 只清除确定的费用后缀，不模糊猜测模型身份。 */
    function withoutPriceLabel(name) {
      return String(name).replace(/\s*[·•]\s*x\d+(?:\.\d+)?(?:\s*(?:→|->)\s*x\d+(?:\.\d+)?)?\s*$/i, '').trim();
    }

    /** 安全迁移偏好键；冲突时保留已经写在稳定 ID 下的别名。 */
    function remapPreferenceKeys(raw, mapping) {
      const base = normalizeState(raw);
      const remap = function (key) { return mapping.get(key) || key; };
      const aliases = {};
      for (const key of Object.keys(base.aliases)) {
        const target = remap(key);
        if (target !== key) aliases[target] = base.aliases[key];
      }
      for (const key of Object.keys(base.aliases)) if (remap(key) === key) aliases[key] = base.aliases[key];
      return normalizeState(Object.assign({}, base, {
        favorites: base.favorites.map(remap), recents: base.recents.map(remap), hidden: base.hidden.map(remap), aliases: aliases,
      }));
    }

    /**
     * v1 → v2 键迁移：把旧的 `来源::模型` 拆成新键。
     *
     * 旧键有歧义（无法区分 `("A::B","c")` 与 `("A","B::c")`），按**第一个** `::`
     * 切分是当时的语义，也是唯一可做的选择；切不出分隔符的条目保持原样。
     * 迁移只做一次（靠 STATE_VERSION 判断），失败时逐条降级而不是整体丢弃。
     *
     * @param {string} legacyKey - 旧键。
     * @returns {string} 新键。
     */
    function migrateLegacyKey(legacyKey) {
      const text = String(legacyKey);
      const at = text.indexOf(LEGACY_KEY_SEP);
      if (at < 0) return text;
      return modelKey(text.slice(0, at), text.slice(at + LEGACY_KEY_SEP.length));
    }

    /**
     * 是否是合法模式。
     * @param {unknown} value - 待判定值。
     * @returns {boolean} 合法为 true。
     */
    function isMode(value) {
      return MODES.indexOf(value) >= 0;
    }

    /**
     * 空偏好状态。
     * @returns {{version:number,mode:string,favorites:string[],recents:string[],aliases:Record<string,string>,hidden:string[],fontSize:number}} 新状态。
     */
    function emptyState() {
      return {
        version: STATE_VERSION,
        mode: DEFAULT_MODE,
        favorites: [],
        recents: [],
        aliases: {},
        hidden: [],
        // v3+ 设置页偏好（见插件管理页的 bundle 设置卡）。
        fontSize: DEFAULT_FONT_SIZE,
        groupSeries: true,
        sortOrder: 'default',
        collapsedSeries: [],
      };
    }

    /**
     * 洗字号：只接受 FONT_SIZES 里的值，其余回落默认。
     * @param {unknown} value - 任意输入（数字或数字字符串）。
     * @returns {number} 合法字号。
     */
    function coerceFontSize(value) {
      const num = typeof value === 'string' ? parseInt(value, 10) : value;
      return FONT_SIZES.indexOf(num) >= 0 ? num : DEFAULT_FONT_SIZE;
    }

    /**
     * 重置**用户数据**（置顶/最近/别名/隐藏/折叠），保留模式与设置页偏好。
     *
     * 设置页的「清空」按钮用；不清 mode/fontSize —— 那是用户
     * 刚配置的偏好，一键清空数据不该顺手改掉设置。
     *
     * @param {unknown} state - 当前状态。
     * @returns {ReturnType<typeof emptyState>} 清空后的状态。
     */
    function resetUserData(state) {
      const base = normalizeState(state);
      return {
        version: STATE_VERSION,
        mode: base.mode,
        favorites: [],
        recents: [],
        aliases: {},
        hidden: [],
        fontSize: base.fontSize,
        groupSeries: base.groupSeries,
        sortOrder: base.sortOrder,
        collapsedSeries: [],
      };
    }

    /**
     * 把任意输入洗成合法字符串数组：去重、去空、限长。
     * @param {unknown} value - 任意输入。
     * @param {number} cap - 上限（<=0 表示不限制）。
     * @returns {string[]} 清洗后的数组。
     */
    function coerceStringArray(value, cap) {
      if (!Array.isArray(value)) return [];
      const out = [];
      for (let i = 0; i < value.length; i++) {
        const item = value[i];
        if (typeof item !== 'string') continue;
        const text = item.trim();
        if (text === '' || out.indexOf(text) >= 0) continue;
        out.push(text);
        if (cap > 0 && out.length >= cap) break;
      }
      return out;
    }

    /**
     * 把任意输入洗成「键 → 别名」映射：丢掉空值、修剪、限长。
     * @param {unknown} value - 任意输入。
     * @returns {Record<string,string>} 清洗后的映射。
     */
    function coerceAliasMap(value) {
      const out = {};
      if (value === null || typeof value !== 'object') return out;
      const keys = Object.keys(value);
      for (let i = 0; i < keys.length; i++) {
        const key = keys[i];
        const raw = value[key];
        if (typeof raw !== 'string') continue;
        const text = raw.trim().slice(0, ALIAS_MAX);
        if (text === '') continue;
        out[key] = text;
      }
      return out;
    }

    /**
     * 容忍式反序列化：接受对象或 JSON 字符串，任何坏数据都退化为该字段的默认值。
     *
     * 这条刻意不做「校验失败就整体丢弃」——用户存了半条偏好也不该让插件失灵；
     * 逐字段降级能保住其余选择。
     *
     * @param {unknown} raw - localStorage 读到的原始值（可能是字符串、对象或 null）。
     * @returns {ReturnType<typeof emptyState>} 合法状态。
     */
    function normalizeState(raw) {
      let parsed = raw;
      if (typeof raw === 'string') {
        try {
          parsed = raw === '' ? null : JSON.parse(raw);
        } catch (error) {
          parsed = null;
        }
      }
      if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
        return emptyState();
      }
      const source = /** @type {Record<string, unknown>} */ (parsed);
      // v1 的模型键是 `来源::模型` 拼接（有歧义）；v2 起改为 JSON 数组编码。
      // 【必须精确绑定版本】只有 v1 需要键迁移：v2 的 JSON 键（如 ["A::B","c"]）
      // 本身含 `::`，若对 v2/v3 数据再跑一次 migrateLegacyKey 会把键切坏。
      // v2→v3 只多了两个设置字段，normalizeState 逐字段降级会自动补默认值。
      const version = typeof source.version === 'number' ? source.version : 1;
      const needsKeyMigration = version < 2;
      const migrate = needsKeyMigration ? migrateLegacyKey : function (key) { return key; };
      const favorites = coerceStringArray(source.favorites, FAVORITES_CAP).map(migrate);
      const recents = coerceStringArray(source.recents, RECENTS_CAP).map(migrate);
      const hidden = coerceStringArray(source.hidden, 0).map(migrate);
      const rawAliases = coerceAliasMap(source.aliases);
      const aliases = {};
      if (needsKeyMigration) {
        for (const oldKey in rawAliases) aliases[migrateLegacyKey(oldKey)] = rawAliases[oldKey];
      } else {
        for (const key in rawAliases) aliases[key] = rawAliases[key];
      }
      return {
        version: STATE_VERSION,
        mode: isMode(source.mode) ? source.mode : DEFAULT_MODE,
        favorites: favorites,
        recents: recents,
        aliases: aliases,
        hidden: hidden,
        // v3+ 设置字段：缺省时补默认值（老数据没有这些项也照常工作）。
        fontSize: coerceFontSize(source.fontSize),
        groupSeries: source.groupSeries !== false,
        sortOrder: ['default', 'name', 'price-asc', 'price-desc'].includes(source.sortOrder) ? source.sortOrder : 'default',
        collapsedSeries: coerceStringArray(source.collapsedSeries, 256),
      };
    }

    /**
     * 序列化偏好（先规范化，落盘的永远是干净数据）。
     * @param {unknown} state - 任意状态。
     * @returns {string} JSON 字符串。
     */
    function serializeState(state) {
      return JSON.stringify(normalizeState(state));
    }

    /**
     * 在列表里切换一个值的存在性（置顶/隐藏共用）。
     * @param {string[]} list - 现有列表。
     * @param {string} value - 待切换值。
     * @param {number} cap - 上限（<=0 不限）。
     * @returns {string[]} 新列表（不改原数组）。
     */
    function toggleInList(list, value, cap) {
      const base = coerceStringArray(list, 0);
      const at = base.indexOf(value);
      if (at >= 0) {
        base.splice(at, 1);
        return base;
      }
      base.unshift(value);
      return cap > 0 ? base.slice(0, cap) : base;
    }

    /**
     * 从列表中移除一个值。
     * @param {string[]} list - 现有列表。
     * @param {string} value - 待移除值。
     * @returns {string[]} 新列表。
     */
    function removeFromList(list, value) {
      return coerceStringArray(list, 0).filter(function (item) {
        return item !== value;
      });
    }

    /**
     * 把一次选择压进「最近使用」（去重、置前、截断）。
     * @param {string[]} list - 现有最近列表。
     * @param {string} key - 刚选中的模型键。
     * @returns {string[]} 新列表。
     */
    function pushRecent(list, key) {
      const base = coerceStringArray(list, 0).filter(function (item) {
        return item !== key;
      });
      base.unshift(key);
      return base.slice(0, RECENTS_CAP);
    }

    /**
     * 取显示名：有别名用别名，否则用原名。
     * @param {Record<string,string>} aliases - 别名表。
     * @param {string} key - 模型键。
     * @param {string} fallback - 原名。
     * @returns {string} 显示名。
     */
    function resolveLabel(aliases, key, fallback) {
      if (aliases !== null && typeof aliases === 'object') {
        const alias = aliases[key];
        if (typeof alias === 'string' && alias.trim() !== '') return alias;
      }
      return fallback;
    }

    /**
     * 归一化查询串：去首尾空白、转小写。
     * @param {unknown} query - 原始查询。
     * @returns {string} 归一化结果。
     */
    function normalizeQuery(query) {
      return typeof query === 'string' ? query.trim().toLowerCase() : '';
    }

    /**
     * 子序列匹配（模糊搜索）：查询的字符按序出现在目标里即命中。
     *
     * 为什么用子序列而不是 includes：模型名很长（`DeepSeek-V4-Flash-Vision-Exp`），
     * 用户习惯只敲几个不连续的特征字母（`dsv4fv`）。这与内核自己的 `rankByName`
     * 排序思路一致，行为对用户是统一的。
     *
     * @param {string} haystack - 目标串（应已小写）。
     * @param {string} needle - 查询串（应已小写）。
     * @returns {boolean} 命中为 true。
     */
    function isSubsequence(haystack, needle) {
      if (needle === '') return true;
      let at = 0;
      for (let i = 0; i < haystack.length && at < needle.length; i++) {
        if (haystack.charAt(i) === needle.charAt(at)) at += 1;
      }
      return at === needle.length;
    }

    /**
     * 单条目标是否命中查询（同时看别名与原名）。
     * @param {{key:string,label:string,raw:string}} entry - 条目标识。
     * @param {Record<string,string>} aliases - 别名表。
     * @param {string} query - 已归一化查询。
     * @returns {boolean} 命中为 true。
     */
    function matchesQuery(entry, aliases, query) {
      if (query === '') return true;
      const alias = resolveLabel(aliases, entry.key, '');
      const haystacks = [String(entry.raw).toLowerCase(), String(alias).toLowerCase(), entryModelId(entry).toLowerCase()];
      for (let i = 0; i < haystacks.length; i++) {
        if (isSubsequence(haystacks[i], query)) return true;
      }
      return false;
    }

    /** Stable model IDs survive aliases and localized display labels. */
    function entryModelId(entry) {
      if (entry.modelId) return String(entry.modelId);
      try { const parts = JSON.parse(entry.key); return parts.length === 3 && parts[0] === 'id' ? String(parts[2]) : ''; } catch (error) { return ''; }
    }

    const SERIES_MATCHERS = [['DeepSeek', 'deepseek'], ['GPT', '(?:gpt|chatgpt|o[134](?=[-_.\\s]|$))'], ['Claude', 'claude'], ['Gemini', 'gemini'], ['Grok', 'grok'], ['Qwen', '(?:qwen|qwq)'], ['Kimi', '(?:kimi|moonshot)'], ['GLM', 'glm'], ['MiniMax', 'minimax'], ['MiMo', 'mimo'], ['Step', 'step'], ['Mistral', '(?:mistral|codestral|devstral|ministral)'], ['Doubao', 'doubao'], ['Hunyuan', '(?:hunyuan|hy[34])'], ['Llama', 'llama']].map(family => [family[0], new RegExp('(?:^|[/\\s_.-])' + family[1] + '(?=[0-9/\\s_.-]|$)', 'i')]);
    /** Match known families conservatively; never classify using a user alias. */
    function modelSeries(entry) {
      const names = [entryModelId(entry), entry.name || entry.raw || ''];
      for (const value of names) for (const family of SERIES_MATCHERS) {
        if (family[1].test(value)) return family[0];
      }
      return '其他';
    }

    /** Explicit free suffix is zero; a final arrow amount wins; unknown stays unknown. */
    function modelMultiplier(name) {
      const text = String(name);
      if (/(?:[·•]|→|->)\s*(?:免费|free)\s*$/i.test(text)) return 0;
      const matches = [...text.matchAll(/(?:^|[\s·•→]|->)[x×]\s*(\d+(?:\.\d+)?)(?![\d.])/gi)];
      const value = matches.length ? Number(matches[matches.length - 1][1]) : null;
      return value !== null && Number.isFinite(value) ? value : null;
    }

    function orderEntries(entries, order, query, aliases) {
      const list = entries.slice();
      if (order === 'default') {
        if (!query) return list;
        const byKey = new Map(list.map(entry => [entry.key, entry]));
        return rankEntries(list.map(entry => ({ key: entry.key, label: entry.label, raw: entry.name, modelId: entry.modelId })), aliases, query).map(entry => byKey.get(entry.key));
      }
      return list.map((entry, index) => ({ entry, index })).sort(function (a, b) {
        let difference = 0;
        if (order === 'name') difference = a.entry.label.localeCompare(b.entry.label, 'zh-CN', { numeric: true, sensitivity: 'base' });
        else {
          const left = modelMultiplier(a.entry.name), right = modelMultiplier(b.entry.name);
          if (left === null || right === null) difference = left === right ? 0 : left === null ? 1 : -1;
          else difference = (left - right) * (order === 'price-desc' ? -1 : 1);
        }
        return difference || a.index - b.index;
      }).map(item => item.entry);
    }

    /**
     * 排序：完全命中 > 前缀命中 > 子串命中 > 子序列命中；同级保持原序（稳定）。
     *
     * 排序键解释（分数越小越靠前）：
     *   0 —— 别名或原名与查询完全相同；
     *   1 —— 别名或原名以查询开头；
     *   2 —— 别名或原名包含查询；
     *   3 —— 只满足子序列（模糊命中）。
     *
     * @param {Array<{key:string,label:string,raw:string}>} entries - 候选条目（应已按查询过滤过）。
     * @param {Record<string,string>} aliases - 别名表。
     * @param {string} query - 已归一化查询。
     * @returns {Array<{key:string,label:string,raw:string,score:number}>} 带分数的副本（已排序）。
     */
    function rankEntries(entries, aliases, query) {
      const list = Array.isArray(entries) ? entries.slice() : [];
      if (list.length === 0) return [];
      const q = normalizeQuery(query);
      const scored = list.map(function (entry, index) {
        const probes = [resolveLabel(aliases, entry.key, '').toLowerCase(), String(entry.raw).toLowerCase(), entryModelId(entry).toLowerCase()];
        let best = 3;
        for (let i = 0; i < probes.length; i++) {
          const probe = probes[i];
          if (probe === '') continue;
          if (q === '' || probe === q) best = Math.min(best, 0);
          else if (probe.indexOf(q) === 0) best = Math.min(best, 1);
          else if (probe.indexOf(q) >= 0) best = Math.min(best, 2);
        }
        return { key: entry.key, label: entry.label, raw: entry.raw, score: best, index: index };
      });
      scored.sort(function (a, b) {
        if (a.score !== b.score) return a.score - b.score;
        return a.index - b.index;
      });
      return scored.map(function (item) {
        return { key: item.key, label: item.label, raw: item.raw, score: item.score };
      });
    }

    /**
     * 严格签名判定：这个 `div[role="menu"]` 到底是不是 composer 的模型菜单。
     *
     * 这是整个插件**唯一**的准入闸门，也是修掉社区版样式泄漏的关键。四个条件缺一不可：
     *
     *   · `isMenuRole`     —— 容器本身是 `role="menu"`（模型面板里那个 `div.groups`）；
     *   · `hasGroupSections` —— 直接子级有 `section[role="group"]`（有来源分组）；
     *   · `hasRadioItems`  —— 组内有 `button[role="menuitemradio"]`（是真的模型项）；
     *   · `insideListbox`  —— **必须为假**：`/model` 命令弹窗是 `role="listbox"`，它的
     *     分组虽然同样是 `MenuGroup`，但选项是 `div[role="option"]`，没有 menuitemradio。
     *
     * 为什么不能只靠 CSS：`/model` 弹窗与模型菜单共用 `MenuGroup` 原语，
     * 「标题选择器」在两处都匹配。社区版正是只用了 CSS，才把箭头和 hover 高亮
     * 泄漏进了 `/model` 弹窗。判定放进 JS，样式再统一挂到作用域属性下，
     * 泄漏就在物理上不可能发生。
     *
     * 同时天然排除了另外两个 pane：
     *   · root pane（「模型 / 推理等级」两个 cell）—— 没有 section，`hasGroupSections` 为假；
     *   · effort pane（推理等级）—— 扁平 menuitemradio，同样没有 section。
     *
     * @param {{isMenuRole:boolean,hasGroupSections:boolean,hasRadioItems:boolean,insideListbox:boolean}} signature - DOM 侧采集的签名。
     * @returns {boolean} 是模型菜单为 true。
     */
    function isModelMenuSignature(signature) {
      if (signature === null || typeof signature !== 'object') return false;
      if (signature.isMenuRole !== true) return false;
      if (signature.hasGroupSections !== true) return false;
      if (signature.hasRadioItems !== true) return false;
      if (signature.insideListbox === true) return false;
      return true;
    }

    /**
     * 循环切换模式：悬浮 ⇄ 侧边面板。
     * @param {string} mode - 当前模式。
     * @returns {string} 下一个模式。
     */
    function nextMode(mode) {
      const at = MODES.indexOf(mode);
      return MODES[((at < 0 ? 0 : at) + 1) % MODES.length];
    }

    /**
     * 原生来源分组是否折叠。
     *
     * 两种模式下**一律折叠**：来源列表只显示「来源 + 模型数」，具体模型由插件的
     * 侧边面板展示。早期还有第三种「列表内展开」模式需要按来源记忆展开状态，
     * 那个模式已移除（见 MODES 注释），这里也就不再需要状态。
     *
     * @returns {boolean} 恒为 true（原生列表始终折叠）。
     */
    function shouldCollapseByDefault() {
      return true;
    }

    // #endregion 纯逻辑

    // ─────────────────────────────────────────────────────────────────────
    // DOM 侧
    // ─────────────────────────────────────────────────────────────────────

    /** 注入样式表的键，便于按 id 复用与卸载。 */
    const STYLE_ID = 'dsh-model-organizer-style';
    /** 偏好存储键。 */
    const STORAGE_KEY = 'dsh-model-organizer-state-v1';
    /** 打在模型菜单上的作用域属性：所有 CSS 都挂在它之下。 */
    const SCOPE_ATTR = 'data-mo-scope';
    /** 打在来源分组上的属性：标记已处理。 */
    const SECTION_ATTR = 'data-mo-section';
    /** 折叠标记（原生模型项据此隐藏）。 */
    const COLLAPSED_ATTR = 'data-mo-collapsed';
    /** 隐藏单个模型的标记。 */
    const HIDDEN_ATTR = 'data-mo-hidden';
    /** 样式表所有者令牌属性：dispose 只在令牌属于自己时才删样式（防 HMR 误删活实例）。 */
    const STYLE_OWNER_ATTR = 'data-mo-style-owner';
    /** 面板根节点 id。 */
    const PANEL_ID = 'dsh-model-organizer-panel';

    /** 全局单例引用（热重载时先拆旧再建新）。 */
    let INSTANCE = null;
    let catalogContext = null;
    const buttonIdentities = new WeakMap();
    const providerIdentities = new WeakMap();

    /** 只读公共服务的缓存；不触发 load、RPC 或新网络请求。 */
    function catalogStore() {
      try {
        const resolver = catalogContext && (typeof catalogContext.get === 'function' ? catalogContext.get('modelDirectories') : catalogContext.modelDirectories);
        return resolver && resolver.catalog && resolver.catalog.store;
      } catch (error) { return null; }
    }

    function catalogGroups() {
      try {
        const store = catalogStore();
        const value = store && store.getSnapshot().value;
        return value && Array.isArray(value.groups) ? value.groups : [];
      } catch (error) { return []; }
    }

    function providerNames(group) {
      const names = [group.name, group.id].filter(function (name) { return typeof name === 'string'; });
      if (group.id === 'deepseek-account') {
        names.push('DeepSeek 账号', 'DeepSeek Account');
        try {
          if (catalogContext && catalogContext.locale && typeof catalogContext.locale.bind === 'function') names.push(catalogContext.locale.bind('model')('provider.account'));
        } catch (error) { /* 已知的 zh/en 名称仍可匹配。 */ }
      }
      return names;
    }

    // ─────────────────────────────────────────────────────────────────────
    // 设置桥（DOM 增强 ↔ React 设置卡）
    //
    // 两边都读写同一份 localStorage 偏好，但运行在两个世界：
    //   · DOM 增强（start()）在菜单打开时读写；
    //   · 设置卡（React 组件，渲染在插件管理页）在用户改设置时读写。
    // 靠一个模块级 pub/sub 同步：任何一方 saveState 后 publish，另一方收到就
    // 重读并刷新。为什么不用 `storage` 事件：那个事件**只在其他标签页**写入时
    // 触发，同一页面内的写入不会收到 —— 两个世界在同一页面里，必须自己广播。
    // ─────────────────────────────────────────────────────────────────────

    /** 偏好订阅者集合。 */
    const settingsListeners = new Set();

    /** 读当前偏好（容忍坏数据）。 */
    function readState() {
      try {
        return normalizeState(window.localStorage.getItem(STORAGE_KEY));
      } catch (error) {
        return emptyState();
      }
    }

    /**
     * 写偏好并广播。
     * @param {object} next - 待写入的状态（会先规范化）。
     */
    function writeState(next) {
      try {
        window.localStorage.setItem(STORAGE_KEY, serializeState(next));
      } catch (error) {
        /* 隐私模式写不进去，本次会话内仍可用 */
      }
      broadcastState();
    }

    /** 向所有订阅者广播「偏好已变」。 */
    function broadcastState() {
      for (const listener of Array.from(settingsListeners)) {
        try {
          listener();
        } catch (error) {
          /* 单个订阅者抛错不该中断其余订阅者 */
        }
      }
    }

    /**
     * 订阅偏好变化。
     * @param {() => void} listener - 回调。
     * @returns {() => void} 退订函数。
     */
    function subscribeSettings(listener) {
      settingsListeners.add(listener);
      return function () {
        settingsListeners.delete(listener);
      };
    }

    /**
     * 样式：**每一条都挂在 `[data-mo-scope="1"]` 之下**。
     *
     * 这是与社区版最关键的结构差异。作用域属性只由 JS 在签名判定通过后打上，
     * 于是「模型菜单之外的任何元素」都不可能被这些规则命中 —— `/model` 弹窗
     * 的分组标题不会多出箭头，也不会变成手型光标。
     *
     * 颜色一律走官方 `--dsw-*` 令牌：换肤/深浅主题自动跟随，令牌改名最多掉色不会崩。
     *
     * @returns {string} 完整 CSS 文本。
     */
    function buildSettingsCss() {
      return [
        '.mo-settings{display:grid;gap:16px;color:var(--dsw-alias-label-primary,inherit);font-size:13px;line-height:1.5;}',
        '.mo-settings .mo-card{border:1px solid var(--dsw-alias-border-l2,rgba(127,127,127,.18));border-radius:12px;padding:16px;display:grid;gap:12px;}',
        '.mo-settings .mo-setting-row{display:flex;align-items:center;justify-content:space-between;gap:16px;flex-wrap:wrap;}',
        '.mo-settings .mo-setting-text{display:grid;gap:4px;flex:1;min-width:180px;}',
        '.mo-settings .mo-title{font-weight:600;font-size:13px;}',
        '.mo-settings .mo-hint{font-size:12px;color:var(--dsw-alias-label-tertiary,#9aa0a8);line-height:1.6;}',
        '.mo-settings .mo-options{display:flex;gap:4px;padding:3px;border-radius:9px;background:var(--dsw-alias-interactive-bg-hover,rgba(127,127,127,.08));}',
        '.mo-settings button{font:inherit;font-size:12px;min-height:32px;padding:6px 12px;border:1px solid var(--dsw-alias-border-l2,rgba(127,127,127,.18));border-radius:7px;background:transparent;color:inherit;cursor:pointer;}',
        '.mo-settings button:disabled{opacity:.45;cursor:default;}',
        '.mo-settings button:focus-visible,.mo-settings summary:focus-visible{outline:2px solid var(--dsw-alias-brand-primary,#6d91ff);outline-offset:3px;}',
        '.mo-settings .mo-options button{border-color:transparent;min-width:46px;}',
        '.mo-settings .mo-options button[aria-pressed="true"]{background:var(--dsw-alias-interactive-bg-active,rgba(127,127,127,.18));color:var(--dsw-alias-brand-primary,#6d91ff);font-weight:600;}',
        '.mo-settings .mo-preview{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:12px 14px;border-radius:9px;background:var(--dsw-alias-interactive-bg-hover,rgba(127,127,127,.07));}',
        '.mo-settings .mo-preview-star{color:var(--dsw-alias-brand-primary,#6d91ff);font-size:17px;}',
        '.mo-settings select{font:inherit;font-size:12px;padding:6px 8px;max-width:180px;border:1px solid var(--dsw-alias-border-l2,rgba(127,127,127,.18));border-radius:7px;background:var(--dsw-alias-bg-layer-2,#292a2e);color:inherit;}',
        '.mo-settings [role="switch"][aria-checked="true"]{color:var(--dsw-alias-brand-primary,#6d91ff);background:var(--dsw-alias-interactive-bg-hover,rgba(127,127,127,.08));}',
        '.mo-settings .mo-tree-preview{padding:10px 12px;border-radius:8px;background:var(--dsw-alias-interactive-bg-hover,rgba(127,127,127,.07));font-size:12px;line-height:1.9;}',
        '.mo-settings .mo-tree-model{padding-left:16px;}',
        '.mo-settings .mo-stats{display:flex;gap:8px;flex-wrap:wrap;}',
        '.mo-settings .mo-stat{display:flex;align-items:baseline;gap:6px;padding:7px 10px;border-radius:7px;background:var(--dsw-alias-interactive-bg-hover,rgba(127,127,127,.07));}',
        '.mo-settings .mo-stat strong{font-variant-numeric:tabular-nums;font-size:15px;font-weight:600;}',
        '.mo-settings .mo-danger{color:var(--dsw-alias-label-error,#e5484d);}',
        '.mo-settings .mo-confirm{display:grid;gap:10px;padding-top:12px;border-top:1px solid var(--dsw-alias-border-l2,rgba(127,127,127,.18));}',
        '.mo-settings .mo-actions{display:flex;gap:8px;flex-wrap:wrap;}',
        '.mo-settings details summary{cursor:pointer;font-weight:500;}',
        '.mo-settings .mo-help{display:grid;gap:8px;padding-top:12px;}',
      ].join('\n');
    }

    function buildCss() {
      const scope = '[' + SCOPE_ATTR + '="1"]';
      return [
        // ── 原生菜单：可滚动（仍在内核原有视觉语言内） ──
        scope + '{max-height:70vh;overflow-y:auto;}',
        scope + '[data-mo-anchor]{top:var(--mo-menu-top) !important;left:var(--mo-menu-left) !important;}',
        // 【刻意不动内核自带的搜索框】
        // 早期版本这里写过 `scope > .searchRow{display:none;}`，两个问题：
        //   1) 内核的类名是 **CSS Module 哈希**（真实值形如 `cl2Rlq_searchRow`），
        //      `.searchRow` 这个选择器**永远匹配不上**，是死代码；
        //   2) 即便写对也不该隐藏 —— 那是宿主自己的功能，模型数 >4 时它才出现，
        //      而「保存/恢复」宿主能力是插件不该越界的事。
        // 插件的搜索在**自己的面板**里，两者并存，互不干扰。
        scope + ' section[role="group"] > [data-menu-group-heading]{',
        'box-sizing:border-box;display:flex;align-items:center;gap:8px;',
        'min-height:36px;padding:7px 10px;',
        'border-radius:var(--dsw-radius-md,7px);',
        'font-weight:500;cursor:pointer;user-select:none;transition:background 120ms ease;',
        '}',
        scope + ' section[role="group"] > [data-menu-group-heading]:hover{',
        'background:var(--dsw-alias-interactive-bg-hover,rgba(127,127,127,.12));',
        '}',
        // 分组标题右侧的「模型数 / 当前」徽标
        scope + ' section[role="group"] > [data-menu-group-heading]::after{',
        'content:attr(data-mo-badge);margin-left:auto;flex:0 0 auto;',
        'font-size:.8em;font-weight:500;white-space:nowrap;padding:1px 6px;border-radius:5px;',
        'color:var(--dsw-alias-label-tertiary,#9aa0a8);background:var(--dsw-alias-interactive-bg-hover,rgba(127,127,127,.1));',
        '}',
        scope + ' section[role="group"] > [data-menu-group-heading][data-mo-current]{',
        'font-weight:600;color:var(--dsw-alias-label-primary,inherit);',
        'background:var(--dsw-alias-interactive-bg-hover,rgba(127,127,127,.1));',
        '}',
        // 折叠时隐藏该来源的原生模型项（属性驱动，不碰 React 节点）
        scope + ' section[role="group"][' + COLLAPSED_ATTR + '] > button[role="menuitemradio"]{display:none !important;}',
        // 被用户隐藏的模型：任何模式下都不出现
        scope + ' button[role="menuitemradio"][' + HIDDEN_ATTR + ']{display:none !important;}',
        scope + ' section[data-mo-provider-filtered]{display:none !important;}',
        scope + '[data-mo-empty-providers]::after{content:"没有匹配的厂商";display:block;padding:18px 12px;font-size:13px;color:var(--dsw-alias-label-tertiary,#9aa0a8);}',
        // ── 插件自建侧边面板 ──
        '#' + PANEL_ID + '{',
        'position:fixed;z-index:2147483000;display:flex;flex-direction:column;',
        'box-sizing:border-box;width:360px;max-width:calc(100vw - 16px);max-height:70vh;',
        '--mo-accent:var(--dsw-alias-label-link,#7399f5);',
        'background:var(--dsw-alias-bg-layer-3,var(--dsw-alias-bg-layer-2,#26272c));',
        'color:var(--dsw-alias-label-primary,#f0f2f5);',
        'border:1px solid var(--dsw-alias-border-l2,rgba(127,127,127,.2));',
        'border-radius:14px;',
        'box-shadow:0 12px 36px rgba(0,0,0,.18),0 2px 8px rgba(0,0,0,.08);',
        'padding:12px;gap:10px;font-family:inherit;font-size:var(--mo-fs,13px);line-height:1.5;',
        '}',
        '#' + PANEL_ID + '[hidden]{display:none;}',
        '#' + PANEL_ID + ' .mo-btn[hidden]{display:none;}',
        // 头部允许换行：模式按钮改成完整双字词后更宽，窄面板下宁可换到第二行，
        // 也不要挤压标题或把按钮截断。
        '#' + PANEL_ID + ' .mo-head{display:flex;align-items:center;gap:8px;flex-shrink:0;}',
        '#' + PANEL_ID + ' .mo-title{font-weight:600;font-size:1.08em;flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}',
        '#' + PANEL_ID + ' .mo-toolbar{display:flex;align-items:center;justify-content:space-between;gap:8px;flex-wrap:wrap;flex-shrink:0;}',
        '#' + PANEL_ID + ' .mo-summary{font-size:.85em;color:var(--dsw-alias-label-tertiary,#9aa0a8);}',
        '#' + PANEL_ID + ' .mo-browse-tools{display:flex;align-items:center;justify-content:space-between;gap:8px;flex-shrink:0;flex-wrap:wrap;}',
        '#' + PANEL_ID + ' .mo-scope{display:flex;gap:2px;padding:2px;border-radius:8px;background:var(--dsw-alias-interactive-bg-hover,rgba(127,127,127,.08));}',
        '#' + PANEL_ID + ' .mo-scope .mo-btn{min-height:28px;padding:4px 8px;font-size:.82em;border:0;}',
        '#' + PANEL_ID + ' .mo-scope [aria-pressed="true"]{background:var(--dsw-alias-interactive-bg-active,rgba(127,127,127,.16));color:var(--mo-accent);}',
        '#' + PANEL_ID + ' .mo-scope button:disabled{opacity:.4;cursor:default;}',
        '#' + PANEL_ID + ' .mo-sort{max-width:100%;min-height:30px;padding:4px 6px;font:inherit;font-size:.82em;border-radius:7px;border:1px solid var(--dsw-alias-border-l2,rgba(127,127,127,.18));background:var(--dsw-alias-bg-layer-2,#292a2e);color:inherit;}',
        '#' + PANEL_ID + ' .mo-sort option{background:var(--dsw-alias-bg-layer-2,#292a2e);color:var(--dsw-alias-label-primary,#eee);}',
        '#' + PANEL_ID + ' .mo-result-provider,#' + PANEL_ID + ' .mo-provider-models{margin:0;padding:0;flex-shrink:0;min-width:0;}',
        '#' + PANEL_ID + ' .mo-provider-heading{display:flex;align-items:center;gap:8px;padding:9px 10px 5px;font-size:.9em;font-weight:600;}',
        '#' + PANEL_ID + ' .mo-result-provider + .mo-result-provider{border-top:1px solid var(--dsw-alias-border-l2,rgba(127,127,127,.14));margin-top:6px;padding-top:4px;}',
        '#' + PANEL_ID + ' .mo-result-provider > .mo-model-line,#' + PANEL_ID + ' .mo-result-provider > .mo-edit-row{margin-left:16px;}',
        '#' + PANEL_ID + ' .mo-series-heading{display:flex;align-items:center;gap:6px;min-height:30px;width:100%;padding:5px 10px;border:0;border-radius:6px;background:transparent;color:var(--dsw-alias-label-secondary,#b5b9c2);font:inherit;font-size:.85em;text-align:left;cursor:pointer;}',
        '#' + PANEL_ID + ' .mo-series-heading:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(127,127,127,.1));}',
        '#' + PANEL_ID + ' .mo-series-heading .mo-chevron{width:12px;height:12px;transform:rotate(90deg);}',
        '#' + PANEL_ID + ' .mo-series-heading[aria-expanded="false"] .mo-chevron{transform:none;}',
        '#' + PANEL_ID + ' .mo-group-count{font-size:.88em;opacity:.55;font-variant-numeric:tabular-nums;}',
        '#' + PANEL_ID + ' .mo-series-models{margin-left:16px;min-width:0;}',
        '#' + PANEL_ID + ' .mo-series-models[hidden]{display:none!important;}',
        '#' + PANEL_ID + ' .mo-result-provider > .mo-series{margin-left:8px;}',
        '#' + PANEL_ID + ' .mo-label-line{display:flex;align-items:center;gap:6px;min-width:0;}',
        '#' + PANEL_ID + ' .mo-label-line .mo-row-name{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}',
        '#' + PANEL_ID + ' .mo-alias-mark{flex:none;font-size:.85em;opacity:.5;font-weight:400;}',
        '#' + PANEL_ID + ' .mo-filters{display:flex;gap:4px;flex-shrink:0;}',
        '#' + PANEL_ID + ' .mo-filters[hidden],#' + PANEL_ID + ' .mo-alias-editor[hidden]{display:none;}',
        '#' + PANEL_ID + ' .mo-filters .mo-btn{font-size:.85em;}',
        '#' + PANEL_ID + ' .mo-alias-editor{display:flex;align-items:center;gap:6px;padding:6px 10px 10px;}',
        '#' + PANEL_ID + ' .mo-alias-editor .mo-alias-input{flex:1;min-width:0;width:auto;margin:0;}',
        '#' + PANEL_ID + ' .mo-rename{font-size:.85em;color:var(--dsw-alias-label-secondary,#b5b9c2);}',
        '#' + PANEL_ID + ' .mo-restore{font-size:.85em;color:var(--mo-accent);}',
        '#' + PANEL_ID + ' .mo-edit-row[data-hidden="1"] .mo-row-name{color:var(--dsw-alias-label-tertiary,#9aa0a8);}',
        '#' + PANEL_ID + ' .mo-icon{width:16px;height:16px;flex:0 0 auto;pointer-events:none;}',
        '#' + PANEL_ID + ' .mo-iconbtn{width:28px;padding:0;color:var(--dsw-alias-label-secondary,#b5b9c2);}',
        '#' + PANEL_ID + ' .mo-btn{',
        'box-sizing:border-box;display:inline-flex;align-items:center;justify-content:center;gap:4px;',
        'min-height:28px;padding:4px 8px;border:none;border-radius:6px;',
        'background:transparent;color:inherit;font:inherit;cursor:pointer;',
        'transition:background 120ms ease,color 120ms ease;',
        '}',
        // 模式按钮：给完整双字词留够宽度，并让「当前模式」一眼可辨。
        '#' + PANEL_ID + ' .mo-btn:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(127,127,127,.16));}',
        '#' + PANEL_ID + ' .mo-btn[data-on="1"]{color:var(--mo-accent);background:color-mix(in srgb,var(--mo-accent) 12%,transparent);}',
        '#' + PANEL_ID + ' .mo-managebtn{gap:6px;font-size:.9em;color:var(--dsw-alias-label-secondary,#b5b9c2);}',
        '#' + PANEL_ID + ' .mo-search-wrap{position:relative;display:flex;align-items:center;flex-shrink:0;}',
        '#' + PANEL_ID + ' .mo-search-wrap > .mo-icon{position:absolute;left:10px;color:var(--dsw-alias-label-tertiary,#9aa0a8);}',
        '#' + PANEL_ID + ' .mo-clear{position:absolute;right:5px;}',
        '#' + PANEL_ID + ' .mo-clear[hidden],#' + PANEL_ID + ' .mo-all[hidden]{display:none;}',
        '#' + PANEL_ID + ' .mo-search{',
        'box-sizing:border-box;width:100%;min-height:36px;padding:7px 36px 7px 34px;',
        'border:1px solid var(--dsw-alias-border-l2,rgba(127,127,127,.2));',
        'border-radius:8px;',
        'background:var(--dsw-alias-bg-layer-2,transparent);color:inherit;font:inherit;outline:none;',
        '}',
        '#' + PANEL_ID + ' input::placeholder{color:var(--dsw-alias-label-tertiary,#9aa0a8);}',
        '#' + PANEL_ID + ' input:focus-visible{border-color:var(--mo-accent);box-shadow:0 0 0 2px color-mix(in srgb,var(--mo-accent) 15%,transparent);}',
        '#' + PANEL_ID + ' button:focus-visible{outline:2px solid var(--mo-accent);outline-offset:-2px;}',
        '#' + PANEL_ID + ' .mo-list{overflow-y:auto;overscroll-behavior:contain;display:flex;flex-direction:column;gap:3px;min-height:0;padding:2px;scrollbar-width:thin;scrollbar-color:var(--dsw-alias-border-l2,#666) transparent;}',
        '#' + PANEL_ID + ' .mo-group-label{',
        'padding:10px 10px 4px;font-size:.82em;font-weight:500;letter-spacing:.03em;',
        'color:var(--dsw-alias-label-tertiary,#9aa0a8);',
        '}',
        '#' + PANEL_ID + ' .mo-row{',
        'box-sizing:border-box;display:flex;align-items:center;gap:6px;width:100%;',
        'min-height:38px;padding:8px 10px;border:none;border-radius:8px;flex-shrink:0;',
        'background:transparent;color:inherit;font:inherit;text-align:left;cursor:pointer;',
        'transition:background 120ms ease;',
        '}',
        '#' + PANEL_ID + ' .mo-row:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(127,127,127,.16));}',
        '#' + PANEL_ID + ' .mo-row[data-selected="1"]{background:color-mix(in srgb,var(--mo-accent) 10%,transparent);font-weight:500;}',
        '#' + PANEL_ID + ' .mo-selected{color:var(--mo-accent);margin-left:4px;}',
        '#' + PANEL_ID + ' .mo-model-line{display:flex;align-items:center;gap:2px;padding-right:6px;flex-shrink:0;border-radius:8px;transition:background 120ms ease;}',
        '#' + PANEL_ID + ' .mo-model-line > .mo-row{flex:1;min-width:0;width:auto;}',
        // 高亮以整行为单位，让星标与模型名称处在同一块背景里。
        '#' + PANEL_ID + ' .mo-model-line > .mo-row:hover,#' + PANEL_ID + ' .mo-model-line > .mo-row[data-selected="1"]{background:transparent;}',
        '#' + PANEL_ID + ' .mo-model-line:hover,#' + PANEL_ID + ' .mo-model-line:focus-within{background:var(--dsw-alias-interactive-bg-hover,rgba(127,127,127,.12));}',
        '#' + PANEL_ID + ' .mo-model-line[data-selected="1"]{background:color-mix(in srgb,var(--mo-accent) 10%,transparent);}',
        '#' + PANEL_ID + ' .mo-model-line[data-selected="1"]:hover{background:color-mix(in srgb,var(--mo-accent) 14%,transparent);}',
        // 置顶是轻量状态标记，不沿用筛选按钮的大块蓝底。
        '#' + PANEL_ID + ' .mo-pinbtn{color:var(--dsw-alias-label-tertiary,#9aa0a8);}',
        '#' + PANEL_ID + ' .mo-pinbtn .mo-icon{width:14px;height:14px;}',
        '#' + PANEL_ID + ' .mo-pinbtn[data-on="1"]{color:var(--mo-accent);background:transparent;}',
        '#' + PANEL_ID + ' .mo-pinbtn[data-on="1"] .mo-icon{fill:currentColor;stroke-width:1.3;}',
        '#' + PANEL_ID + ' .mo-pinbtn:hover,#' + PANEL_ID + ' .mo-pinbtn[data-on="1"]:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(127,127,127,.16));}',
        '#' + PANEL_ID + ' .mo-quick-pin{opacity:0;}',
        '#' + PANEL_ID + ' .mo-model-line:hover .mo-quick-pin,#' + PANEL_ID + ' .mo-model-line:focus-within .mo-quick-pin,#' + PANEL_ID + ' .mo-quick-pin[data-on="1"]{opacity:1;}',
        '@media (hover:none){#' + PANEL_ID + ' .mo-quick-pin{opacity:1;}}',
        '#' + PANEL_ID + ' .mo-count{font-size:.82em;font-variant-numeric:tabular-nums;padding:1px 6px;border-radius:5px;color:var(--dsw-alias-label-tertiary,#9aa0a8);background:var(--dsw-alias-interactive-bg-hover,rgba(127,127,127,.1));}',
        '#' + PANEL_ID + ' .mo-chevron{color:var(--dsw-alias-label-tertiary,#9aa0a8);width:14px;height:14px;}',
        // 不可用（内核忙）：降低不透明度 + 不显示手型光标，并去掉 hover 高亮 ——
        // 让「现在点不了」肉眼可见，而不是点了毫无反应。
        '#' + PANEL_ID + ' .mo-row[data-disabled="1"]{opacity:.5;cursor:default;}',
        '#' + PANEL_ID + ' .mo-row[data-disabled="1"]:hover{background:transparent;}',
        '#' + PANEL_ID + ' .mo-row-main{flex:1;min-width:0;display:flex;flex-direction:column;gap:2px;}',
        '#' + PANEL_ID + ' .mo-row-name{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}',
        '#' + PANEL_ID + ' .mo-row-sub{font-size:.8em;color:var(--dsw-alias-label-tertiary,#9aa0a8);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}',
        '#' + PANEL_ID + ' .mo-empty{padding:24px 12px;text-align:center;color:var(--dsw-alias-label-tertiary,#9aa0a8);}',
        '#' + PANEL_ID + ' .mo-actions{display:flex;align-items:center;gap:2px;flex:0 0 auto;}',
        '#' + PANEL_ID + ' .mo-edit-row{flex-shrink:0;border-radius:8px;}',
        '#' + PANEL_ID + ' .mo-edit-row[data-editing="1"]{background:var(--dsw-alias-bg-layer-2,rgba(127,127,127,.08));}',
        '#' + PANEL_ID + ' .mo-alias-input{',
        'box-sizing:border-box;width:calc(100% - 20px);margin:3px 10px 0;min-height:30px;padding:5px 8px;font-size:.9em;',
        'border:1px solid var(--dsw-alias-border-l2,rgba(127,127,127,.28));',
        'border-radius:var(--dsw-radius-sm,6px);',
        'background:var(--dsw-alias-bg-layer-2,transparent);color:inherit;font:inherit;outline:none;',
        '}',
        '#' + PANEL_ID + ' .mo-foot{display:flex;align-items:center;gap:8px;flex-wrap:wrap;padding-top:8px;border-top:1px solid var(--dsw-alias-border-l2,rgba(127,127,127,.14));flex-shrink:0;}',
        // `hidden` 只是 UA 的 display:none，会被上面的 display:flex 覆盖 —— 必须显式关掉。
        '#' + PANEL_ID + ' .mo-foot[hidden]{display:none;}',
        '#' + PANEL_ID + ' .mo-hint{font-size:.8em;color:var(--dsw-alias-label-tertiary,#9aa0a8);margin-left:auto;}',
        // Two compact rows: title/actions, then scope inside the search field.
        '#' + PANEL_ID + '{padding:10px;gap:8px;}',
        '#' + PANEL_ID + ' .mo-head{gap:4px;min-height:28px;}',
        '#' + PANEL_ID + ' .mo-head .mo-btn{min-height:28px;padding:4px 6px;}',
        '#' + PANEL_ID + ' .mo-head .mo-iconbtn{width:28px;height:28px;flex:0 0 28px;padding:5px;}',
        '#' + PANEL_ID + ' .mo-head .mo-summary{font-size:.76em;white-space:nowrap;max-width:100px;overflow:hidden;text-overflow:ellipsis;}',
        '#' + PANEL_ID + ' .mo-title{font-size:1em;}',
        '#' + PANEL_ID + ' .mo-sr-only{position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;border:0;}',
        '#' + PANEL_ID + ' .mo-search-wrap{display:flex;align-items:center;gap:5px;padding:3px 4px;border:1px solid var(--dsw-alias-border-l2,rgba(127,127,127,.2));border-radius:8px;background:var(--dsw-alias-bg-layer-2,transparent);}',
        '#' + PANEL_ID + ' .mo-search-wrap:focus-within{border-color:var(--mo-accent);box-shadow:0 0 0 2px color-mix(in srgb,var(--mo-accent) 15%,transparent);}',
        '#' + PANEL_ID + ' .mo-search-wrap .mo-search{flex:1;min-width:0;width:0;min-height:28px;padding:3px 5px;border:0;background:transparent;box-shadow:none;font-size:.92em;}',
        '#' + PANEL_ID + ' .mo-search-wrap .mo-clear{position:static;flex:0 0 24px;width:24px;min-height:24px;padding:4px;transform:none;}',
        '#' + PANEL_ID + ' .mo-search-wrap .mo-scope{flex:none;gap:1px;padding:1px;background:transparent;border-right:1px solid var(--dsw-alias-border-l2,rgba(127,127,127,.18));border-radius:0;padding-right:5px;}',
        '#' + PANEL_ID + ' .mo-scope .mo-btn{font-size:.8em;padding:3px 6px;min-height:24px;}',
        '#' + PANEL_ID + ' .mo-sort-menu{position:absolute;right:10px;top:42px;z-index:5;display:grid;gap:2px;min-width:140px;padding:5px;border-radius:9px;border:1px solid var(--dsw-alias-border-l2,rgba(127,127,127,.2));background:var(--dsw-alias-bg-layer-3,#303136);box-shadow:0 8px 24px #0004;}',
        '#' + PANEL_ID + ' .mo-sort-menu[hidden]{display:none;}',
        '#' + PANEL_ID + ' .mo-sort-menu .mo-btn{text-align:left;min-height:30px;padding:5px 10px;font-size:.9em;}',
        '#' + PANEL_ID + ' .mo-sort-menu [aria-pressed="true"]{background:var(--dsw-alias-interactive-bg-active,rgba(127,127,127,.18));color:var(--mo-accent);}',
      ].join('\n');
    }

    /**
     * 注入/刷新样式表。按 id 复用，避免重复 apply 时叠加多份。
     * @param {Document} doc - 目标文档。
     */
    /**
     * 注入/刷新样式表，并返回**本实例对该样式表的所有权令牌**。
     *
     * 【为什么需要令牌】样式表按全局 id 复用（重复 apply 不叠加），但 dispose 若
     * 只按 id 删除就会出事：HMR 时新实例先 boot（拆旧实例 → 建新实例 → 刷新样式），
     * 宿主**随后**才拆旧的 cordis effect —— 旧 disposer 按 id 一删，删掉的是
     * **新实例正在用的**样式表，于是活实例的面板/启动按钮全部失去样式
     * （面板存在但裸奔、折叠与隐藏规则一并消失）。
     *
     * 所以每次 ensureStyle 都把令牌写到样式表上，dispose 只在令牌仍属于自己时才删。
     *
     * @param {Document} doc - 目标文档。
     * @param {string} token - 本实例的所有权令牌。
     */
    function ensureStyle(doc, token) {
      let style = doc.getElementById(STYLE_ID);
      if (style === null) {
        style = doc.createElement('style');
        style.id = STYLE_ID;
        (doc.head || doc.documentElement).appendChild(style);
      }
      // DSH claims unowned styles for the next materialized module, then removes
      // them with that module. The instance token alone does not identify our package.
      style.setAttribute('data-plugin', 'dsh-model-organizer');
      style.setAttribute(STYLE_OWNER_ATTR, token);
      style.textContent = buildCss();
    }

    /** 简易元素构造：`el('div', {class:'x'}, [child])`。 */
    function el(doc, tag, props, children) {
      const node = doc.createElement(tag);
      if (props) {
        const keys = Object.keys(props);
        for (let i = 0; i < keys.length; i++) {
          const key = keys[i];
          const value = props[key];
          if (value === null || value === undefined || value === false) continue;
          if (key === 'class') node.className = String(value);
          else if (key === 'text') node.textContent = String(value);
          else if (key === 'style') node.setAttribute('style', String(value));
          else node.setAttribute(key, value === true ? '' : String(value));
        }
      }
      if (children) {
        for (let i = 0; i < children.length; i++) {
          if (children[i]) node.appendChild(children[i]);
        }
      }
      return node;
    }

    /** 统一 16px 线条图标；只创建插件自己的 SVG，不依赖字体或外部资源。 */
    function icon(doc, name, extraClass) {
      const paths = {
        overview: ['M3 3h7v7H3zM14 3h7v7h-7zM3 14h7v7H3zM14 14h7v7h-7z'],
        close: ['M6 6l12 12M18 6L6 18'],
        search: ['M21 21l-5-5', 'M18 10a8 8 0 1 1-16 0 8 8 0 0 1 16 0'],
        manage: ['M4 7h16M4 17h16', 'M9 4v6M15 14v6'],
        sort: ['M4 6h16M4 12h11M4 18h6', 'M18 11v9m-3-3 3 3 3-3'],
        check: ['M5 12l4 4L19 6'],
        chevron: ['M9 5l7 7-7 7'],
        star: ['M12 3l2.8 5.7 6.2.9-4.5 4.4 1.1 6.2-5.6-2.9-5.6 2.9 1.1-6.2L3 9.6l6.2-.9z'],
        hide: ['M3 3l18 18M10.6 10.6a2 2 0 0 0 2.8 2.8M9.9 5.2A11 11 0 0 1 12 5c5 0 9 7 9 7a17 17 0 0 1-2.5 3.2M6.2 6.2C4.2 7.6 3 10 3 12c0 0 4 7 9 7a10 10 0 0 0 4.8-1.4'],
      };
      const svg = doc.createElementNS('http://www.w3.org/2000/svg', 'svg');
      svg.setAttribute('viewBox', '0 0 24 24');
      svg.setAttribute('class', 'mo-icon' + (extraClass ? ' ' + extraClass : ''));
      svg.setAttribute('fill', 'none');
      svg.setAttribute('stroke', 'currentColor');
      svg.setAttribute('stroke-width', '1.7');
      svg.setAttribute('stroke-linecap', 'round');
      svg.setAttribute('stroke-linejoin', 'round');
      svg.setAttribute('aria-hidden', 'true');
      svg.setAttribute('focusable', 'false');
      (paths[name] || paths.overview).forEach(function (d) {
        const path = doc.createElementNS('http://www.w3.org/2000/svg', 'path');
        path.setAttribute('d', d);
        svg.appendChild(path);
      });
      return svg;
    }

    /**
     * 是否是「文本输入类」元素。
     *
     * 面板里的搜索框与别名输入框需要拿到焦点才能打字，绝不能被 preventDefault
     * 拦掉默认动作；其余面板控件则要拦住焦点的转移（见 onMouseDown）。
     *
     * @param {Element} node - 落点元素。
     * @returns {boolean} 是输入类为 true。
     */
    function isTextEntry(node) {
      if (!node || typeof node.tagName !== 'string') return false;
      const tag = node.tagName.toLowerCase();
      if (tag === 'textarea' || tag === 'select') return true;
      if (tag !== 'input') return false;
      const type = (node.getAttribute('type') || 'text').toLowerCase();
      return type === 'text' || type === 'search' || type === 'url' || type === 'email' || type === 'password' || type === 'number';
    }

    /** 从元素向上找最近的匹配祖先（含自身）。 */
    function closest(selector, node) {
      let cur = node;
      while (cur && cur.nodeType === 1) {
        if (typeof cur.matches === 'function' && cur.matches(selector)) return cur;
        cur = cur.parentElement;
      }
      return null;
    }

    /** 采集判定所需的签名（纯 DOM 读取，不做任何写入）。 */
    function readSignature(menu) {
      const sections = menu.querySelectorAll('section[role="group"]');
      let hasSection = false;
      let hasRadio = false;
      for (let i = 0; i < sections.length; i++) {
        const section = sections[i];
        if (section.querySelector('[data-menu-group-heading]') !== null) hasSection = true;
        if (section.querySelector('button[role="menuitemradio"]') !== null) hasRadio = true;
        if (hasSection && hasRadio) break;
      }
      return {
        isMenuRole: menu.getAttribute('role') === 'menu',
        hasGroupSections: hasSection,
        hasRadioItems: hasRadio,
        insideListbox: closest('[role="listbox"]', menu) !== null,
      };
    }

    /** 读取某个来源分组的标题元素。 */
    function headingOf(section) {
      return section.querySelector(':scope > [data-menu-group-heading]');
    }

    /** 读取某个来源分组的显示名。 */
    function providerLabelOf(section) {
      const heading = headingOf(section);
      if (heading === null) return '';
      return (heading.textContent || '').trim();
    }

    /** 读取某个来源分组里的原生模型项。 */
    function itemsOf(section) {
      return Array.prototype.slice.call(section.querySelectorAll('button[role="menuitemradio"]'));
    }

    /** 读一个原生模型项的显示名（内核把模型名写在 title 上，最可靠）。 */
    function modelNameOf(button) {
      const title = button.getAttribute('title');
      if (title !== null && title.trim() !== '') return title.trim();
      const nameNode = button.querySelector('[class*="modelName"]');
      if (nameNode !== null) return (nameNode.textContent || '').trim();
      return (button.textContent || '').trim();
    }

    /** 读一个原生模型项是否选中。 */
    function isChecked(button) {
      return button.getAttribute('aria-checked') === 'true';
    }

    /**
     * 把 DOM 读成结构化快照：来源 + 模型 + 选中态。
     * DOM 保留真实选择按钮；稳定身份从公共服务的目录缓存读取，不复制会话选择状态。
     * @param {Element} menu - 作用域内的模型菜单容器。
     * @returns {{providers:Array<{key:string,label:string,items:Array<{key:string,name:string,button:Element,selected:boolean}>}>,selectedKey:string|null,choices:number}} 快照。
     */
    function readSnapshot(menu) {
      const sections = Array.prototype.slice.call(menu.querySelectorAll('section[role="group"]'));
      const providers = [];
      let choices = 0;
      let selectedKey = null;
      const catalog = catalogGroups();
      for (let i = 0; i < sections.length; i++) {
        const section = sections[i];
        const label = providerLabelOf(section);
        if (label === '') continue;
        const buttons = itemsOf(section);
        const groupMatches = catalog.filter(function (group) { return providerNames(group).includes(label); });
        const group = groupMatches.length === 1 ? groupMatches[0] : null;
        const catalogOrderFits = group && Array.isArray(group.models) && group.models.length === buttons.length && group.models.every(function (model, index) { return model.name === modelNameOf(buttons[index]); });
        const items = [];
        for (let j = 0; j < buttons.length; j++) {
          const name = modelNameOf(buttons[j]);
          if (name === '') continue;
          const matches = group && Array.isArray(group.models) ? group.models.filter(function (model) { return model.name === name; }) : [];
          const legacyKey = modelKey(label, name);
          const remembered = buttonIdentities.get(buttons[j]);
          let model = matches.length === 1 ? matches[0] : null;
          if (!model && matches.length > 1 && remembered) {
            const parts = JSON.parse(remembered.key);
            if (parts.length === 3 && parts[1] === group.id) model = matches.find(function (candidate) { return candidate.id === parts[2]; }) || null;
          }
          // 同名模型仅在完整目录与 DOM 序列逐项一致时绑定；落盘始终使用 ID。
          if (!model && catalogOrderFits) model = group.models[j];
          const key = model ? stableModelKey(group.id, model.id) : remembered ? remembered.key : legacyKey;
          const legacyKeys = [legacyKey];
          if (remembered && remembered.legacyKey !== legacyKey) legacyKeys.push(remembered.legacyKey);
          buttonIdentities.set(buttons[j], { key: key, legacyKey: legacyKey });
          const selected = isChecked(buttons[j]);
          if (selected) selectedKey = key;
          items.push({ key: key, name: name, modelId: model ? model.id : '', button: buttons[j], selected: selected, legacyKeys: legacyKeys });
          choices += 1;
        }
        const identity = group ? group.id : providerIdentities.get(section) || label;
        providerIdentities.set(section, identity);
        providers.push({ key: label, label: label, identity: identity, items: items });
      }
      return { providers: providers, selectedKey: selectedKey, choices: choices };
    }

    /**
     * 找到与某个模型菜单**配对**的那个 trigger 按钮。
     *
     * 【为什么不能从菜单往上找】菜单是 React **portal 到 body** 的，所以
     * `surface.parentElement` 就是 `body` —— 从那里 `querySelector` 会扫过整个页面，
     * 在同时存在别的菜单（例如 `/model` 弹窗、其它下拉）时**可能抓到别的 trigger**。
     *
     * 内核本来就把两者的关系写进了 DOM：trigger 上有 `aria-controls="<id>-menu"`，
     * 而菜单 surface 的 `id` 正是 `<id>-menu`。用这个精确对应关系去查，
     * 才是可靠的做法。
     *
     * 兜底顺序：① 按 `aria-controls` 精确匹配 → ② 退到同一个 portal 容器内的
     * `aria-haspopup="menu"`（老结构）→ ③ 返回 null（宁可不移动焦点，也不要移错）。
     *
     * @param {Document} doc - 文档。
     * @param {Element} menu - 模型菜单容器（内层 div[role="menu"]）。
     * @returns {Element|null} 配对 trigger。
     */
    function findTrigger(doc, menu) {
      const surface = closest('[data-menu-material]', menu) || menu;
      if (surface.id) {
        const byControls = doc.querySelector('button[aria-controls="' + cssEscape(surface.id) + '"]');
        if (byControls !== null) return byControls;
      }
      const container = surface.parentElement;
      if (container !== null && container !== doc.body && container !== doc.documentElement) {
        const nearby = container.querySelector('button[aria-haspopup="menu"]');
        if (nearby !== null) return nearby;
      }
      return null;
    }

    /**
     * 转义选择器里的属性值。
     *
     * 内核的 id 来自 React `useId()`（形如 `:r1:`），冒号在选择器里有特殊含义，
     * 不转义会直接抛 `SyntaxError` —— 而那会让整个 `preserveFocusBeforeHide` 失败，
     * 进而回到「折叠导致菜单被关掉」的老问题。
     *
     * @param {string} value - 属性值。
     * @returns {string} 可安全放进 `[attr="…"]` 的值。
     */
    function cssEscape(value) {
      return String(value).replace(/["\\]/g, '\\$&');
    }

    /**
     * 把焦点从「即将被隐藏的元素」上移走。
     *
     * 【必须做】内核在进入模型面板后会把焦点放到当前选中的模型按钮上。折叠靠
     * `display:none` 隐藏它 —— 浏览器会**强制失焦**，内核根节点的 onBlur 收到
     * `relatedTarget === null`，于是判定「焦点离开了菜单」并 `close()`：整个菜单
     * 连面板一起消失（社区版实测踩过这个坑）。这里在隐藏前把焦点送回 trigger，
     * trigger 在内核 rootRef 内，onBlur 因此放行。
     *
     * @param {Document} doc - 目标文档。
     * @param {Element} menu - 模型菜单容器。
     */
    function preserveFocusBeforeHide(doc, menu) {
      const active = doc.activeElement;
      if (active === null || active === doc.body) return;
      if (menu.contains(active) !== true) return;
      const trigger = findTrigger(doc, menu);
      if (trigger !== null && typeof trigger.focus === 'function') {
        try {
          trigger.focus({ preventScroll: true });
        } catch (error) {
          /* 焦点失败不应中断增强 */
        }
      }
    }

    /**
     * 启动一个实例。
     * @param {Document} doc - 文档。
     * @param {Window} win - 窗口。
     * @returns {() => void} dispose。
     */
    function start(doc, win, ctx) {
      catalogContext = ctx || null;
      /** 读取偏好。 */
      function loadState() {
        try {
          return normalizeState(win.localStorage.getItem(STORAGE_KEY));
        } catch (error) {
          return emptyState();
        }
      }
      /**
       * 写入偏好并广播。
       *
       * 走模块级的 writeState 而不是自己 setItem：设置卡（React 世界）也订阅了
       * 这份偏好，DOM 侧改完（比如用户点了 ★ 置顶）要能立刻反映到设置页；
       * 反向同理（设置页改了字号/默认模式，这里收到广播重读并刷新）。
       */
      function saveState() {
        lastSelfWrite = serializeState(state);
        writeState(state);
      }
      /** 本实例最后一次写出的序列化结果：广播回来时用它识别「是自己写的」并跳过。 */
      let lastSelfWrite = null;

      let state = loadState();
      /** 旧显示名键仅在目录确认唯一对应关系时转换。 */
      function snapshotOf(menu) {
        const snapshot = readSnapshot(menu);
        const mapping = new Map();
        function add(from, to) {
          if (!mapping.has(from)) mapping.set(from, to);
          else if (mapping.get(from) !== to) mapping.set(from, null);
        }
        snapshot.providers.forEach(function (provider) {
          provider.items.forEach(function (item) {
            if (JSON.parse(item.key).length === 3) item.legacyKeys.forEach(function (legacy) { add(legacy, item.key); });
          });
        });
        const catalog = catalogGroups();
        const oldKeys = new Set(state.favorites.concat(state.recents, state.hidden, Object.keys(state.aliases)));
        for (const key of oldKeys) {
          if (mapping.has(key)) continue;
          let parts;
          try { parts = JSON.parse(key); } catch (error) { continue; }
          if (!Array.isArray(parts) || parts.length !== 2) continue;
          const candidates = [];
          for (const group of catalog) {
            if (!providerNames(group).includes(parts[0])) continue;
            for (const model of group.models || []) {
              if (parts[1] === model.id || withoutPriceLabel(parts[1]) === model.id || withoutPriceLabel(parts[1]) === withoutPriceLabel(model.name)) candidates.push(stableModelKey(group.id, model.id));
            }
          }
          if (new Set(candidates).size === 1) add(key, candidates[0]);
        }
        const next = remapPreferenceKeys(state, mapping);
        if (serializeState(next) !== serializeState(state)) { state = next; saveState(); }
        return snapshot;
      }
      /** 当前作用域内的菜单（同时只会有一个 composer 模型菜单）。 */
      let menuEl = null;
      /** 当前面板展示的来源键；null 表示总览（置顶/最近/来源列表）。 */
      let openProvider = null;
      let openProviderIdentity = null;
      /** 面板是否停在「管理」视图。 */
      let managing = false;
      /** 搜索串。 */
      let query = '';
      let providerQuery = '';
      let editingAlias = null;
      let manageFilter = 'all';
      let searchAll = false;
      const viewMemory = new Map();
      function rememberView() {
        if (panel.hidden) return;
        viewMemory.set(openProviderIdentity || openProvider || 'overview', { query: query, searchAll: searchAll, scrollTop: listEl.scrollTop });
        if (viewMemory.size > 100) viewMemory.delete(viewMemory.keys().next().value);
      }
      const originalSearchAttrs = new Map();
      /** 所有被我们写过属性的元素，卸载时统一还原。 */
      const touched = [];

      /** 记录被写过的元素（用于卸载清理）。 */
      function mark(node) {
        if (touched.indexOf(node) < 0) touched.push(node);
      }

      /**
       * 落点是否在**插件自建**的 UI 内（面板或启动按钮）。
       *
       * 这两个节点都挂在 body 上、不属于内核，所以多处逻辑都要先排除它们：
       * 内核判定「点在外面」、键盘导航判据、「点击外部关闭」。
       * 抽成一个闭包，避免每处各写一遍 contains 而漏掉某个节点。
       *
       * @param {Element} node - 落点元素。
       * @returns {boolean} 属于插件自建 UI 为 true。
       */
      function isInsidePanel(node) {
        if (!node) return false;
        return node === panel || panel.contains(node);
      }

      // ── 面板 DOM（挂 body，完全属于插件） ──
      const panel = el(doc, 'div', { id: PANEL_ID, hidden: true, role: 'dialog', 'aria-label': '模型整理器' });
      let searchInput = null;
      let listEl = null;
      let titleEl = null;
      let footEl = null;
      let previousView = null;
      /** 重建面板骨架（只做一次）。 */
      function buildPanel() {
        panel.textContent = '';
        titleEl = el(doc, 'div', { class: 'mo-title', text: '模型' });
        const sortButton = el(doc, 'button', { class: 'mo-btn mo-iconbtn mo-sort-trigger', type: 'button', 'data-act': 'sort-menu', 'aria-label': '模型排序', 'aria-expanded': 'false', title: '排序：默认顺序' }, [icon(doc, 'sort')]);
        panel.appendChild(el(doc, 'div', { class: 'mo-head' }, [
          el(doc, 'button', { class: 'mo-btn mo-iconbtn', type: 'button', title: '总览：置顶 · 最近 · 来源', 'aria-label': '模型总览', 'data-act': 'overview' }, [icon(doc, 'overview')]),
          titleEl, el(doc, 'span', { class: 'mo-summary' }),
          el(doc, 'button', { class: 'mo-btn mo-all', type: 'button', text: '全部来源', title: '整理全部来源的模型', 'data-act': 'manage-all', hidden: true }),
          sortButton,
          el(doc, 'button', { class: 'mo-btn mo-iconbtn mo-managebtn', type: 'button', title: '整理：置顶 / 隐藏 / 别名', 'aria-label': '整理模型', 'data-act': 'manage' }, [icon(doc, 'manage'), el(doc, 'span', { class: 'mo-sr-only', text: '整理' })]),
          el(doc, 'button', { class: 'mo-btn mo-managebtn', type: 'button', text: '完成', 'data-act': 'manage-off', hidden: true }),
          el(doc, 'button', { class: 'mo-btn mo-iconbtn', type: 'button', title: '关闭', 'aria-label': '关闭模型面板', 'data-act': 'close' }, [icon(doc, 'close')]),
        ]));
        searchInput = el(doc, 'input', { class: 'mo-search', type: 'text', placeholder: '搜索模型、别名或 ID…', 'aria-label': '搜索模型' });
        panel.appendChild(el(doc, 'div', { class: 'mo-search-wrap' }, [
          el(doc, 'div', { class: 'mo-scope', role: 'group', 'aria-label': '搜索范围' }, ['local', 'all'].map(function (scope) {
            return el(doc, 'button', { class: 'mo-btn', type: 'button', 'data-act': 'search-scope', 'data-scope': scope, 'aria-label': scope === 'all' ? '全部厂商' : '当前厂商', title: scope === 'all' ? '搜索全部厂商' : '搜索当前厂商', text: scope === 'all' ? '全局' : '厂商' });
          })), searchInput,
          el(doc, 'button', { class: 'mo-btn mo-iconbtn mo-clear', type: 'button', title: '清空搜索', 'aria-label': '清空搜索', 'data-act': 'clear-search', hidden: true }, [icon(doc, 'close')]),
        ]));
        panel.appendChild(el(doc, 'div', { class: 'mo-filters', role: 'group', 'aria-label': '整理筛选', hidden: true }, ['all', 'pinned', 'hidden'].map(function (filter) {
          return el(doc, 'button', { class: 'mo-btn', type: 'button', text: { all: '全部', pinned: '已置顶', hidden: '已隐藏' }[filter], 'data-act': 'manage-filter', 'data-filter': filter });
        })));
        listEl = el(doc, 'div', { class: 'mo-list' }); footEl = el(doc, 'div', { class: 'mo-foot' });
        panel.append(listEl, footEl);
        panel.appendChild(el(doc, 'div', { class: 'mo-sort-menu', role: 'group', 'aria-label': '排序选项', hidden: true }, [
          ['default', '默认顺序'], ['name', '名称 A → Z'], ['price-asc', '倍率 低 → 高'], ['price-desc', '倍率 高 → 低'],
        ].map(item => el(doc, 'button', { class: 'mo-btn', type: 'button', 'data-act': 'sort-order', 'data-order': item[0], 'aria-pressed': 'false', text: item[1] }))));
      }

      /** 固定面板位置：优先贴菜单右侧，放不下就贴左侧。 */
      function placePanel() {
        if (menuEl === null) return;
        placeNativeMenu();
        if (panel.hidden) return;
        const surface = closest('[data-menu-material]', menuEl) || menuEl;
        const rect = surface.getBoundingClientRect();
        const panelRect = panel.getBoundingClientRect();
        const width = panelRect.width || Math.min(360, win.innerWidth - 16);
        const gap = 8;
        let left = rect.right + gap;
        if (left + width > win.innerWidth - gap) {
          const flipped = rect.left - gap - width;
          left = flipped >= gap ? flipped : Math.max(gap, win.innerWidth - width - gap);
        }
        let top = rect.top;
        const height = panelRect.height || 0;
        const maxTop = win.innerHeight - height - gap;
        if (maxTop > gap && top > maxTop) top = maxTop;
        if (top < gap) top = gap;
        panel.style.left = Math.round(left) + 'px';
        panel.style.top = Math.round(top) + 'px';
      }

      /** CSS 折叠/筛选不会触发宿主 React 的 place；按同一锚点与边距补上定位。 */
      function placeNativeMenu() {
        if (menuEl === null) return;
        const surface = closest('[data-menu-material]', menuEl) || menuEl;
        const trigger = findTrigger(doc, menuEl);
        if (trigger === null) return;
        const anchor = trigger.getBoundingClientRect();
        const box = surface.getBoundingClientRect();
        if (!(anchor.width > 0 && anchor.height > 0 && box.width > 0 && box.height > 0)) return;
        const margin = 12;
        const left = Math.min(Math.max(anchor.right - box.width, margin), Math.max(margin, win.innerWidth - box.width - margin));
        const top = Math.min(Math.max(anchor.top - 8 - box.height, margin), Math.max(margin, win.innerHeight - box.height - margin));
        mark(surface);
        surface.style.setProperty('--mo-menu-top', Math.round(top) + 'px');
        surface.style.setProperty('--mo-menu-left', Math.round(left) + 'px');
        surface.setAttribute('data-mo-anchor', '1');
      }

      /** 当前可见（未被隐藏）的模型条目。 */
      function visibleEntries() {
        if (menuEl === null) return [];
        const snapshot = snapshotOf(menuEl);
        const out = [];
        for (let i = 0; i < snapshot.providers.length; i++) {
          const provider = snapshot.providers[i];
          for (let j = 0; j < provider.items.length; j++) {
            const item = provider.items[j];
            if (state.hidden.indexOf(item.key) >= 0) continue;
            out.push({
              key: item.key,
              provider: provider.label,
              name: item.name,
              modelId: item.modelId,
              providerIdentity: provider.identity,
              label: resolveLabel(state.aliases, item.key, item.name),
              selected: item.selected,
              button: item.button,
              // 内核 busy 时会把原生按钮设成 disabled；把状态带到面板上，
              // 这样面板行也能显示为不可用（而不是点了毫无反应）。
              disabled: item.button.disabled === true,
            });
          }
        }
        return out;
      }

      /** 程序化点击原生按钮完成选择（内核自己处理状态）。 */
      /**
       * 点面板里的模型 → 程序化点击内核的真实按钮完成选择。
       *
       * 【为什么不先记「最近」】早期版本先 `pushRecent` 再 `click()`，于是有个静默失败：
       * 内核 busy（正在加载/提交）时会把每个 `button[role="menuitemradio"]` 渲染成
       * `disabled`，而**面板行是插件自建的、不会 disabled**，用户照样能点。
       * 对 disabled 按钮调 `click()` 不会触发任何处理器 —— 内核根本没选中，
       * 但「最近」已经被写上、面板也关了，用户看到的是「点了没反应，还留了个假记录」。
       * 按钮若已被 React 摘掉（`isConnected === false`）同理。
       *
       * 所以这里先确认按钮**存在、已连接且可用**，再记「最近」并关闭面板。
       *
       * @param {{key:string,button:Element}|null} entry - 目标条目。
       * @returns {boolean} 是否真的把点击交给了内核。
       */
      function choose(entry) {
        if (!entry || !entry.button) return false;
        const button = entry.button;
        if (button.isConnected !== true) return false;
        if (button.disabled === true) return false;
        // 记「最近」只在这种确实能选中的情况下发生（见上方说明）。
        state.recents = pushRecent(state.recents, entry.key);
        saveState();
        try {
          button.click();
        } catch (error) {
          /* 内核若已自行关闭菜单，这里点击失败无妨 */
        }
        closePanel();
        return true;
      }

      /** 把某个模型键的隐藏状态同步到原生按钮属性。 */
      function applyHiddenFlags(snapshot) {
        for (let i = 0; i < snapshot.providers.length; i++) {
          const items = snapshot.providers[i].items;
          for (let j = 0; j < items.length; j++) {
            const button = items[j].button;
            const hidden = state.hidden.indexOf(items[j].key) >= 0;
            mark(button);
            if (hidden) button.setAttribute(HIDDEN_ATTR, '1');
            else button.removeAttribute(HIDDEN_ATTR);
          }
        }
      }

      /** 给每个来源标题写徽标与「当前」标记。 */
      function applyHeadings() {
        if (menuEl === null) return;
        const sections = Array.prototype.slice.call(menuEl.querySelectorAll('section[role="group"]'));
        for (let i = 0; i < sections.length; i++) {
          const section = sections[i];
          const heading = headingOf(section);
          if (heading === null) continue;
          const buttons = itemsOf(section);
          let current = false;
          let visible = 0;
          const label = providerLabelOf(section);
          for (let j = 0; j < buttons.length; j++) {
            if (isChecked(buttons[j])) current = true;
            // 徽标只数**用户可见**的模型。隐藏的行仍在内核 DOM 里，若按 buttons.length
            // 计数，一个「所有模型都被隐藏」的来源会显示 (2) 却展开后空无一物。
            // 用 state.hidden 而不是 data-mo-hidden：键盘/搜索模式会**临时**摘掉标记，
            // 此处若读属性会得到忽大忽小的错数；偏好表才是稳定真相。
            if (state.hidden.indexOf(modelKey(label, modelNameOf(buttons[j]))) < 0) visible += 1;
          }
          mark(section);
          mark(heading);
          section.setAttribute(SECTION_ATTR, '1');
          heading.setAttribute('data-mo-badge', '(' + visible + ')');
          if (current) heading.setAttribute('data-mo-current', '1');
          else heading.removeAttribute('data-mo-current');
        }
      }

      /**
       * 折叠状态默认值：两种模式下原生列表**一律折叠**，展开完全由侧边面板承担。
       * （早期第三种「列表内展开」模式需要按来源记忆展开状态，已移除。）
       *
       * @returns {boolean} 是否折叠（恒为 true）。
       */
      function defaultCollapsed() {
        return shouldCollapseByDefault();
      }

      /**
       * 内核自带的搜索框当前是否有查询内容。
       *
       * 【为什么必须看它】内核在模型数 >4 时会渲染自己的搜索框（`role="searchbox"`），
       * 用户在里面打字时内核会把每个来源组按名称过滤、只留下命中的组。而本插件在
       * hover/panel 模式下会把**所有**来源折叠起来（靠 `data-mo-collapsed` 把组内模型
       * 项 `display:none`）—— 两者相撞的结果是：用户在内核搜索框里打字，
       * 列表确实过滤了，但**命中结果全被折叠藏起来**，看起来像「搜不到东西」。
       *
       * 所以只要内核搜索处于激活状态，就一律**临时展开**（不折叠），把命中结果露出来；
       * 清空搜索后自动回到正常折叠。插件自己的面板搜索与这里互不影响。
       *
       * @returns {string} 已修剪的查询串（空串表示没在搜）。
       */
      function kernelSearchQuery() {
        if (menuEl === null) return '';
        const surface = closest('[data-menu-material]', menuEl) || menuEl;
        const input = surface.querySelector('input[role="searchbox"]');
        if (input === null) return '';
        if (input.hasAttribute('data-mo-provider-search')) return '';
        const value = input.value;
        return typeof value === 'string' ? value.trim() : '';
      }

      /** 原搜索框只筛选厂商，不让宿主把整个模型清单展开或丢失目录。 */
      function applyProviderSearch() {
        if (menuEl === null) return;
        const surface = closest('[data-menu-material]', menuEl) || menuEl;
        const input = surface.querySelector('input[role="searchbox"]');
        if (input !== null) {
          if (!originalSearchAttrs.has(input)) {
            originalSearchAttrs.set(input, { placeholder: input.getAttribute('placeholder'), label: input.getAttribute('aria-label'), type: input.getAttribute('type') });
          }
          input.setAttribute('data-mo-provider-search', '1');
          input.placeholder = '搜索厂商…';
          input.setAttribute('aria-label', '搜索厂商');
          input.type = 'search';
          if (input.value !== providerQuery) input.value = providerQuery;
        }
        let count = 0;
        const text = normalizeQuery(providerQuery);
        menuEl.querySelectorAll('section[role="group"]').forEach(function (section) {
          mark(section);
          if (text === '' || normalizeQuery(providerLabelOf(section)).includes(text)) {
            section.removeAttribute('data-mo-provider-filtered');
            count++;
          } else section.setAttribute('data-mo-provider-filtered', '1');
        });
        mark(surface);
        if (count === 0) surface.setAttribute('data-mo-empty-providers', '1');
        else surface.removeAttribute('data-mo-empty-providers');
        if (!panel.hidden && openProvider !== null && text !== '' && !normalizeQuery(openProvider).includes(text)) closePanel();
        placePanel();
      }

      /**
       * 原生菜单此刻是否必须**展开**（不能折叠）。
       *
       * 有两个独立原因会让折叠变成「把用户要找的东西藏起来」：
       *
       * ① **内核搜索激活**。内核在模型数 >4 时渲染自己的搜索框（`role="searchbox"`），
       *    打字时它按名称过滤各来源组、只留命中的组。我们若仍把所有组折叠，
       *    列表确实过滤了，但**命中结果全被 `display:none` 藏住** —— 看起来像搜不到。
       *
       * ② **键盘导航进行中**。这是更严重的一条：内核的上下键导航走它**自己的 React
       *    状态** `visibleModels`（`activeModelIndex` → 行上的 `data-highlighted`），
       *    它**完全不知道**我们在 CSS 里藏了行。于是按上/下键时，高亮会在**不可见的行**
       *    之间移动，按 Enter 就会选中一个用户根本看不见的模型 —— 直接选错模型。
       *
       * 【为什么不能用「焦点在菜单内」当判据】内核在进入模型面板且 `showSearch` 为真时
       * 会**主动把焦点放到它自己的搜索框**上（`paneFocus='drill'` → `searchRef.focus()`），
       * 而模型数 >4 才出现搜索框 —— 恰好就是本插件最需要折叠的场景。若用「焦点在菜单内」
       * 判断，折叠会在绝大多数情况下被永久跳过，**核心功能直接失效**。
       * 所以这里只认**键盘意图**：用户真的按了方向键 / Tab / Enter。
       *
       * 键盘意图在菜单关闭或用户改用鼠标（菜单内按下）时清除，随后自动恢复折叠。
       *
       * @returns {boolean} 必须展开为 true。
       */
      function mustExpandNatively() {
        if (menuEl === null) return false;
        if (kernelSearchQuery() !== '') return true;
        return keyboardNav === true;
      }

      /** 应用折叠：list 模式下按用户记录，其余模式一律折叠（由面板承担展开）。 */
      function applyFolding() {
        if (menuEl === null) return;
        const sections = Array.prototype.slice.call(menuEl.querySelectorAll('section[role="group"]'));
        // 内核搜索或键盘导航激活时全部展开（见 mustExpandNatively 的两条理由）。
        const expand = mustExpandNatively();
        const wantCollapse = [];
        for (let i = 0; i < sections.length; i++) {
          const section = sections[i];
          wantCollapse.push({
            section: section,
            collapsed: expand ? false : defaultCollapsed(),
          });
        }
        // 先移焦点，再隐藏 —— 顺序不能反（见 preserveFocusBeforeHide 注释）。
        const willHide = wantCollapse.some(function (entry) {
          return entry.collapsed === true;
        });
        if (willHide) preserveFocusBeforeHide(doc, menuEl);
        for (let i = 0; i < wantCollapse.length; i++) {
          mark(wantCollapse[i].section);
          if (wantCollapse[i].collapsed) wantCollapse[i].section.setAttribute(COLLAPSED_ATTR, '1');
          else wantCollapse[i].section.removeAttribute(COLLAPSED_ATTR);
        }
        // ── 键盘/搜索期间**临时**取消隐藏标记 ──
        //
        // 隐藏用的是 CSS `display:none`，但内核的键盘导航与搜索走它**自己的**
        // React 状态（`visibleModels` / `activeModelIndex` / `itemRefs`），看不见 CSS。
        // 一个 `display:none` 的节点无法从内核的数组里移除，所以只要它留着
        // `data-mo-hidden`，ArrowDown 就可能把高亮落到一行**用户看不见**的模型上，
        // 再按 Enter 就会选中它 —— 这正是 mustExpandNatively 想防的那类问题，
        // 而折叠被展开之后**隐藏**还是一条更硬的 `!important` 隐藏。
        //
        // 因此在这一模式下把标记一并摘掉（与折叠同一套「临时展开」思路），
        // 退出键盘/搜索后由 applyHiddenFlags 重新贴上。
        if (expand) {
          const rows = menuEl.querySelectorAll('button[role="menuitemradio"][' + HIDDEN_ATTR + ']');
          const pending = [];
          for (let i = 0; i < rows.length; i++) pending.push(rows[i]);
          for (let i = 0; i < pending.length; i++) {
            mark(pending[i]);
            pending[i].removeAttribute(HIDDEN_ATTR);
          }
        } else if (!panel.hidden) {
          // 非键盘模式：确保隐藏标记与偏好一致（面板打开时用户可能刚切过模式）
          applyHiddenFlags(snapshotOf(menuEl));
        }
        placePanel();
      }

      // ── 面板渲染 ──

      /** 渲染一行模型。 */
      function modelRow(entry, groupedProvider) {
        const actions = [];
          actions.push(el(doc, 'button', {
            class: 'mo-btn mo-iconbtn mo-pinbtn' + (managing ? '' : ' mo-quick-pin'), type: 'button',
            title: '置顶/取消置顶', 'data-act': 'fav', 'data-key': entry.key,
            'aria-label': state.favorites.indexOf(entry.key) >= 0 ? '取消置顶 ' + entry.label : '置顶 ' + entry.label,
            'aria-pressed': state.favorites.indexOf(entry.key) >= 0 ? 'true' : 'false',
            disabled: entry.hidden === true,
            'data-on': state.favorites.indexOf(entry.key) >= 0 ? '1' : null,
          }, [icon(doc, 'star')]));
        if (managing) {
          actions.push(el(doc, 'button', {
            class: 'mo-btn mo-rename', type: 'button', text: '改名', title: '编辑别名', 'data-act': 'edit-alias', 'data-key': entry.key,
          }));
          actions.push(el(doc, 'button', {
            class: 'mo-btn' + (entry.hidden ? ' mo-restore' : ' mo-iconbtn'), type: 'button', title: entry.hidden ? '恢复显示' : '隐藏这个模型',
            'aria-label': (entry.hidden ? '恢复 ' : '隐藏 ') + entry.label, 'data-act': entry.hidden ? 'unhide' : 'hide', 'data-key': entry.key,
          }, entry.hidden ? [el(doc, 'span', { text: '恢复' })] : [icon(doc, 'hide')]));
        }
        const subParts = [];
        if (openProvider === null && !groupedProvider) subParts.push(entry.provider);
        const sub = subParts.join(' · ');
        const main = el(doc, 'div', { class: 'mo-row-main' }, [
          el(doc, 'span', { class: 'mo-label-line' }, [el(doc, 'span', { class: 'mo-row-name', text: entry.label }),
            entry.label !== entry.name ? el(doc, 'span', { class: 'mo-alias-mark', text: '✎', title: '自定义名称', 'aria-label': '自定义名称' }) : null]),
          sub === '' ? null : el(doc, 'span', { class: 'mo-row-sub', text: sub }),
        ]);
        const row = el(doc, 'button', {
          class: 'mo-row', type: 'button', 'data-act': 'choose', 'data-key': entry.key,
          'data-selected': entry.selected ? '1' : null,
          // 内核 busy 时该行不可用；标出来让用户看到「现在点不了」，
          // 而不是点了毫无反应（choose 会拒绝并向内核说明原因）。
          'data-disabled': entry.disabled ? '1' : null,
          'aria-disabled': entry.disabled ? 'true' : null,
          // 把**原始模型名**存在行上，供清空别名时精确还原。
          // 不要从 data-key 反解：key 是 JSON 编码的 [来源, 模型]，语义上不可切分。
          'data-name': entry.name,
          title: entry.provider + ' / ' + entry.name + (entryModelId(entry) ? '\n模型 ID：' + entryModelId(entry) : '') + (entry.disabled ? '（内核忙，暂不可选）' : ''),
        }, [main, entry.hidden ? el(doc, 'span', { class: 'mo-count', text: '已隐藏' }) : entry.selected ? icon(doc, 'check', 'mo-selected') : null]);
        // 操作按钮与选择按钮并列，避免嵌套 button 导致键盘/焦点行为不稳定。
        const line = el(doc, 'div', { class: 'mo-model-line', 'data-selected': entry.selected ? '1' : null }, [row, el(doc, 'span', { class: 'mo-actions' }, actions)]);
        if (!managing) return line;
        // 管理模式：行内可编辑别名
        const aliasInput = el(doc, 'input', {
          class: 'mo-alias-input', type: 'text', placeholder: '别名…', 'data-act': 'alias', 'data-key': entry.key,
          value: state.aliases[entry.key] || '',
          'aria-label': entry.name + ' 的别名',
        });
        const editor = el(doc, 'div', { class: 'mo-alias-editor', hidden: editingAlias !== entry.key }, [aliasInput,
          el(doc, 'button', { class: 'mo-btn', type: 'button', text: '完成', 'data-act': 'alias-done' }),
        ]);
        return el(doc, 'div', { class: 'mo-edit-row', 'data-editing': editingAlias === entry.key ? '1' : null, 'data-hidden': entry.hidden ? '1' : null }, [line, editor]);
      }

      /** 渲染一行来源。 */
      function providerRow(provider) {
        const count = provider.items.filter(function (item) { return state.hidden.indexOf(item.key) < 0; }).length;
        const current = provider.items.some(function (item) {
          return item.selected === true;
        });
        return el(doc, 'button', {
          class: 'mo-row', type: 'button', 'data-act': 'provider', 'data-key': provider.key,
          'data-selected': current ? '1' : null,
          title: provider.label,
        }, [
          el(doc, 'span', { class: 'mo-row-main' }, [
            el(doc, 'span', { class: 'mo-row-name', text: provider.label }),
          ]),
          el(doc, 'span', { class: 'mo-count', text: count + ' 个' }),
          icon(doc, 'chevron', 'mo-chevron'),
        ]);
      }

      function appendModelGroups(target, entries, providerIdentity, groupedProvider, global) {
        const families = new Map();
        for (const entry of entries) {
          const family = state.groupSeries ? modelSeries(entry) : '';
          if (!families.has(family)) families.set(family, []);
          families.get(family).push(entry);
        }
        for (const [family, models] of families) {
          let container = target;
          if (family && !(global && families.size === 1)) {
            const key = JSON.stringify([providerIdentity, family]);
            const collapsed = normalizeQuery(query) === '' && state.collapsedSeries.includes(key);
            const group = el(doc, 'div', { class: 'mo-series', 'data-family': family });
            const heading = el(doc, 'button', { class: 'mo-series-heading', type: 'button', 'data-act': 'series', 'data-key': key, 'aria-expanded': collapsed ? 'false' : 'true', disabled: normalizeQuery(query) !== '', title: normalizeQuery(query) !== '' ? '搜索时自动展开；清空搜索后可折叠' : '展开或折叠系列', 'aria-label': family + ' 系列，' + models.length + ' 个模型' }, [icon(doc, 'chevron', 'mo-chevron'), el(doc, 'span', { text: family }), el(doc, 'span', { class: 'mo-group-count', text: String(models.length) })]);
            container = el(doc, 'div', { class: 'mo-series-models', hidden: collapsed });
            group.append(heading, container); target.appendChild(group);
          }
          for (const entry of orderEntries(models, state.sortOrder, normalizeQuery(query), state.aliases)) container.appendChild(modelRow(entry, groupedProvider));
        }
      }

      function appendProviderGroups(entries, snapshot, global) {
        let count = 0;
        for (const provider of snapshot.providers) {
          const models = entries.filter(entry => entry.providerIdentity ? entry.providerIdentity === provider.identity : entry.provider === provider.label);
          if (!models.length) continue;
          count++;
          const group = el(doc, 'section', { class: global ? 'mo-result-provider' : 'mo-provider-models', 'aria-label': provider.label });
          if (global) group.appendChild(el(doc, 'div', { class: 'mo-provider-heading' }, [el(doc, 'span', { text: provider.label }), el(doc, 'span', { class: 'mo-group-count', text: String(models.length) })]));
          appendModelGroups(group, models, provider.identity, true, global);
          listEl.appendChild(group);
        }
        return count;
      }

      /** 渲染面板内容。 */
      /**
       * 把设置页的两项偏好落到 DOM 上（字号 / 启动按钮可见性）。
       *
       * 字号只写到**面板元素**上，不写全局 CSS 变量 —— 这项设置的作用域是
       * 「插件面板」，写到 documentElement 会波及宿主界面（越界）。
       * 面板内所有字号都用 em/相对值或继承，改根元素一处即可。
       */
      function applySettings() {
        panel.style.setProperty('--mo-fs', state.fontSize + 'px');
        if (!panel.hidden) renderPanel();
      }

      function renderPanel() {
        if (menuEl === null) return;
        const active = doc.activeElement;
        const editing = active && panel.contains(active) && active.getAttribute('data-act') === 'alias'
          ? { key: active.getAttribute('data-key'), value: active.value, start: active.selectionStart, end: active.selectionEnd } : null;
        // 渲染期间挂起观察器回调，避免自建 DOM 的变动反弹成新一轮扫描。
        rendering = true;
        try {
          renderPanelInner();
          if (editing && editingAlias === editing.key) {
            const replacement = Array.prototype.find.call(panel.querySelectorAll('[data-act="alias"]'), function (input) { return input.getAttribute('data-key') === editing.key; });
            if (replacement && !replacement.parentElement.hidden) {
              replacement.value = editing.value;
              replacement.focus({ preventScroll: true });
              replacement.setSelectionRange(editing.start, editing.end);
            }
          }
        } finally {
          rendering = false;
        }
      }

      /** 面板渲染的实际实现。 */
      function renderPanelInner() {
        if (menuEl === null) return;
        const snapshot = snapshotOf(menuEl);
        if (openProvider !== null) {
          const current = snapshot.providers.find(function (provider) { return provider.identity === openProviderIdentity || provider.label === openProvider; });
          if (current) { openProvider = current.label; openProviderIdentity = current.identity; }
        }
        const all = visibleEntries();
        const normalized = normalizeQuery(query);
        const scopeItems = snapshot.providers.filter(function (provider) { return openProvider === null || searchAll || provider.label === openProvider; }).flatMap(function (provider) { return provider.items; });
        const hiddenCount = scopeItems.filter(function (item) { return state.hidden.indexOf(item.key) >= 0; }).length;
        const viewKey = JSON.stringify([managing, openProviderIdentity, openProvider, searchAll, normalized, manageFilter, state.sortOrder, state.groupSeries]);
        const scrollTop = viewKey === previousView ? listEl.scrollTop : 0;
        previousView = viewKey;
        searchInput.value = query;
        titleEl.title = openProvider === null ? '模型总览' : openProvider;
        searchInput.placeholder = '搜索模型、别名或 ID…';
        const sortLabel = { default: '默认顺序', name: '名称 A → Z', 'price-asc': '倍率 低 → 高', 'price-desc': '倍率 高 → 低' }[state.sortOrder];
        panel.querySelector('.mo-sort-trigger').title = '排序：' + sortLabel + '（组内排序；倍率不等同实际费用）';
        panel.querySelector('.mo-sort-trigger').setAttribute('data-on', state.sortOrder === 'default' ? '0' : '1');
        panel.querySelectorAll('[data-act="sort-order"]').forEach(button => button.setAttribute('aria-pressed', button.getAttribute('data-order') === state.sortOrder ? 'true' : 'false'));
        panel.querySelectorAll('[data-act="search-scope"]').forEach(function (button) {
          const all = button.getAttribute('data-scope') === 'all';
          button.disabled = !all && openProvider === null;
          button.setAttribute('aria-pressed', (all ? openProvider === null || searchAll : openProvider !== null && !searchAll) ? 'true' : 'false');
        });
        panel.querySelector('.mo-summary').textContent = openProvider === null ? '常用模型与厂商' : (managing ? scopeItems.length + ' 个模型' : scopeItems.length - hiddenCount + ' 个可见模型');
        panel.querySelector('.mo-filters').hidden = !managing;
        panel.querySelectorAll('[data-act="manage-filter"]').forEach(function (button) {
          button.setAttribute('aria-pressed', button.getAttribute('data-filter') === manageFilter ? 'true' : 'false');
          if (button.getAttribute('data-filter') === manageFilter) button.setAttribute('data-on', '1');
          else button.removeAttribute('data-on');
        });
        panel.querySelector('[data-act="clear-search"]').hidden = query.length === 0;
        panel.querySelector('[data-act="manage-all"]').hidden = !managing || openProvider === null;
        listEl.textContent = '';
        footEl.textContent = '';

        if (titleEl !== null) {
          titleEl.textContent = managing ? (openProvider === null ? '整理模型' : openProvider) : searchAll ? '全部模型' : openProvider === null ? '模型' : openProvider;
        }

        const manageButton = panel.querySelector('[data-act="manage"]');
        manageButton.hidden = managing;
        panel.querySelector('[data-act="manage-off"]').hidden = !managing;
        manageButton.querySelector('span').textContent = managing ? '完成整理' : '整理';
        manageButton.setAttribute('aria-pressed', managing ? 'true' : 'false');
        if (managing) manageButton.setAttribute('data-on', '1');
        else manageButton.removeAttribute('data-on');

        const global = openProvider === null || searchAll;
        const showModels = managing || normalized !== '' || openProvider !== null || searchAll;
        if (showModels) {
          let entries = all;
          if (managing) {
            entries = snapshot.providers.flatMap(provider => provider.items.map(item => ({
              key: item.key, provider: provider.label, providerIdentity: provider.identity, modelId: item.modelId,
              name: item.name, label: resolveLabel(state.aliases, item.key, item.name), selected: item.selected,
              disabled: item.button.disabled === true, hidden: state.hidden.includes(item.key),
            })));
          }
          entries = entries.filter(function (entry) {
            if (!global && entry.provider !== openProvider) return false;
            if (managing && manageFilter === 'pinned' && !state.favorites.includes(entry.key)) return false;
            if (managing && manageFilter === 'hidden' && !state.hidden.includes(entry.key)) return false;
            return !normalized || matchesQuery({ key: entry.key, raw: entry.name, modelId: entry.modelId }, state.aliases, normalized);
          });
          const providers = appendProviderGroups(entries, snapshot, global);
          if (!entries.length) listEl.appendChild(el(doc, 'div', { class: 'mo-empty', text: normalized || managing ? '没有匹配的模型' : '这个来源没有可用模型' }));
          panel.querySelector('.mo-summary').textContent = global ? providers + ' 个厂商 · ' + entries.length + ' 个模型' : entries.length + (normalized || managing ? ' 结果' : ' 模型');
        } else {
          // 总览：置顶 → 最近 → 来源
          const byKey = {};
          all.forEach(function (entry) {
            byKey[entry.key] = entry;
          });
          const favorites = state.favorites.filter(function (key) {
            return byKey[key] !== undefined;
          });
          if (favorites.length > 0) {
            listEl.appendChild(el(doc, 'div', { class: 'mo-group-label', text: '置顶' }));
            for (let i = 0; i < favorites.length; i++) listEl.appendChild(modelRow(byKey[favorites[i]]));
          }
          const recents = state.recents.filter(function (key) {
            return byKey[key] !== undefined && favorites.indexOf(key) < 0;
          });
          if (recents.length > 0) {
            listEl.appendChild(el(doc, 'div', { class: 'mo-group-label', text: '最近' }));
            for (let i = 0; i < recents.length; i++) listEl.appendChild(modelRow(byKey[recents[i]]));
          }
          listEl.appendChild(el(doc, 'div', { class: 'mo-group-label', text: '来源' }));
          for (let i = 0; i < snapshot.providers.length; i++) {
            listEl.appendChild(providerRow(snapshot.providers[i]));
          }
        }

        // 底栏：管理模式的操作说明 + 隐藏计数。
        // 【刻意不再常驻「当前模式怎么用」那句说明】模式按钮已经是完整双字词、
        // 悬停还有 title 解释，再在底栏常驻一句「划过标题即滑出面板…」属于重复
        // 占用空间；用户反馈没必要。这里只在真有信息（管理模式操作 / 隐藏计数）时出现。
        if (managing) {
          // 操作都在模型行和标题栏；不再额外占一整行操作说明。
        }
        if (hiddenCount > 0 && !managing) {
          footEl.appendChild(el(doc, 'span', { class: 'mo-hint', text: '已隐藏 ' + hiddenCount }));
        }
        // 没有内容时整条底栏不占位（否则会留一条空白 + 多余间距）。
        footEl.hidden = footEl.childNodes.length === 0;
        listEl.scrollTop = scrollTop;
        placePanel();
      }

      /** 打开面板。 */
      function openPanel(providerKey) {
        const nextProvider = providerKey === undefined ? null : providerKey;
        const changed = panel.hidden || nextProvider !== openProvider;
        if (changed) rememberView();
        openProvider = nextProvider;
        const provider = menuEl === null || nextProvider === null ? null : snapshotOf(menuEl).providers.find(item => item.label === nextProvider);
        openProviderIdentity = provider ? provider.identity : null;
        const previous = changed ? viewMemory.get(openProviderIdentity || openProvider || 'overview') : null;
        if (changed) { query = previous ? previous.query : ''; searchAll = previous ? previous.searchAll : false; managing = false; editingAlias = null; manageFilter = 'all'; }
        panel.hidden = false;
        renderPanel();
        if (previous) listEl.scrollTop = previous.scrollTop;
        placePanel();
      }

      function closePanel() {
        rememberView();
        panel.hidden = true;
        panel.querySelector('.mo-sort-menu').hidden = true; panel.querySelector('.mo-sort-trigger').setAttribute('aria-expanded', 'false');
        openProvider = null; openProviderIdentity = null;
        managing = false; query = ''; searchAll = false;
        editingAlias = null; manageFilter = 'all';
      }

      /** 让菜单进入「已整理」状态（打作用域、写属性、应用折叠）。 */
      function enhance(menu) {
        const signature = readSignature(menu);
        if (!isModelMenuSignature(signature)) return false;
        menuEl = menu;
        const surface = closest('[data-menu-material]', menu) || menu;
        mark(surface);
        mark(menu);
        surface.setAttribute(SCOPE_ATTR, '1');
        if (surface !== menu) menu.setAttribute(SCOPE_ATTR, '1');
        applyProviderSearch();
        const snapshot = snapshotOf(menu);
        applyHiddenFlags(snapshot);
        applyHeadings();
        applyFolding();
        return true;
      }

      /**
       * 扫描：找到并增强模型菜单；菜单消失则收起面板。
       *
       * 每次扫描都要重新读一遍视图签名：内核会在**同一个** `div[role="menu"]` 节点上
       * 就地换 children（root ⇄ model ⇄ effort），只认元素身份会漏掉视图切换。
       */
      function scan() {
        const candidates = doc.querySelectorAll('div[role="menu"]');
        let found = null;
        for (let i = 0; i < candidates.length; i++) {
          if (isModelMenuSignature(readSignature(candidates[i]))) {
            found = candidates[i];
            break;
          }
        }
        if (found === null) {
          if (menuEl !== null) {
            restoreMenu();
            menuEl = null;
            lastViewSignature = null;
            if (!panel.hidden) closePanel();
          }
          // 菜单关闭 → 清掉键盘导航状态与待决单击，下次打开回到正常折叠。
          // 待决定时器必须在这里取消：否则它会在菜单消失后触发并打开一个孤儿面板
          // （见 handleTitleActivate 的防孤儿说明）。
          keyboardNav = false;
          lastKernelSearching = false;
          return;
        }
        const switched = found !== menuEl;
        if (switched) {
          restoreMenu();
          menuEl = null;
          lastViewSignature = null;
        }
        // 视图签名变化（例如内核换了 pane 或搜索过滤）才需要重新挂属性
        const signature = viewSignature(found);
        if (!switched && signature === lastViewSignature) {
          // 视图没变：只保证作用域与**各组标记**仍然在位，不必整表重写。
          //
          // 【为什么必须逐组核对，而不是只看作用域属性】React 在重渲染时可能**替换**
          // 分组标题节点（文本不变、id 复用，于是视图签名完全一样）。新节点上没有
          // 我们写的 data-mo-badge / data-mo-current，只看作用域属性会直接走快速路径
          // 返回，结果是「当前来源」高亮与模型数徽标**静默消失**。
          // 这里的核对很便宜（每个来源 1 次属性读），却能保证标记始终在位。
          if (found.getAttribute(SCOPE_ATTR) !== '1' || !markersIntact(found)) {
            enhance(found);
          }
          applyProviderSearch();
          return;
        }
        if (!enhance(found)) return;
        lastViewSignature = signature;
        if (!panel.hidden) {
          renderPanel();
          placePanel();
        }
      }

      /**
       * 各组标记是否仍然完整。
       *
       * 判定「完整」用最便宜的方式：每个来源都必须已标记、有标题、且标题上带着
       * 徽标（徽标由 applyHeadings 无条件写入，是标记链的可靠信号）。
       *
       * @param {Element} menu - 模型菜单容器。
       * @returns {boolean} 全部完整为 true。
       */
      function markersIntact(menu) {
        const sections = menu.querySelectorAll('section[role="group"]');
        if (sections.length === 0) return false;
        /** 文档里当前存在的模型键 → 其行是否带隐藏标记。 */
        const present = {};
        for (let i = 0; i < sections.length; i++) {
          const section = sections[i];
          if (section.getAttribute(SECTION_ATTR) !== '1') return false;
          const heading = headingOf(section);
          if (heading === null) return false;
          if (heading.getAttribute('data-mo-badge') === null) return false;
          // ★ 隐藏标记也必须核对。
          //   React 按 key 复用/替换行节点时，新节点上没有我们的 data-mo-hidden，
          //   而视图签名只统计「每组几条」，替换前后完全一样 → 曾导致隐藏的模型又冒出来。
          const label = providerLabelOf(section);
          const buttons = itemsOf(section);
          for (let j = 0; j < buttons.length; j++) {
            present[(buttonIdentities.get(buttons[j]) || { key: modelKey(label, modelNameOf(buttons[j])) }).key] =
              buttons[j].getAttribute(HIDDEN_ATTR) === '1';
          }
        }
        // 不变式：**文档里存在的**模型，其隐藏标记必须与偏好一致。
        //
        // 注意用「交集」而不是「全等」：偏好里可能留着已经下架的模型
        // （换了来源目录、模型被移除）。若要求 `state.hidden` 与文档标记数量全等，
        // 那条陈旧记录会让本函数**永远返回 false**，于是每轮扫描都退化成全量
        // strengthen —— 在持续变动（滚动吸顶、流式更新）时反复重写整个菜单属性。
        // 陈旧的隐藏项不构成「标记缺失」，忽略它即可。
        for (const key in present) {
          const shouldHide = state.hidden.indexOf(key) >= 0;
          if (present[key] !== shouldHide) return false;
        }
        return true;
      }

      /**
       * 视图签名：模型菜单在每个视图下的稳定标识。
       * 包含来源身份、模型身份、显示名、可用和选中态，不含插件自建节点，
       * 因此插件自己的 DOM 变动不会改变签名、不会造成扫描自激。
       */
      function viewSignature(menu) {
        return JSON.stringify(readSnapshot(menu).providers.map(function (provider) {
          return [provider.identity, provider.label, provider.items.map(function (item) { return [item.key, item.name, item.selected, item.button.disabled === true]; })];
        }));
      }

      /** 还原当前菜单上被我们写过的属性。 */
      function restoreMenu() {
        for (const [input, attrs] of originalSearchAttrs) {
          [['placeholder', attrs.placeholder], ['aria-label', attrs.label], ['type', attrs.type]].forEach(function (pair) {
            if (pair[1] === null) input.removeAttribute(pair[0]);
            else input.setAttribute(pair[0], pair[1]);
          });
          input.removeAttribute('data-mo-provider-search');
          input.value = '';
        }
        originalSearchAttrs.clear();
        providerQuery = '';
        for (let i = 0; i < touched.length; i++) {
          const node = touched[i];
          if (!node || !node.removeAttribute) continue;
          node.removeAttribute(SCOPE_ATTR);
          node.removeAttribute(SECTION_ATTR);
          node.removeAttribute(COLLAPSED_ATTR);
          node.removeAttribute(HIDDEN_ATTR);
          node.removeAttribute('data-mo-badge');
          node.removeAttribute('data-mo-current');
          node.removeAttribute('data-mo-provider-filtered');
          node.removeAttribute('data-mo-empty-providers');
          node.removeAttribute('data-mo-anchor');
          if (node.style) {
            node.style.removeProperty('--mo-menu-top');
            node.style.removeProperty('--mo-menu-left');
          }
        }
        touched.length = 0;
      }

      // ── 事件：一律在 document 上做捕获期委托，不把监听器挂到 React 节点 ──

      /** 落点反查：是否落在某个来源标题上。 */
      function headingContext(target) {
        if (!target || typeof target.closest !== 'function') return null;
        const heading = target.closest('[data-menu-group-heading]');
        if (heading === null) return null;
        const section = closest('section[role="group"]', heading);
        if (section === null) return null;
        if (menuEl === null || menuEl.contains(section) !== true) return null;
        return { heading: heading, section: section, label: providerLabelOf(section) };
      }

      const onMouseDown = function (event) {
        const target = event.target;
        // 用户改用鼠标操作菜单 → 退出键盘导航状态，恢复折叠。
        // （否则一次方向键会让菜单永久展开，折叠这个核心能力就闲置了。）
        if (keyboardNav === true && menuEl !== null) {
          if (target && typeof target.closest === 'function' && target.closest('[data-menu-material]') !== null) {
            keyboardNav = false;
            applyFolding();
          }
        }
        // ── 面板内部：必须先于内核的判定把它拦下 ──
        //
        // 【这是本插件最容易翻车的地方】内核在 `document` 的**冒泡期**挂了
        // `closeOutside`：落点不在 rootRef / menuRef 内就 `setOpen(false)` 关掉整个菜单。
        // 面板挂在 `body`，两条判定都不成立 —— 用户一按面板，菜单（连同面板）就没了。
        //
        // 修法：在 `document` 的**捕获期**拦截。捕获期早于冒泡期，
        // `stopPropagation()` 之后事件不会走到内核那个监听器。
        //
        // 非输入控件还要 `preventDefault()`：按下鼠标的默认动作是**移动焦点**，
        // 而焦点一旦离开菜单，内核根节点的 `onBlur` 会看到 relatedTarget 在面板里,
        // 同样判定「离开菜单」并 close()。阻止默认动作能让焦点留在原处。
        //
        // 两点必须分开处理：
        //   · 输入框放行默认动作，否则用户没法打字（其失焦由 onFocusOut 兜住）；
        //   · **只有主键（左键）才 preventDefault** —— 右键的默认行为是弹出上下文菜单，
        //     拦掉它会让用户在面板里按右键没反应。中键/右键仍然要 `stopPropagation`，
        //     因为内核的 `closeOutside` 对任何 mouse button 都会触发。
        const primary = event.button === 0 || event.button === undefined;
        if (panel.contains(target)) {
          event.stopPropagation();
          if (primary && !isTextEntry(target)) event.preventDefault();
          return;
        }
        const ctx = headingContext(target);
        if (ctx !== null) {
          if (primary) event.preventDefault();
          return;
        }
        if (panel.hidden) return;
        if (menuEl !== null && menuEl.contains(target)) return;
        closePanel();
      };

      /**
       * 焦点离开菜单进入面板时，拦掉 `focusout`。
       *
       * 输入框需要真的拿到焦点（用户要打字），但那会产生一次 `focusout`：
       * 内核根节点的 React `onBlur` 会看到 relatedTarget 在面板里
       * （不在 rootRef/menuRef 内）而 `close()`。在 `document` 捕获期拦下它 ——
       * React 的委托监听挂在根容器上、位于 document 之下，捕获期拦截同样有效。
       */
      const onFocusOut = function (event) {
        const related = event.relatedTarget;
        if (related === null || related === undefined) return;
        if (panel.contains(related)) event.stopPropagation();
      };

      const onMouseOver = function (event) {
        if (state.mode !== 'hover') return;
        const ctx = headingContext(event.target);
        if (ctx === null) return;
        if (openProvider !== ctx.label || panel.hidden) openPanel(ctx.label);
      };

      // 只有一种交互方式：悬浮与点击都立即打开，不再等待双击判定。
      const onTitleClick = function (event) {
        const ctx = headingContext(event.target);
        if (ctx === null || !ctx.section.isConnected) return;
        event.preventDefault();
        event.stopPropagation();
        openPanel(ctx.label);
      };

      /**
       * 用户是否正在用键盘操作原生菜单。
       *
       * 内核的上下键导航走它自己的 React 状态，看不见我们 CSS 里的隐藏；
       * 一旦用户按方向键，就必须展开，好让「高亮行」与「可见行」一致
       * （否则 Enter 会选中一个看不见的模型）。详见 mustExpandNatively。
       */
      let keyboardNav = false;

      const onKeyDown = function (event) {
        if (event.target.hasAttribute && event.target.hasAttribute('data-mo-provider-search')) {
          if (event.key === 'Escape' && providerQuery !== '') {
            event.preventDefault(); event.stopPropagation(); providerQuery = ''; applyProviderSearch(); return;
          }
          if (!event.isComposing && ['ArrowDown', 'ArrowUp', 'Enter'].includes(event.key)) {
            event.preventDefault(); event.stopPropagation();
            const providers = Array.prototype.slice.call(menuEl.querySelectorAll('section[role="group"]:not([data-mo-provider-filtered])'));
            if (providers.length > 0) {
              openPanel(providerLabelOf(providers[event.key === 'ArrowUp' ? providers.length - 1 : 0]));
              searchInput.focus();
            }
          }
          return;
        }
        if (!panel.hidden && isInsidePanel(event.target)) {
          const sortMenu = panel.querySelector('.mo-sort-menu');
          if (event.key === 'Escape' && !sortMenu.hidden) { event.preventDefault(); event.stopPropagation(); sortMenu.hidden = true; panel.querySelector('.mo-sort-trigger').setAttribute('aria-expanded', 'false'); panel.querySelector('.mo-sort-trigger').focus(); return; }
          if (event.target.getAttribute && event.target.getAttribute('data-act') === 'alias' && event.key === 'Enter' && !event.isComposing) {
            event.preventDefault(); event.stopPropagation(); editingAlias = null; renderPanel(); searchInput.focus(); return;
          }
          if (event.key === 'Escape' && editingAlias !== null) {
            event.preventDefault(); event.stopPropagation(); editingAlias = null; renderPanel(); searchInput.focus(); return;
          }
          if (event.key === 'Escape' && query !== '') {
            event.preventDefault();
            event.stopPropagation();
            query = '';
            renderPanel();
            searchInput.focus();
            return;
          }
          const inSearch = event.target === searchInput;
          const inModel = event.target.getAttribute && event.target.getAttribute('data-act') === 'choose';
          if ((inSearch || inModel) && !event.isComposing && (event.key === 'ArrowDown' || event.key === 'ArrowUp' || (inSearch && event.key === 'Enter' && normalizeQuery(query) !== ''))) {
            const rows = Array.prototype.slice.call(panel.querySelectorAll('[data-act="choose"]:not([data-disabled="1"])')).filter(row => !row.closest('[hidden]'));
            event.preventDefault();
            event.stopPropagation();
            if (rows.length === 0) return;
            if (event.key === 'Enter') { rows[0].click(); return; }
            const index = rows.indexOf(event.target);
            if (inSearch) rows[event.key === 'ArrowDown' ? 0 : rows.length - 1].focus();
            else if (event.key === 'ArrowUp' && index === 0) searchInput.focus();
            else rows[(index + (event.key === 'ArrowDown' ? 1 : -1) + rows.length) % rows.length].focus();
            return;
          }
        }
        if (event.key === 'Escape' && !panel.hidden) {
          closePanel();
        }
        // 方向键 / Tab / Enter 是内核导航菜单用的键；命中即认为进入键盘导航。
        //
        // 【必须限定在原生菜单内】这些键在**插件自己的面板**里同样常用：
        // 用户在面板搜索框里按方向键移动光标、按 Tab 换焦点、按 Enter 确认 ——
        // 若不加限定就会把原生菜单无谓展开（折叠状态被冲掉，用户再打开菜单
        // 会发现所有来源都摊开了）。所以先确认落点在原生菜单子树内、且不在面板里。
        if ((event.key === 'ArrowDown' || event.key === 'ArrowUp' || event.key === 'Tab' || event.key === 'Enter') && menuEl !== null) {
          const target = event.target;
          if (isInsidePanel(target)) return;
          // 命中范围与内核一致：内核把 onKeyDown 挂在它的 rootRef 上，而菜单是
          // React portal —— 事件按 **React 树**传播，所以真实按键的 target 是
          // 「菜单内的焦点元素」（内核搜索框 / 某个模型项），
          // 也可能是**配对 trigger**（焦点在按钮上时按方向键）。
          const surface = closest('[data-menu-material]', menuEl) || menuEl;
          const trigger = findTrigger(doc, menuEl);
          let inMenu = false;
          if (target && typeof surface.contains === 'function' && surface.contains(target)) inMenu = true;
          else if (trigger !== null && target === trigger) inMenu = true;
          if (inMenu && keyboardNav !== true) {
            keyboardNav = true;
            providerQuery = '';
            applyProviderSearch();
            applyFolding();
          }
        }
      };

      /**
       * 内核搜索框的输入走这里。
       *
       * 观察器只盯 `childList`，而用户在搜索框里打字**不改子节点**（只改 value），
       * 所以折叠状态不会自己跟着更新 —— 必须显式监听 `input`。
       * 这里只在内核搜索的激活状态**发生变化**时重折叠，避免每次按键都重写属性。
       */
      let lastKernelSearching = false;
      const onKernelSearchInput = function (event) {
        const target = event.target;
        if (target === null || typeof target.getAttribute !== 'function') return;
        if (target.getAttribute('role') !== 'searchbox') return;
        if (menuEl === null) return;
        const surface = closest('[data-menu-material]', menuEl) || menuEl;
        if (!surface.contains(target)) return;
        if (target.hasAttribute('data-mo-provider-search')) {
          event.stopPropagation(); providerQuery = target.value; applyProviderSearch(); return;
        }
        const searching = kernelSearchQuery() !== '';
        if (searching === lastKernelSearching) return;
        lastKernelSearching = searching;
        applyFolding();
      };

      const onPanelClick = function (event) {
        const target = event.target;
        if (!panel.contains(target)) return;
        const actNode = typeof target.closest === 'function' ? target.closest('[data-act]') : null;
        const act = actNode !== null ? actNode.getAttribute('data-act') : null;
        if (act === null) {
          panel.querySelector('.mo-sort-menu').hidden = true;
          panel.querySelector('.mo-sort-trigger').setAttribute('aria-expanded', 'false');
          return;
        }
        event.preventDefault();
        event.stopPropagation();
        const sortMenu = panel.querySelector('.mo-sort-menu');
        if (act === 'sort-menu') { sortMenu.hidden = !sortMenu.hidden; actNode.setAttribute('aria-expanded', sortMenu.hidden ? 'false' : 'true'); placePanel(); return; }
        sortMenu.hidden = true; panel.querySelector('.mo-sort-trigger').setAttribute('aria-expanded', 'false');
        if (act === 'sort-order') { state.sortOrder = actNode.getAttribute('data-order'); saveState(); renderPanel(); panel.querySelector('.mo-sort-trigger').focus(); return; }
        if (act === 'close') {
          closePanel();
          return;
        }
        if (act === 'overview') { openPanel(null); return; }
        if (act === 'search-scope') { searchAll = actNode.getAttribute('data-scope') === 'all'; editingAlias = null; renderPanel(); searchInput.focus(); return; }
        if (act === 'series') {
          const key = actNode.getAttribute('data-key');
          // Search always reveals all matches; don't silently hide search hits.
          if (normalizeQuery(query) !== '') return;
          state.collapsedSeries = toggleInList(state.collapsedSeries, key, 256); saveState(); renderPanel();
          for (const button of panel.querySelectorAll('[data-act="series"]')) if (button.getAttribute('data-key') === key) { button.focus({ preventScroll: true }); break; }
          return;
        }
        if (act === 'manage') {
          managing = !managing;
          editingAlias = null;
          manageFilter = 'all';
          renderPanel();
          return;
        }
        if (act === 'manage-all') {
          managing = true;
          openProvider = null;
          openProviderIdentity = null;
          editingAlias = null;
          renderPanel();
          return;
        }
        if (act === 'clear-search') {
          query = '';
          renderPanel();
          searchInput.focus();
          return;
        }
        if (act === 'manage-off') {
          managing = false;
          editingAlias = null;
          renderPanel();
          placePanel();
          return;
        }
        const key = actNode.getAttribute('data-key');
        if (act === 'manage-filter') { manageFilter = actNode.getAttribute('data-filter'); editingAlias = null; renderPanel(); return; }
        if (act === 'edit-alias' || (act === 'choose' && managing)) {
          editingAlias = key;
          renderPanel();
          const inputs = panel.querySelectorAll('[data-act="alias"]');
          for (const input of inputs) if (input.getAttribute('data-key') === key) { input.focus(); input.select(); if (typeof input.scrollIntoView === 'function') input.scrollIntoView({ block: 'nearest' }); break; }
          return;
        }
        if (act === 'alias-done') { editingAlias = null; renderPanel(); searchInput.focus(); return; }
        if (act === 'fav') {
          const restoreFocus = actNode === doc.activeElement;
          if (state.favorites.indexOf(key) < 0 && state.favorites.length >= FAVORITES_CAP) {
            footEl.hidden = false;
            footEl.textContent = '最多置顶 ' + FAVORITES_CAP + ' 个模型，请先取消一个置顶。';
            placePanel();
            return;
          }
          state.favorites = toggleInList(state.favorites, key, FAVORITES_CAP);
          saveState();
          renderPanel();
          // 重绘后仍让键盘用户停在同一颗星上。
          if (restoreFocus) {
            const buttons = panel.querySelectorAll('[data-act="fav"]');
            for (let i = 0; i < buttons.length; i++) if (buttons[i].getAttribute('data-key') === key) { buttons[i].focus(); break; }
          }
          return;
        }
        if (act === 'hide') {
          state.hidden = toggleInList(state.hidden, key, 0);
          state.favorites = removeFromList(state.favorites, key);
          saveState();
          // 隐藏后必须同时刷新**行标记与来源徽标**：徽标只数可见模型，
          // 只更新行标记会让标题继续显示虚高的数量。
          if (menuEl !== null) {
            applyHiddenFlags(snapshotOf(menuEl));
            applyHeadings();
          }
          renderPanel();
          return;
        }
        if (act === 'unhide') {
          state.hidden = removeFromList(state.hidden, key);
          saveState();
          if (menuEl !== null) {
            applyHiddenFlags(snapshotOf(menuEl));
            applyHeadings();
          }
          renderPanel();
          return;
        }
        if (act === 'provider') {
          openPanel(key);
          return;
        }
        if (act === 'choose') {
          const entry = visibleEntries().filter(function (item) {
            return item.key === key;
          })[0];
          if (entry) choose(entry);
        }
      };

      const onPanelInput = function (event) {
        const target = event.target;
        if (!panel.contains(target)) return;
        if (target === searchInput) {
          query = target.value;
          renderPanel();
          return;
        }
        const act = typeof target.getAttribute === 'function' ? target.getAttribute('data-act') : null;
        if (act === 'alias') {
          const key = target.getAttribute('data-key');
          const value = String(target.value || '').trim().slice(0, ALIAS_MAX);
          if (value === '') delete state.aliases[key];
          else state.aliases[key] = value;
          saveState();
          // 只刷新同一行里的标签，不重建输入框（否则光标会跳）。
          // 注意：别名输入框与行是**兄弟**关系（同在包装 div 内），所以不能对
          // 输入框用 closest('.mo-row')（closest 只向上找祖先），要从包装元素里查。
          const wrapper = target.closest('.mo-edit-row');
          const row = wrapper !== null ? wrapper.querySelector('.mo-row') : null;
          if (row !== null) {
            const nameNode = row.querySelector('.mo-row-name');
            if (nameNode !== null) {
              // 从行上的 data-name 取原始模型名（而不是从 key 反解 —— 见 modelRow 的注释）。
              const original = row.getAttribute('data-name') || key;
              nameNode.textContent = resolveLabel(state.aliases, key, original);
              const mark = row.querySelector('.mo-alias-mark');
              if (mark) mark.remove();
              if (nameNode.textContent !== original) nameNode.parentElement.appendChild(el(doc, 'span', { class: 'mo-alias-mark', text: '✎', title: '自定义名称', 'aria-label': '自定义名称' }));
            }
          }
        }
      };

      // ── 启动 ──
      /** 本实例的样式所有权令牌（见 ensureStyle 的说明）。 */
      const styleToken = String(Date.now()) + '-' + String(Math.random()).slice(2);
      ensureStyle(doc, styleToken);
      buildPanel();
      applySettings();
      // 设置页（React 设置卡）改偏好时收到广播：重读并刷新 DOM。
      const unsubscribeSettings = subscribeSettings(function () {
        // 跳过自己写出的那次广播（置顶/最近/隐藏等高频写不需要重刷一遍设置）。
        try {
          if (win.localStorage.getItem(STORAGE_KEY) === lastSelfWrite) return;
        } catch (error) {
          /* 读不到就照常重读 */
        }
        const next = loadState();
        // mode 是「当前会话里点的」，设置页改的是「默认模式」；
        // 两者都直接落到 state.mode —— 设置页保存即生效。
        state = next;
        applyFolding();
        applySettings();
      });
      panel.addEventListener('click', onPanelClick);
      panel.addEventListener('input', onPanelInput);
      doc.body.appendChild(panel);
      doc.addEventListener('mousedown', onMouseDown, true);
      doc.addEventListener('focusout', onFocusOut, true);
      doc.addEventListener('click', onTitleClick, true);
      doc.addEventListener('mouseover', onMouseOver, false);
      doc.addEventListener('keydown', onKeyDown, true);
      doc.addEventListener('input', onKernelSearchInput, true);
      doc.addEventListener('change', onKernelSearchInput, true);
      doc.addEventListener('search', onKernelSearchInput, true);

      let timer = null;
      /**
       * 渲染重入守卫。
       *
       * 【为什么必须有】观察器盯的是 `document.body` 子树，而面板（也在 body 里）
       * 的每次重渲染本身就是 childList 变动 → 又触发观察器 → 又重渲染，形成
       * **无限循环**，浏览器会直接卡死。所以这里双保险：
       *   1) `rendering` 标记：渲染期间产生的变动直接忽略；
       *   2) 变动记录全部落在插件自建节点（面板）内时也忽略。
       * 视图本身的变化（内核换 pane、搜索过滤）由菜单签名比对兜住，不会漏。
       */
      let rendering = false;
      /** 上一次渲染所依据的视图签名，用于避免无谓重渲染。 */
      let lastViewSignature = null;

      /** 判断一组变动记录是否全部来自插件自建 DOM。 */
      function mutationsAreOwn(mutations) {
        for (let i = 0; i < mutations.length; i++) {
          const target = mutations[i].target;
          if (target === panel) continue;
          if (typeof target.closest === 'function' && target.closest('#' + PANEL_ID) !== null) continue;
          return false;
        }
        return mutations.length > 0;
      }

      /** 建一个观察器；老渲染进程缺 MutationObserver 时退化为空实现（仍会同步增强一次）。 */
      const MutationObserverCtor = win.MutationObserver;
      /** 防抖窗口（毫秒）。 */
      const SCAN_DEBOUNCE_MS = 120;
      /** 最长等待（毫秒）：保证持续变动下 `scan()` 仍会执行。 */
      const SCAN_MAX_WAIT_MS = 400;
      /** 本轮防抖窗口的起点，用于实现「最长等待」。 */
      let timerStartedAt = 0;
      /** 防抖触发：清空句柄后扫描。 */
      const fireScan = function () {
        timer = null;
        scan();
      };
      const observer = typeof MutationObserverCtor === 'function'
        ? new MutationObserverCtor(function (mutations) {
            if (rendering) return;
            if (mutationsAreOwn(mutations)) return;
            const now = Date.now();
            // 没有待决定时器 → 开一个新的防抖窗口
            if (timer === null) {
              timerStartedAt = now;
              timer = win.setTimeout(fireScan, SCAN_DEBOUNCE_MS);
              return;
            }
            // 【最长等待】单纯「每次变动就重排定时器」在**持续**变动下会饿死：
            // 只要变动间隔始终小于 120ms，`scan()` 就永远不执行，插件停在旧状态
            // （内核流式更新、滚动驱动吸顶标题时都会连续变动）。所以等待超过上限后
            // **立刻执行**，而不是继续顺延 —— 继续顺延等于又把它推后 120ms，
            // 照样饿死。
            if (now - timerStartedAt >= SCAN_MAX_WAIT_MS) {
              win.clearTimeout(timer);
              fireScan();
              return;
            }
            // 仍在窗口内 → 标准防抖：顺延
            win.clearTimeout(timer);
            timer = win.setTimeout(fireScan, SCAN_DEBOUNCE_MS);
          })
        : { observe: function () {}, disconnect: function () {} };
      observer.observe(doc.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['disabled', 'aria-disabled', 'aria-checked', 'title'] });

      /** 窗口尺寸变化时重新贴靠。 */
      /**
       * 重新贴靠面板与启动按钮。
       *
       * 必须同时听 `resize` 与 `scroll`：内核自己是在
       * `window.addEventListener("scroll", place, true)`（**捕获期**）＋ `resize`
       * 上重算菜单位置的。菜单会随页面滚动移动，而面板/启动按钮用的是 `fixed`
       * 视口坐标 —— 只听 resize 的话，一滚动两者就会与菜单错位。
       * 所以这里用与内核相同的两个事件与相同的捕获标志。
       */
      const onResize = function () {
        placePanel();
      };
      win.addEventListener('resize', onResize);
      win.addEventListener('scroll', onResize, true);
      scan();
      const store = catalogStore();
      const unsubscribeCatalog = store && typeof store.subscribe === 'function' ? store.subscribe(function () { scan(); }) : null;

      // ── dispose：摘净自己加的每一样东西 ──
      return function dispose() {
        unsubscribeSettings();
        if (typeof unsubscribeCatalog === 'function') unsubscribeCatalog();
        if (timer !== null) win.clearTimeout(timer);
        observer.disconnect();
        doc.removeEventListener('mousedown', onMouseDown, true);
        doc.removeEventListener('focusout', onFocusOut, true);
        doc.removeEventListener('click', onTitleClick, true);
        doc.removeEventListener('mouseover', onMouseOver, false);
        doc.removeEventListener('keydown', onKeyDown, true);
        doc.removeEventListener('input', onKernelSearchInput, true);
        doc.removeEventListener('change', onKernelSearchInput, true);
        doc.removeEventListener('search', onKernelSearchInput, true);
        win.removeEventListener('resize', onResize);
        win.removeEventListener('scroll', onResize, true);
        panel.removeEventListener('click', onPanelClick);
        panel.removeEventListener('input', onPanelInput);
        restoreMenu();
        if (panel.parentNode !== null) panel.parentNode.removeChild(panel);
        // 只有样式表仍属于本实例时才移除 —— 否则会把 HMR 后**新实例**的样式删掉。
        const style = doc.getElementById(STYLE_ID);
        if (style !== null && style.getAttribute(STYLE_OWNER_ATTR) === styleToken && style.parentNode !== null) {
          style.parentNode.removeChild(style);
        }
      };
    }

    // ─────────────────────────────────────────────────────────────────────
    // 设置卡（React 组件，渲染在「插件管理 → 本 bundle 详情页」的
    // plugins.bundle.config 槽位 —— 官方给 bundle 配置指定的位置，
    // dsh-usage-pill 与官方 voice-input bundle 用的都是它）。
    //
    // 设置卡与 DOM 增强运行在两个世界，靠模块级的 readState/writeState/
    // subscribeSettings 桥同步同一份 localStorage 偏好（见上面的「设置桥」）。
    // ─────────────────────────────────────────────────────────────────────

    /** 词典命名空间（ctx.locale.register 与槽位注册的 locale 字段都用它）。 */
    const NS = 'model-organizer';

    /** 中文词典：宿主词典缺失时作为兜底。 */
    const ZH = {
      "settings.note": "修改立即生效，偏好仅保存在当前浏览器。",
      "settings.fontSize": "面板字号",
      "settings.fontSizeHint": "只调整模型浮框，宿主界面保持原字号。",
      "settings.browse": "浏览与排序",
      "settings.series": "按模型系列分组",
      "settings.seriesHint": "系列可折叠；搜索时自动展开，别名不改变归属。",
      "settings.sort": "默认排序",
      "settings.sortHint": "排序作用在组内；未知倍率放最后，倍率不等同实际费用。",
      "settings.default": "默认顺序",
      "settings.name": "名称 A → Z",
      "settings.asc": "倍率 低 → 高",
      "settings.desc": "倍率 高 → 低",
      "settings.on": "开启",
      "settings.off": "关闭",
      "settings.preview": "字号预览",
      "settings.previewProvider": "示例厂商 · 已置顶",
      "settings.data": "本地记录",
      "settings.dataHint": "置顶、最近使用、别名和隐藏记录会随模型菜单实时更新。",
      "settings.pins": "置顶",
      "settings.recents": "最近",
      "settings.aliases": "别名",
      "settings.hidden": "隐藏",
      "settings.reset": "清空偏好数据",
      "settings.resetHint": "只清空模型记录，保留字号设置。",
      "settings.resetButton": "清空",
      "settings.resetConfirm": "确定清空所有模型记录？在离开此页面前可以撤销。",
      "settings.confirmButton": "确认清空",
      "settings.cancel": "取消",
      "settings.cleared": "模型记录已清空。",
      "settings.undo": "撤销清空",
      "settings.restored": "模型记录已恢复。",
      "settings.help": "搜索与整理怎么用",
      "settings.helpProvider": "菜单搜索找厂商；划过或点击厂商，打开该厂商的模型浮框。",
      "settings.helpModels": "浮框可切换当前/全部厂商，搜索原名、别名或模型 ID。全局结果按厂商分层，搜索时展开命中的系列。",
      "settings.helpManage": "在「整理」里置顶、隐藏和改名，用「已隐藏」筛选找回模型。",
      "settings.helpKeys": "搜索时按 Esc 先清空查询，再按一次关闭；方向键选择，回车确认。"
    };
    const EN = {
      "settings.note": "Changes apply immediately. Preferences stay in this browser.",
      "settings.fontSize": "Panel font size",
      "settings.fontSizeHint": "Adjusts model flyouts only; the host keeps its font size.",
      "settings.browse": "Browsing and sorting",
      "settings.series": "Group models by family",
      "settings.seriesHint": "Collapse families; searching reveals matches. Aliases keep their family.",
      "settings.sort": "Default sorting",
      "settings.sortHint": "Sort within groups. Unknown multipliers come last; multipliers are not actual fees.",
      "settings.default": "Default order",
      "settings.name": "Name A → Z",
      "settings.asc": "Multiplier low → high",
      "settings.desc": "Multiplier high → low",
      "settings.on": "On",
      "settings.off": "Off",
      "settings.preview": "Font preview",
      "settings.previewProvider": "Sample provider · Pinned",
      "settings.data": "Local records",
      "settings.dataHint": "Pins, recents, aliases and hidden records update with the model menu.",
      "settings.pins": "Pins",
      "settings.recents": "Recents",
      "settings.aliases": "Aliases",
      "settings.hidden": "Hidden",
      "settings.reset": "Clear preference data",
      "settings.resetHint": "Clears model records only; keeps the font size.",
      "settings.resetButton": "Clear",
      "settings.resetConfirm": "Clear all model records? You can undo before leaving this page.",
      "settings.confirmButton": "Confirm clear",
      "settings.cancel": "Cancel",
      "settings.cleared": "Model records cleared.",
      "settings.undo": "Undo clear",
      "settings.restored": "Model records restored.",
      "settings.help": "Search and organize",
      "settings.helpProvider": "Search the menu for providers; hover or click a provider to open its models.",
      "settings.helpModels": "Choose current or all providers; search names, aliases or model IDs. Global results keep provider headings and reveal matched families.",
      "settings.helpManage": "Use Organize to pin, hide or rename. The Hidden filter lets you restore models.",
      "settings.helpKeys": "Escape clears a query first, then closes. Use arrow keys to navigate and Enter to select."
    };

    /**
     * 取词函数：优先用槽位传入的 t（走 locale: NS 注册的词典），
     * 缺词典时退回本地中文 —— 与 dsh-usage-pill 同样的兜底策略。
     */
    function translator(props) {
      return function (key, params) {
        let text;
        if (props !== null && props !== undefined && typeof props.t === 'function') {
          try { text = props.t(key, params); } catch (error) { text = undefined; }
        }
        if (typeof text !== 'string' || text.length === 0 || text === key) {
          text = ZH[key] !== undefined ? ZH[key] : key;
        }
        if (params) {
          const names = Object.keys(params);
          for (let i = 0; i < names.length; i++) {
            text = text.split('{' + names[i] + '}').join(String(params[names[i]]));
          }
        }
        return text;
      };
    }

    /** 订阅偏好变化的 hook：设置卡自身改动与 DOM 侧改动都会刷新。 */
    function useSettings() {
      const [value, setValue] = useState(readState);
      useEffect(function () {
        const unsubscribe = subscribeSettings(function () { setValue(readState()); });
        setValue(readState());
        return unsubscribe;
      }, []);
      return value;
    }

    /** 局部更新偏好（读-合并-写，并广播给 DOM 侧）。 */
    function updateSettings(patch) {
      writeState(Object.assign({}, readState(), patch));
    }

    /** 设置页：即时预览、记录摘要和可撤销的页内清空。 */
    function ModelOrganizerSettings(props) {
      const t = translator(props);
      const settings = useSettings();
      const [confirming, setConfirming] = useState(false);
      const [backup, setBackup] = useState(null);
      const [notice, setNotice] = useState('');
      // 设置槽可能独立于菜单增强重挂载；它自己持有作用域样式，避免热更新裸排版。
      useLayoutEffect(function () {
        if (props.view !== 'page') return;
        const id = 'dsh-model-organizer-settings-style';
        const token = String(Date.now()) + '-' + String(Math.random());
        let style = document.getElementById(id);
        if (!style) { style = document.createElement('style'); style.id = id; document.head.appendChild(style); }
        style.setAttribute('data-plugin', 'dsh-model-organizer');
        style.setAttribute('data-owner', token);
        style.textContent = buildSettingsCss();
        return function () {
          if (style.getAttribute('data-owner') === token && style.parentNode) style.parentNode.removeChild(style);
        };
      }, [props.view]);
      const clearRef = useRef(null);
      const undoRef = useRef(null);
      const wasConfirming = useRef(false);
      const hasRecords = settings.favorites.length + settings.recents.length + settings.hidden.length + Object.keys(settings.aliases).length > 0;
      // 清空后如果用户在菜单中建立了新记录，不再用旧快照覆盖新选择。
      useEffect(function () {
        if (hasRecords && backup) { setBackup(null); setNotice(''); }
      }, [settings]);
      useEffect(function () {
        if (wasConfirming.current && !confirming) {
          const target = backup ? undoRef.current : clearRef.current;
          if (target) target.focus();
        }
        wasConfirming.current = confirming;
      }, [confirming]);
      if (props.view !== 'page') return null;
      const clear = function () {
        setBackup(readState());
        writeState(resetUserData(readState()));
        setConfirming(false);
        setNotice('settings.cleared');
      };
      const undo = function () {
        if (!backup) return;
        const current = readState();
        if (current.favorites.length + current.recents.length + current.hidden.length + Object.keys(current.aliases).length > 0) {
          setBackup(null);
          return;
        }
        writeState(Object.assign({}, current, {
          favorites: backup.favorites, recents: backup.recents, hidden: backup.hidden, aliases: backup.aliases, collapsedSeries: backup.collapsedSeries,
        }));
        setBackup(null);
        setNotice('settings.restored');
      };
      const stats = [
        ['settings.pins', settings.favorites.length], ['settings.recents', settings.recents.length],
        ['settings.aliases', Object.keys(settings.aliases).length], ['settings.hidden', settings.hidden.length],
      ];
      return h('div', { className: 'mo-settings' },
        h('div', { className: 'mo-hint' }, t('settings.note')),
        h('section', { className: 'mo-card', 'aria-label': t('settings.fontSize') },
          h('div', { className: 'mo-setting-row' },
            h('div', { className: 'mo-setting-text' },
              h('div', { className: 'mo-title' }, t('settings.fontSize')),
              h('div', { className: 'mo-hint' }, t('settings.fontSizeHint'))),
            h('div', { className: 'mo-options', role: 'group', 'aria-label': t('settings.fontSize') },
              ...FONT_SIZES.map(function (size) {
                return h('button', { key: size, type: 'button', 'aria-pressed': settings.fontSize === size,
                  onClick: function () { updateSettings({ fontSize: size }); } }, String(size));
              }))),
          h('div', { className: 'mo-preview', 'aria-label': t('settings.preview'), style: { fontSize: settings.fontSize + 'px' } },
            h('div', null, h('div', null, 'DeepSeek-V4.1-Flash'), h('div', { className: 'mo-hint', style: { fontSize: '0.85em' } }, t('settings.previewProvider'))),
            h('span', { className: 'mo-preview-star', 'aria-hidden': true }, '★'))),
        h('section', { className: 'mo-card', 'aria-label': t('settings.browse') },
          h('div', { className: 'mo-title' }, t('settings.browse')),
          h('div', { className: 'mo-setting-row' },
            h('div', { className: 'mo-setting-text' }, h('div', null, t('settings.series')), h('div', { className: 'mo-hint' }, t('settings.seriesHint'))),
            h('button', { type: 'button', role: 'switch', 'aria-label': t('settings.series'), 'aria-checked': settings.groupSeries, onClick: () => updateSettings({ groupSeries: !settings.groupSeries }) }, t(settings.groupSeries ? 'settings.on' : 'settings.off'))),
          h('div', { className: 'mo-setting-row' }, h('span', null, t('settings.sort')),
            h('select', { 'aria-label': t('settings.sort'), value: settings.sortOrder, onChange: event => updateSettings({ sortOrder: event.target.value }) },
              ...[['default', 'default'], ['name', 'name'], ['price-asc', 'asc'], ['price-desc', 'desc']].map(item => h('option', { key: item[0], value: item[0] }, t('settings.' + item[1]))))),
          h('div', { className: 'mo-tree-preview', 'aria-label': t('settings.preview') },
            settings.groupSeries ? h('div', { className: 'mo-hint' }, '▾ DeepSeek · 2') : null,
            ...['DeepSeek-V4.1-Flash · x0.11', 'DeepSeek-V4-Pro · x0.51'].map(name => h('div', { key: name, className: settings.groupSeries ? 'mo-tree-model' : '' }, name))),
          h('div', { className: 'mo-hint' }, t('settings.sortHint'))),
        h('section', { className: 'mo-card', 'aria-label': t('settings.data') },
          h('div', { className: 'mo-setting-text' }, h('div', { className: 'mo-title' }, t('settings.data')),
            h('div', { className: 'mo-hint' }, t('settings.dataHint'))),
          h('div', { className: 'mo-stats' }, ...stats.map(function (item) {
            return h('span', { key: item[0], className: 'mo-stat' }, h('strong', null, item[1]), h('span', { className: 'mo-hint' }, t(item[0])));
          })),
          h('div', { className: 'mo-setting-row' },
            h('div', { className: 'mo-hint' }, t('settings.resetHint')),
            h('button', { ref: clearRef, type: 'button', className: 'mo-danger', disabled: !hasRecords || confirming,
              onClick: function () { setConfirming(true); setNotice(''); } }, t('settings.resetButton'))),
          confirming ? h('div', { className: 'mo-confirm', role: 'group', 'aria-label': t('settings.reset'),
            onKeyDown: function (event) { if (event.key === 'Escape') { event.stopPropagation(); setConfirming(false); } } },
            h('div', { className: 'mo-hint' }, t('settings.resetConfirm')),
            h('div', { className: 'mo-actions' },
              h('button', { type: 'button', autoFocus: true, onClick: function () { setConfirming(false); } }, t('settings.cancel')),
              h('button', { type: 'button', className: 'mo-danger', onClick: clear }, t('settings.confirmButton')))) : null,
          notice ? h('div', { className: 'mo-setting-row' }, h('span', { className: 'mo-hint', role: 'status' }, t(notice)),
            backup ? h('button', { ref: undoRef, type: 'button', onClick: undo }, t('settings.undo')) : null) : null),
        h('details', { className: 'mo-card' }, h('summary', null, t('settings.help')),
          h('div', { className: 'mo-help mo-hint' },
            ...['settings.helpProvider', 'settings.helpModels', 'settings.helpManage', 'settings.helpKeys'].map(function (key) {
              return h('div', { key: key }, t(key));
            }))));
    }

    return {
      inject: ['slots', 'locale'],
      apply(ctx) {
        // 词典：注册进宿主 locale，槽位用 locale: NS 取词；缺失时组件内兜底中文。
        ctx.effect(function () {
          return ctx.locale.register(NS, { zh: ZH, en: EN });
        }, 'dsh-model-organizer: dictionaries');
        // 设置卡：bundle 自己的配置槽（渲染在本 bundle 插件页的描述与行之间）。
        // 【必须用 ctx.effect 包住】slots.inject 返回 dispose；不包住的话
        // HMR 拆旧实例时设置卡会泄漏下来继续渲染（dsh-usage-pill 踩过同款坑）。
        ctx.effect(function () {
          return ctx.slots.inject('plugins.bundle.config', function () {
            ctx.slots.register({
              name: 'plugins.bundle.config',
              key: 'dsh-model-organizer',
              locale: NS,
            }, ModelOrganizerSettings);
          });
        }, 'dsh-model-organizer: settings card');
        // 客户端 bundle 在窗口就绪后执行；这里统一在 document 上挂增强。
        // 用 ctx.effect 托管生命周期：插件卸载时宿主会调用返回的清理函数。
        ctx.effect(function () {
          let dispose = null;
          const boot = function () {
            // 单例守卫：热重载会反复执行 apply，先拆掉上一个实例再建新的。
            try {
              if (typeof window.__dshModelOrganizerDispose === 'function') {
                window.__dshModelOrganizerDispose();
              }
            } catch (error) {
              /* 旧实例拆卸失败不应阻断新实例 */
            }
            INSTANCE = start(document, window, ctx);
            dispose = INSTANCE;
            try {
              window.__dshModelOrganizerDispose = INSTANCE;
            } catch (error) {
              /* 挂不上全局标记不影响功能 */
            }
            return INSTANCE;
          };
          if (document.readyState === 'loading') {
            let inner = null;
            const onReady = function () {
              document.removeEventListener('DOMContentLoaded', onReady);
              inner = boot();
            };
            document.addEventListener('DOMContentLoaded', onReady);
            return function () {
              document.removeEventListener('DOMContentLoaded', onReady);
              if (typeof inner === 'function') inner();
            };
          }
          return boot();
        }, 'dsh-model-organizer: model-menu organizing');
      },
    };
  },
});
