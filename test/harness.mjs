/**
 * jsdom fixture harness for the DSH composer model picker.
 *
 * Every element this module emits is copied from the real kernel:
 *   - `@deepseek-ai/dsh-client-ui-model-selection` (the `ModelSelect` seat)
 *   - `@deepseek-ai/dsh-client-ui-primitives` (`MenuSurface`, `MenuGroup`)
 *   - `@deepseek-ai/dsh-client-ui-commands` (`PopupSelectView`, the `/model` popup)
 *
 * Load-bearing kernel details reproduced here (see test/fixture-fidelity.test.mjs):
 *   1. Model pane: the OUTER `MenuSurface` div carries `role="group"` while the
 *      INNER `div.groups` carries `role="menu"` + `id="<base>-models"`. Root and
 *      effort panes flip that: outer `role="menu"`, no inner groups container and
 *      therefore no `section[role="group"]` children.
 *   2. `MenuGroup` emits exactly `<span data-menu-group-start aria-hidden>` then
 *      `<div data-menu-group-heading id=<headingId>>` then the caller's children,
 *      inside `<section role="group" aria-labelledby=<headingId> data-menu-group>`.
 *   3. Model rows are `button[role="menuitemradio"]` with `aria-checked`, an id of
 *      the form `<base>-model-<flatIndex>` and `title` = the model display name.
 *   4. Search shows iff `choices.length > 4`.
 *   5. The `/model` popup reuses the SAME `MenuGroup` primitives but inside
 *      `div[role="listbox"]` with `div[role="option"]` rows instead of a menu with
 *      radio buttons — which is exactly why an unscoped selector leaks into it.
 *
 * Only `jsdom` is imported.
 */

import { JSDOM } from 'jsdom';

/** Document-wide heading id counters: React's `useId` is unique per tree too. */
let headingSeq = 0;
let popupHeadingSeq = 0;

const MODEL_MENU_ARIA = '模型与推理等级'; // model:menu.aria
const MODEL_LIST_ARIA = '模型'; // model:menu.model
const SEARCH_PLACEHOLDER = '搜索模型…'; // model:search.placeholder
const POPUP_LISTBOX_ARIA = '选择模型'; // command:listbox.aria

/**
 * Fresh jsdom document with an empty body/head.
 * @returns {{ window: Window, document: Document }}
 */
export function createDom() {
  const dom = new JSDOM(
    '<!doctype html><html><head></head><body></body></html>',
    {
      pretendToBeVisual: true,
      // 必须有真实 origin，否则 jsdom 的 localStorage 抛
      // SecurityError（opaque origins），而插件把偏好存在 localStorage 里。
      url: 'https://dsh.local/',
    },
  );
  const { window } = dom;
  const { document } = window;
  document.body.replaceChildren();
  document.head.replaceChildren();
  return { window, document };
}

/**
 * Empty `document.body` and `document.head` between tests.
 * @param {Document} document
 */
export function resetDom(document) {
  document.body.replaceChildren();
  document.head.replaceChildren();
}

