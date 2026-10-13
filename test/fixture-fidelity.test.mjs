/**
 * Fixture fidelity: prove the jsdom harness in ./harness.mjs actually mirrors the
 * real kernel DOM emitted by `@deepseek-ai/dsh-client-ui-model-selection` and the
 * shared `MenuSurface` / `MenuGroup` / `PopupSelectView` primitives. If the kernel
 * markup changes, these tests fail rather than letting the fixture silently drift.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  createDom,
  resetDom,
  mountModelMenu,
  mountCommandPopup,
  defaultSpec,
} from './harness.mjs';

/** Fresh document per test so cross-test pollution can never mask a bug. */
function freshDom() {
  const { document } = createDom();
  resetDom(document);
  return document;
}

function choicesOf(spec) {
  return (spec.providers ?? []).reduce(
    (sum, provider) => sum + (provider.models?.length ?? 0),
    0,
  );
}

test('model pane: outer surface is role=group, inner role=menu holds every section', () => {
  const document = freshDom();
  const spec = defaultSpec();
  const { root, menu, groupsEl, sections, items } = mountModelMenu(document, spec);

  assert.equal(root.parentNode, document.body, 'menu portals to body');
  assert.equal(menu.getAttribute('role'), 'group', 'model pane surface is a group');
  assert.equal(menu.getAttribute('data-menu-material'), 'translucent');

  assert.ok(groupsEl, 'inner groups container exists');
  assert.equal(groupsEl.getAttribute('role'), 'menu');
  // menuId is `<base>-menu`; the kernel derives every other id from `<base>`.
  assert.equal(groupsEl.id, 'ms-models');
  assert.equal(groupsEl.parentNode, menu);

  assert.ok(sections.length > 0, 'has provider sections');
  for (const section of sections) {
    assert.equal(section.parentNode, groupsEl, 'sections are direct children of inner menu');
    assert.ok([...groupsEl.children].includes(section));
  }

  // Every section in the document is accounted for by the returned refs.
  const allSections = [...document.querySelectorAll('section[role="group"]')];
  assert.equal(allSections.length, sections.length);

  // Flat item list is exactly the model radio buttons.
  const radios = [...document.querySelectorAll('button[role="menuitemradio"]')];
  assert.equal(radios.length, items.length);
  assert.equal(radios.length, choicesOf(spec));
});

test('every section: start sentinel, then heading, with matching aria-labelledby', () => {
  const document = freshDom();
  const { sections } = mountModelMenu(document, defaultSpec());

  assert.ok(sections.length >= 3);
  for (const section of sections) {
    const children = [...section.children];
    assert.ok(children.length >= 3, 'section has sentinel, heading and rows');

    const first = children[0];
    assert.equal(first.tagName, 'SPAN', 'first child is the start sentinel');
    assert.ok(first.hasAttribute('data-menu-group-start'));
    assert.equal(first.getAttribute('aria-hidden'), 'true');

    const second = children[1];
    assert.equal(second.tagName, 'DIV', 'second child is the heading');
    assert.ok(second.hasAttribute('data-menu-group-heading'));
    assert.ok(second.id.length > 0, 'heading has an id');

    assert.equal(
      section.getAttribute('aria-labelledby'),
      second.id,
      'section is labelled by its own heading',
    );
    assert.equal(section.getAttribute('role'), 'group');
    assert.ok(section.hasAttribute('data-menu-group'));

    // Remaining children are the model rows, never nested groups.
    for (const row of children.slice(2)) {
      assert.equal(row.getAttribute('role'), 'menuitemradio');
    }
  }
});

test('heading ids are unique across the document', () => {
  const document = freshDom();
  const { sections } = mountModelMenu(document, defaultSpec());

  const ids = sections.map((section) => {
    const heading = section.querySelector(':scope > [data-menu-group-heading]');
    return heading.id;
  });
  assert.equal(new Set(ids).size, ids.length, 'heading ids collide');

  const allHeadings = [...document.querySelectorAll('[data-menu-group-heading]')];
  const allIds = allHeadings.map((heading) => heading.id);
  assert.equal(new Set(allIds).size, allIds.length, 'document-wide heading ids collide');
});