function el(document, tag, className, text) {
  const node = document.createElement(tag);
  if (className !== undefined && className !== '') node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

/**
 * Mirror of the kernel `MenuGroup` primitive.
 * Children order is exact: start sentinel, heading, then rows.
 */
function menuGroup(document, label, prefix, rows) {
  const section = el(document, 'section', 'group');
  const headingId = `${prefix}${prefix === 'P' ? popupHeadingSeq++ : headingSeq++}`;
  section.setAttribute('role', 'group');
  section.setAttribute('aria-labelledby', headingId);
  section.setAttribute('data-menu-group', '');

  const start = el(document, 'span', 'start');
  start.setAttribute('aria-hidden', 'true');
  start.setAttribute('data-menu-group-start', '');

  const heading = el(document, 'div', 'heading', label);
  heading.id = headingId;
  heading.setAttribute('data-menu-group-heading', '');

  section.append(start, heading, ...rows);
  return { section, headingId };
}

/** `<base>-menu` -> `<base>`, matching the kernel's single `useId` prefix. */
function baseIdOf(menuId) {
  return menuId.endsWith('-menu') ? menuId.slice(0, -'-menu'.length) : menuId;
}

function normalizeEfforts(spec) {
  const raw = spec.efforts ?? [
    { key: 'low', label: 'Low', effort: 'low' },
    { key: 'medium', label: 'Medium', effort: 'medium' },
    { key: 'high', label: 'High', effort: 'high' },
  ];
  return raw.map((entry, index) =>
    typeof entry === 'string'
      ? { key: entry, label: entry, effort: entry, index }
      : { index, ...entry });
}

function modelLabelOf(spec) {
  if (spec.modelLabel !== undefined) return spec.modelLabel;
  const selected = spec.selected;
  if (!selected) return '请选择模型';
  for (const provider of spec.providers ?? []) {
    if (provider.id !== selected.provider) continue;
    for (const model of provider.models ?? []) {
      if (model.id === selected.model) return model.name;
    }
  }
  return selected.model;
}

/**
 * Mount the composer `ModelSelect` fixture: root div + open menu surface.
 *
 * @param {Document} document
 * @param {{
 *   menuId?: string,
 *   providers?: Array<{ id: string, label?: string, models: Array<{ id: string, name: string }> }>,
 *   selected?: { provider: string, model: string } | null,
 *   pane?: 'root' | 'model' | 'effort',
 *   showSearch?: boolean,
 *   efforts?: Array<string | { key: string, label: string, effort: string }>,
 *   selectedEffort?: string,
 * }} spec
 * @returns {{
 *   root: HTMLElement, menu: HTMLElement, trigger: HTMLElement,
 *   groupsEl: HTMLElement | null, sections: HTMLElement[],
 *   items: HTMLElement[], cells: HTMLElement[], searchInput: HTMLElement | null,
 * }} refs
 */
export function mountModelMenu(document, spec = {}) {
  const menuId = spec.menuId ?? 'ms-menu';
  const base = baseIdOf(menuId);
  const providers = spec.providers ?? [];
  const pane = spec.pane ?? 'model';
  const selected = spec.selected ?? null;
  const choices = providers.reduce((sum, p) => sum + (p.models?.length ?? 0), 0);
  const showSearch = pane === 'model'
    ? (spec.showSearch ?? choices > 4)
    : false;

  const root = el(document, 'div', 'root');

  // --- trigger (kernel: aria-haspopup=menu, aria-expanded, aria-controls=<id>-menu)
  const trigger = el(document, 'button', 'trigger');
  trigger.type = 'button';
  trigger.setAttribute('aria-label', `选择模型，当前 ${modelLabelOf(spec)}`);
  trigger.setAttribute('aria-haspopup', 'menu');
  trigger.setAttribute('aria-expanded', 'true');
  trigger.setAttribute('aria-controls', menuId);
  trigger.title = modelLabelOf(spec);
  trigger.setAttribute('data-selection-focus', '');
  trigger.append(el(document, 'span', 'triggerLabel', modelLabelOf(spec)));

  // --- MenuSurface (kernel: data-menu-material, material backing div, then children)
  const menu = el(document, 'div', 'surface menu');
  menu.id = menuId;
  menu.setAttribute('role', pane === 'model' ? 'group' : 'menu');
  menu.setAttribute('aria-label', MODEL_MENU_ARIA);
  menu.setAttribute('data-menu-material', 'translucent');

  const material = el(document, 'div', 'material');
  material.setAttribute('aria-hidden', 'true');
  menu.append(material);

  const sections = [];
  const items = [];
  const cells = [];
  let groupsEl = null;
  let searchInput = null;

  if (pane === 'root') {
    const effortLabel = normalizeEfforts(spec).find(
      (level) => level.effort === (spec.selectedEffort ?? 'medium'),
    )?.label ?? 'Default';
    const rowSpecs = [
      { label: '模型', value: modelLabelOf(spec) },
      { label: '推理等级', value: effortLabel },
    ];
    for (const row of rowSpecs) {
      const cell = el(document, 'button', 'cell');
      cell.type = 'button';
      cell.setAttribute('role', 'menuitem');
      const chevron = el(document, 'span', 'cellChevron', '›');
      chevron.setAttribute('aria-hidden', 'true');
      cell.append(
        el(document, 'span', 'cellLabel', row.label),
        el(document, 'span', 'cellValue', row.value),
        chevron,
      );
      cells.push(cell);
      menu.append(cell);
    }
  } else if (pane === 'effort') {
    const levels = normalizeEfforts(spec);
    const selectedEffort = spec.selectedEffort ?? 'medium';
    for (const level of levels) {
      const checked = level.effort === selectedEffort;
      const button = el(
        document,
        'button',
        checked ? 'option selected' : 'option',
      );
      button.type = 'button';
      button.setAttribute('role', 'menuitemradio');
      button.setAttribute('aria-checked', checked ? 'true' : 'false');
      button.append(
        (() => {
          const copy = el(document, 'span', 'optionCopy');
          copy.append(el(document, 'span', 'modelName', level.label));
          return copy;
        })(),
        el(document, 'span', 'check'),
      );
      items.push(button);
      menu.append(button);
    }
  } else {
    // --- pane === 'model'
    if (showSearch) {
      const searchRow = el(document, 'div', 'searchRow');
      searchInput = document.createElement('input');
      searchInput.type = 'text';
      searchInput.className = 'search';
      searchInput.setAttribute('role', 'searchbox');
      searchInput.setAttribute('aria-label', SEARCH_PLACEHOLDER);
      searchInput.setAttribute('aria-controls', `${base}-models`);
      searchInput.placeholder = SEARCH_PLACEHOLDER;
      searchInput.value = '';
      searchRow.append(searchInput);
      menu.append(searchRow);
    }

    groupsEl = el(document, 'div', 'groups scrollable');
    groupsEl.id = `${base}-models`;
    groupsEl.setAttribute('role', 'menu');
    groupsEl.setAttribute('aria-label', MODEL_LIST_ARIA);

    let index = 0;
    for (const provider of providers) {
      const rows = (provider.models ?? []).map((model) => {
        const at = index++;
        const isSelected = selected !== null
          && selected.provider === provider.id
          && selected.model === model.id;
        const button = el(
          document,
          'button',
          isSelected ? 'option modelOption selected' : 'option modelOption',
        );
        button.type = 'button';
        button.setAttribute('role', 'menuitemradio');
        button.setAttribute('aria-checked', isSelected ? 'true' : 'false');
        button.id = `${base}-model-${at}`;
        button.title = model.name;
        button.tabIndex = showSearch ? -1 : 0;

        const copy = el(document, 'span', 'optionCopy');
        copy.append(el(document, 'span', 'modelName', model.name));
        button.append(copy, el(document, 'span', 'check'));
        items.push(button);
        return button;
      });
      const { section } = menuGroup(
        document,
        provider.label ?? provider.id,
        'H',
        rows,
      );
      sections.push(section);
      groupsEl.append(section);
    }

    menu.append(groupsEl);
  }

  root.append(trigger, menu);
  document.body.append(root);

  return { root, menu, trigger, groupsEl, sections, items, cells, searchInput };
}

/**
 * Mount the `/model` popupSelect fixture (`PopupSelectView`): the same shared
 * `MenuGroup` primitives, but inside `div[role="listbox"]` and with
 * `div[role="option"]` rows instead of `button[role="menuitemradio"]`.
 *
 * @param {Document} document
 * @param {{
 *   providers?: Array<{ id: string, label?: string, models: Array<{ id: string, name: string }> }>,
 *   selected?: { provider: string, model: string } | null,
 *   ariaLabel?: string,
 * }} spec
 * @returns {{
 *   root: HTMLElement, listbox: HTMLElement,
 *   sections: HTMLElement[], options: HTMLElement[],
 * }}
 */
export function mountCommandPopup(document, spec = {}) {
  const providers = spec.providers ?? [];
  const selected = spec.selected ?? null;

  const listbox = el(document, 'div', 'viewport');
  listbox.setAttribute('role', 'listbox');
  listbox.setAttribute('aria-label', spec.ariaLabel ?? POPUP_LISTBOX_ARIA);

  const sections = [];
  const options = [];
  let index = 0;
  for (const provider of providers) {
    const rows = (provider.models ?? []).map((model) => {
      const at = index++;
      const isSelected = selected !== null
        && selected.provider === provider.id
        && selected.model === model.id;
      const option = el(document, 'div', 'option');
      option.setAttribute('role', 'option');
      option.setAttribute('aria-selected', isSelected ? 'true' : 'false');
      option.id = `opt-${at}`;
      const label = el(document, 'span', 'label');
      label.append(el(document, 'span', 'labelText', model.name));
      option.append(label);
      options.push(option);
      return option;
    });
    const { section } = menuGroup(
      document,
      provider.label ?? provider.id,
      'P',
      rows,
    );
    sections.push(section);
    listbox.append(section);
  }

  document.body.append(listbox);

  return { root: listbox, listbox, sections, options };
}

/**
 * A realistic dataset resembling this user's setup: the DeepSeek account
 * provider plus two gateway providers.
 * @returns the `mountModelMenu` spec
 */
export function defaultSpec() {
  const natsuki = [
    'gpt-6-astra',
    'grok-4.7',
    'grok-imagine-video',
    'grok-latest',
    'claude-5-opus',
    'claude-5-sonnet',
    'gemini-4-ultra',
    'gemini-4-pro',
    'qwen4-max',
    'qwen4-plus',
    'kimi-k3',
    'glm-6',
    'minimax-m3',
    'doubao-2.5-pro',
    'deepseek-r2',
    'llama-5-405b',
    'mistral-large-3',
    'phi-5',
    'command-r-plus-2',
  ];
  const free = [
    'free-v4-flash',
    'free-v4-pro',
    'free-grok-4.2',
    'free-gpt-5.5',
    'free-qwen3.5',
    'free-glm-5',
    'free-kimi-k2.5',
    'free-minimax-m2.5',
    'free-doubao-1.8',
  ];

  return {
    menuId: 'ms-menu',
    pane: 'model',
    selected: { provider: 'deepseek-account', model: 'DeepSeek-V4.1-Flash' },
    providers: [
      {
        id: 'deepseek-account',
        label: 'DeepSeek',
        models: [
          { id: 'DeepSeek-V4.1-Flash', name: 'DeepSeek-V4.1-Flash' },
          { id: 'DeepSeek-V4-Pro', name: 'DeepSeek-V4-Pro' },
          { id: 'DeepSeek-V4-Flash', name: 'DeepSeek-V4-Flash' },
          { id: 'DeepSeek-V4-Flash-Vision-Exp', name: 'DeepSeek-V4-Flash-Vision-Exp' },
        ],
      },
      {
        id: 'natsuki',
        label: 'Natsuki 网关',
        models: natsuki.map((name) => ({ id: name, name })),
      },
      {
        id: 'our-free-model',
        label: 'Free 模型',
        models: free.map((name) => ({ id: name, name })),
      },
    ],
  };
}

/** 面板根 id（与插件一致）。 */
export const PANEL_ID = 'dsh-model-organizer-panel';

/** 取分组标题元素。 */
export function headingOf(section) {
  return section.querySelector('[data-menu-group-heading]');
}

/**
 * 通过「划过来源标题」打开插件面板 —— 替代已移除的 🗂 启动按钮。
 *
 * 插件不再有独立入口：hover 模式划一下标题、panel 模式点一下标题即可开面板。
 * 这里用 mouseover（两种模式都成立），并返回面板元素便于继续断言。
 *
 * 参数宽容处理：
 *   · 第一个参数可以是 env（含 window/document），也可以直接是 window；
 *   · 第二个参数 view 可省略 —— 省略时直接从 document 里找已增强的来源分组。
 *
 * @param {object} envOrWindow - createPluginEnv 的 env，或 jsdom window。
 * @param {object} [view] - mountModelMenu 的返回值（可选）。
 * @param {number} [index] - 用第几个来源触发，默认 0。
 * @returns {HTMLElement} 面板元素。
 */
export function openPanelViaHeading(envOrWindow, view, index = 0) {
  const win = envOrWindow && envOrWindow.window ? envOrWindow.window : envOrWindow;
  const doc = envOrWindow && envOrWindow.document ? envOrWindow.document : win.document;
  let section = view && view.sections ? view.sections[index] : null;
  if (!section) {
    const sections = doc.querySelectorAll('[data-mo-section]');
    if (sections.length === 0) throw new Error('找不到已增强的来源分组，无法打开面板');
    section = sections[Math.min(index, sections.length - 1)];
  }
  const heading = headingOf(section);
  if (!heading) throw new Error('来源分组里没有 [data-menu-group-heading]');
  heading.dispatchEvent(new win.MouseEvent('mouseover', { bubbles: true }));
  return doc.getElementById(PANEL_ID);
}