test('model buttons are menuitemradio with title, unique id, and one checked match', () => {
  const document = freshDom();
  const spec = defaultSpec();
  const { items } = mountModelMenu(document, spec);

  assert.equal(items.length, choicesOf(spec));

  const ids = new Set();
  const checked = [];
  for (const item of items) {
    assert.equal(item.tagName, 'BUTTON');
    assert.equal(item.getAttribute('role'), 'menuitemradio');
    assert.equal(item.type, 'button');
    assert.ok(item.title && item.title.length > 0, 'title carries the model name');
    assert.ok(item.id.length > 0);
    assert.ok(!ids.has(item.id), `duplicate button id ${item.id}`);
    ids.add(item.id);
    assert.match(item.id, /^ms-model-\d+$/);
    assert.ok(
      item.querySelector('span.modelName')?.textContent === item.title,
      'visible name matches the title attribute',
    );
    if (item.getAttribute('aria-checked') === 'true') checked.push(item);
  }

  assert.equal(checked.length, 1, 'exactly one row is checked');
  assert.equal(checked[0].title, 'DeepSeek-V4.1-Flash');
  assert.equal(
    checked[0].id,
    `ms-model-${items.indexOf(checked[0])}`,
    'checked id index matches flat order',
  );

  // aria-checked must be the literal string React emits.
  for (const item of items) {
    assert.ok(['true', 'false'].includes(item.getAttribute('aria-checked')));
  }

  // No selection => nothing checked.
  const document2 = freshDom();
  const { items: items2 } = mountModelMenu(document2, {
    ...defaultSpec(),
    selected: null,
  });
  assert.equal(items2.filter((i) => i.getAttribute('aria-checked') === 'true').length, 0);
});

test('searchbox exists iff choices > 4 and points at the sections container', () => {
  const document = freshDom();
  const big = defaultSpec();
  assert.ok(choicesOf(big) > 4);
  const withSearch = mountModelMenu(document, big);

  assert.ok(withSearch.searchInput, 'search shown for a large catalog');
  assert.equal(withSearch.searchInput.getAttribute('role'), 'searchbox');
  assert.equal(withSearch.searchInput.type, 'text');
  assert.equal(withSearch.searchInput.placeholder, '搜索模型…');
  assert.equal(withSearch.searchInput.value, '');
  assert.equal(
    withSearch.searchInput.getAttribute('aria-controls'),
    withSearch.groupsEl.id,
    'aria-controls points at the groups container',
  );
  assert.equal(
    document.getElementById(withSearch.searchInput.getAttribute('aria-controls')),
    withSearch.groupsEl,
  );

  // Small catalog (<= 4 choices) => no search row.
  const document2 = freshDom();
  const small = mountModelMenu(document2, {
    menuId: 'small-menu',
    pane: 'model',
    selected: { provider: 'p', model: 'a' },
    providers: [
      { id: 'p', label: 'P', models: [{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }] },
    ],
  });
  assert.equal(small.searchInput, null);
  assert.equal(document2.querySelector('[role="searchbox"]'), null);
  assert.ok(small.sections.length > 0, 'no search does not remove the groups');

  // Exactly 4 choices stays below the threshold; 5 crosses it.
  const four = [
    { id: 'p', label: 'P', models: [{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }] },
    { id: 'q', label: 'Q', models: [{ id: 'c', name: 'C' }, { id: 'd', name: 'D' }] },
  ];
  const document4 = freshDom();
  const atFour = mountModelMenu(document4, {
    menuId: 'm4',
    providers: four,
    selected: null,
  });
  assert.equal(atFour.searchInput, null, '4 choices => no search');

  const document5 = freshDom();
  const atFive = mountModelMenu(document5, {
    menuId: 'm5',
    providers: [
      ...four,
      { id: 'r', label: 'R', models: [{ id: 'e', name: 'E' }] },
    ],
    selected: null,
  });
  assert.ok(atFive.searchInput, '5 choices => search');
});

test('root and effort panes have zero sections and a role=menu outer surface', () => {
  const document = freshDom();
  const root = mountModelMenu(document, { ...defaultSpec(), pane: 'root' });

  assert.equal(root.menu.getAttribute('role'), 'menu');
  assert.equal(root.sections.length, 0);
  assert.equal(document.querySelectorAll('section[role="group"]').length, 0);
  assert.equal(document.querySelector('[data-menu-group-heading]'), null);
  assert.equal(root.searchInput, null);
  assert.equal(root.items.length, 0, 'root pane has no radio rows');

  const cells = [...root.menu.querySelectorAll('button[role="menuitem"]')];
  assert.equal(cells.length, 2, 'model + effort cells');
  assert.match(cells[0].textContent, /模型/);
  assert.match(cells[1].textContent, /推理等级/);

  const document2 = freshDom();
  const effort = mountModelMenu(document2, { ...defaultSpec(), pane: 'effort' });

  assert.equal(effort.menu.getAttribute('role'), 'menu');
  assert.equal(effort.sections.length, 0);
  assert.equal(document2.querySelectorAll('section[role="group"]').length, 0);
  assert.equal(effort.searchInput, null);

  const effortItems = [...effort.menu.querySelectorAll('button[role="menuitemradio"]')];
  assert.ok(effortItems.length > 1);
  for (const item of effortItems) {
    assert.equal(item.parentNode, effort.menu, 'effort rows are flat on the surface');
  }
  assert.equal(
    effortItems.filter((i) => i.getAttribute('aria-checked') === 'true').length,
    1,
  );
});

test('/model popup: listbox + MenuGroup options, no radios and no inner menu', () => {
  const document = freshDom();
  const spec = defaultSpec();
  const { listbox, sections, options } = mountCommandPopup(document, spec);

  assert.equal(listbox.getAttribute('role'), 'listbox');
  assert.ok(listbox.getAttribute('aria-label'));

  assert.ok(sections.length >= 2, 'at least two providers');
  for (const section of sections) {
    assert.equal(section.getAttribute('role'), 'group');
    assert.ok(section.hasAttribute('data-menu-group'));
    assert.equal(section.parentNode, listbox);

    const children = [...section.children];
    assert.equal(children[0].tagName, 'SPAN');
    assert.ok(children[0].hasAttribute('data-menu-group-start'));

    const heading = children[1];
    assert.equal(heading.tagName, 'DIV');
    assert.ok(heading.hasAttribute('data-menu-group-heading'));
    assert.equal(section.getAttribute('aria-labelledby'), heading.id);
  }

  assert.equal(options.length, choicesOf(spec));
  assert.ok(options.length >= 4);
  for (const option of options) {
    assert.equal(option.tagName, 'DIV');
    assert.equal(option.getAttribute('role'), 'option');
    assert.ok(['true', 'false'].includes(option.getAttribute('aria-selected')));
  }
  assert.equal(
    options.filter((o) => o.getAttribute('aria-selected') === 'true').length,
    1,
  );

  // Leak surface: the popup must not look like the composer menu.
  assert.equal(document.querySelectorAll('button[role="menuitemradio"]').length, 0);
  assert.equal(document.querySelectorAll('div[role="menu"]').length, 0);
  assert.equal(document.querySelectorAll('button').length, 0);
  assert.equal(
    document.querySelectorAll('section[role="group"]').length,
    sections.length,
  );
});

test('defaultSpec matches the real setup and drives the search threshold', () => {
  const spec = defaultSpec();

  assert.ok(choicesOf(spec) > 4, 'more than four choices => showSearch');
  assert.equal(spec.pane, 'model');
  assert.deepEqual(spec.selected, {
    provider: 'deepseek-account',
    model: 'DeepSeek-V4.1-Flash',
  });

  const deepseek = spec.providers.find((p) => p.id === 'deepseek-account');
  assert.equal(deepseek.label, 'DeepSeek');
  assert.equal(deepseek.models.length, 4);
  assert.deepEqual(
    deepseek.models.map((m) => m.name),
    [
      'DeepSeek-V4.1-Flash',
      'DeepSeek-V4-Pro',
      'DeepSeek-V4-Flash',
      'DeepSeek-V4-Flash-Vision-Exp',
    ],
  );

  const natsuki = spec.providers.find((p) => p.id === 'natsuki');
  assert.equal(natsuki.label, 'Natsuki 网关');
  assert.equal(natsuki.models.length, 19);
  for (const name of ['gpt-6-astra', 'grok-4.7', 'grok-imagine-video', 'grok-latest']) {
    assert.ok(natsuki.models.some((m) => m.name === name), `missing ${name}`);
  }

  const free = spec.providers.find((p) => p.id === 'our-free-model');
  assert.equal(free.label, 'Free 模型');
  assert.equal(free.models.length, 9);

  // And the mounted fixture really shows search because of that count.
  const document = freshDom();
  const { searchInput, menu } = mountModelMenu(document, spec);
  assert.ok(searchInput);
  assert.equal(menu.getAttribute('role'), 'group');
});

test('showSearch can be forced and resetDom clears the body', () => {
  const document = freshDom();
  const forced = mountModelMenu(document, {
    menuId: 'forced',
    providers: defaultSpec().providers,
    selected: null,
    showSearch: false,
  });
  assert.equal(forced.searchInput, null, 'explicit showSearch:false wins');
  assert.ok(forced.sections.length > 0);

  resetDom(document);
  assert.equal(document.body.childNodes.length, 0);
  assert.equal(document.head.childNodes.length, 0);
  assert.equal(document.querySelectorAll('section').length, 0);
});
