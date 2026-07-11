// The M4 explorer (specs/M4.md's "Explorer UI"): a single self-contained
// HTML file. `EXPLORER_TEMPLATE` is hand-written HTML/CSS/vanilla JS with
// one placeholder, `__ETYMON_DUMP_JSON__`, which `embedDump` replaces with
// `JSON.stringify(dump)` (escaping `</script` so dump content can't break
// out of the embedded <script> block). The explorer never reimplements the
// sound-change engine or the romanizer — every form it shows is read
// straight from the dump's `derived` section (src/serialize.ts computed
// it with the real engine at dump time).
//
// The embedded <script> is written with string concatenation (`+`), not
// template literals: this file's outer string is itself a TS template
// literal, and nesting `${...}` or backticks inside it would be its own
// escaping hazard. Plain quotes and `+` sidestep that entirely.

export const EXPLORER_TEMPLATE = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Etymon Explorer</title>
<style>
  :root {
    color-scheme: light dark;
    --bg: #f7f6f3;
    --panel: #ffffff;
    --text: #1c1a17;
    --muted: #6b6559;
    --border: #ddd8cf;
    --accent: #8a5a2b;
    --accent-bg: #f3e6d0;
    --mono: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  }
  @media (prefers-color-scheme: dark) {
    :root {
      --bg: #171613;
      --panel: #201d19;
      --text: #ece7de;
      --muted: #a89f8e;
      --border: #3a352c;
      --accent: #e0a96d;
      --accent-bg: #3a2c1b;
    }
  }
  * { box-sizing: border-box; }
  body {
    margin: 0;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
    background: var(--bg);
    color: var(--text);
    line-height: 1.45;
  }
  h1, h2, h3 { font-weight: 600; }
  h2 { font-size: 0.95rem; text-transform: uppercase; letter-spacing: 0.04em; color: var(--muted); margin: 0 0 0.5rem; }
  header {
    padding: 1rem 1.5rem;
    border-bottom: 1px solid var(--border);
    background: var(--panel);
  }
  header h1 { margin: 0 0 0.2rem; font-size: 1.35rem; }
  header p { margin: 0; color: var(--muted); font-size: 0.9rem; }
  #layout {
    display: grid;
    grid-template-columns: 320px 1fr;
    gap: 1.25rem;
    padding: 1.25rem;
    max-width: 1200px;
    margin: 0 auto;
    align-items: start;
  }
  @media (max-width: 800px) {
    #layout { grid-template-columns: 1fr; }
  }
  #right-col { display: flex; flex-direction: column; gap: 1.25rem; min-width: 0; }
  .panel {
    background: var(--panel);
    border: 1px solid var(--border);
    border-radius: 10px;
    padding: 1rem;
    min-width: 0;
  }
  .panel + h2 { margin-top: 1rem; }
  .muted { color: var(--muted); }
  .small { font-size: 0.8rem; }
  button { font: inherit; }
  ul { list-style: none; margin: 0; padding: 0; }

  /* tree */
  .tree-root-label { font-weight: 600; margin-bottom: 0.4rem; }
  #tree ul { padding-left: 1rem; }
  #tree ul.tree-root { padding-left: 0; }
  .split-label { display: block; color: var(--muted); font-size: 0.82rem; padding: 0.3rem 0.5rem; }
  .leaf-btn, .dict-row {
    display: block;
    width: 100%;
    text-align: left;
    border: none;
    background: none;
    color: inherit;
    padding: 0.35rem 0.5rem;
    border-radius: 6px;
    cursor: pointer;
  }
  .leaf-btn:hover, .dict-row:hover { background: var(--border); }
  .leaf-btn.selected, .dict-row.selected { background: var(--accent-bg); color: var(--accent); font-weight: 600; }

  /* branch history */
  #branch-history { margin-top: 0.5rem; }
  .history-list li { padding: 0.3rem 0.1rem; border-bottom: 1px dashed var(--border); font-size: 0.88rem; }
  .history-list li:last-child { border-bottom: none; }
  .history-list li.paradigm-note { color: var(--accent); }
  .history-list .year { color: var(--muted); margin-right: 0.5rem; font-family: var(--mono); font-size: 0.8rem; }

  /* dictionary */
  #filter {
    width: 100%;
    padding: 0.45rem 0.6rem;
    margin: 0.4rem 0 0.6rem;
    border: 1px solid var(--border);
    border-radius: 6px;
    background: var(--bg);
    color: var(--text);
  }
  #dict-list { max-height: 48vh; overflow-y: auto; }
  .dict-row .word { font-family: var(--mono); margin-left: 0.35rem; }

  /* etymology */
  .etymology-header { display: flex; align-items: center; justify-content: space-between; gap: 0.75rem; margin-bottom: 0.25rem; }
  #play-btn {
    border: 1px solid var(--border);
    background: var(--panel);
    color: var(--text);
    padding: 0.3rem 0.7rem;
    border-radius: 6px;
    cursor: pointer;
  }
  #play-btn:hover { background: var(--accent-bg); }
  .timeline { position: relative; margin: 0.75rem 0 1.1rem; padding-left: 1.25rem; border-left: 2px solid var(--border); }
  .timeline-step { position: relative; padding: 0.35rem 0 0.35rem 0.5rem; transition: opacity 0.3s ease; }
  .timeline-step::before {
    content: "";
    position: absolute;
    left: -1.56rem;
    top: 0.6rem;
    width: 0.55rem;
    height: 0.55rem;
    border-radius: 50%;
    background: var(--muted);
  }
  .timeline-step.proto::before { background: var(--accent); }
  .timeline-step .form { font-family: var(--mono); font-size: 1rem; }
  .timeline-step.final .form { color: var(--accent); font-weight: 700; font-size: 1.12rem; }
  .timeline-step .label { display: block; color: var(--muted); font-size: 0.82rem; }
  .timeline-step.pending { opacity: 0; }
  .cognate-table-wrap { overflow-x: auto; }
  .cognate-table { border-collapse: collapse; width: 100%; font-size: 0.85rem; }
  .cognate-table th, .cognate-table td { padding: 0.35rem 0.55rem; border-bottom: 1px solid var(--border); text-align: left; white-space: nowrap; }
  .cognate-table td.selected { background: var(--accent-bg); color: var(--accent); font-weight: 600; }

  /* empty state + drag/drop */
  #empty-state { margin: 1.25rem; padding: 1.5rem; }
  #empty-state code { background: var(--accent-bg); padding: 0.1rem 0.35rem; border-radius: 4px; }
  #drop-overlay {
    position: fixed;
    inset: 0;
    display: none;
    align-items: center;
    justify-content: center;
    background: rgba(0, 0, 0, 0.55);
    color: #fff;
    font-size: 1.4rem;
    z-index: 50;
    pointer-events: none;
  }
  body.drag-active #drop-overlay { display: flex; }
</style>
</head>
<body>
  <header>
    <h1 id="family-name"></h1>
    <p id="family-meta"></p>
  </header>

  <div id="empty-state" class="panel" hidden>
    <p>This dump has no <code>derived</code> section, so there is nothing to explore.</p>
    <p>Regenerate this dump with a newer etymon: <code>etymon generate --json dump.json</code> (or <code>etymon explore</code>), then drop the new file onto this page.</p>
  </div>

  <div id="layout">
    <section class="panel" id="tree-panel">
      <h2>Family tree</h2>
      <div id="tree"></div>
      <h2>Branch history</h2>
      <div id="branch-history"></div>
    </section>
    <div id="right-col">
      <section class="panel" id="dict-panel">
        <h2>Dictionary <span id="dict-leaf-name" class="muted"></span></h2>
        <input id="filter" type="text" placeholder="Filter by concept or word…" autocomplete="off">
        <div id="dict-list"></div>
      </section>
      <section class="panel" id="etymology-panel">
        <h2>Etymology</h2>
        <div id="etymology"></div>
      </section>
    </div>
  </div>

  <div id="drop-overlay">Drop a .json dump here to load it</div>

<script>
var DUMP = __ETYMON_DUMP_JSON__;
(function () {
  'use strict';

  var state = { dump: null, leafId: null, concept: null, filterQuery: '' };

  function byId(id) { return document.getElementById(id); }

  function escapeHtml(value) {
    return String(value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  // ------------------------------------------------------------- tree data

  function collectLeaves(branch, out) {
    out = out || [];
    if (!branch.children || branch.children.length === 0) {
      out.push(branch);
    } else {
      branch.children.forEach(function (child) { collectLeaves(child, out); });
    }
    return out;
  }

  function findPath(branch, targetId, prefix) {
    var path = prefix.concat([branch]);
    if (branch.id === targetId) return path;
    for (var i = 0; i < branch.children.length; i++) {
      var found = findPath(branch.children[i], targetId, path);
      if (found) return found;
    }
    return null;
  }

  function hasDerived(dump) {
    return !!(dump && dump.derived && Array.isArray(dump.derived.leaves) && dump.derived.leaves.length > 0);
  }

  function findDerivedLeaf(dump, leafId) {
    var list = dump.derived.leaves;
    for (var i = 0; i < list.length; i++) {
      if (list[i].branchId === leafId) return list[i];
    }
    return null;
  }

  function findProtoLexeme(dump, concept) {
    var list = dump.lexicon.lexemes;
    for (var i = 0; i < list.length; i++) {
      if (list[i].concept === concept) return list[i];
    }
    return null;
  }

  // ----------------------------------------------------------------- render

  function renderHeader(dump) {
    var leafCount = collectLeaves(dump.root, []).length;
    var years = dump.config.centuries * 100;
    byId('family-name').textContent = dump.familyName;
    byId('family-meta').textContent =
      'seed ' + dump.config.seed + ' — ' + leafCount + ' daughter language' + (leafCount === 1 ? '' : 's') +
      ' — ' + years + ' years simulated';
  }

  function renderTreeNode(branch, selectedLeafId) {
    var span = (branch.start * 100) + '–' + (branch.end * 100);
    var isLeaf = !branch.children || branch.children.length === 0;
    if (isLeaf) {
      var label = branch.name || branch.id;
      var cls = 'leaf-btn' + (branch.id === selectedLeafId ? ' selected' : '');
      return '<li><button type="button" class="' + cls + '" data-branch-id="' + escapeHtml(branch.id) + '">' +
        escapeHtml(label) + ' <span class="muted small">[' + span + ']</span></button></li>';
    }
    var children = branch.children.map(function (child) { return renderTreeNode(child, selectedLeafId); }).join('');
    return '<li><span class="split-label">split, year ' + (branch.end * 100) + '</span><ul>' + children + '</ul></li>';
  }

  function renderTree(dump, selectedLeafId) {
    var root = dump.root;
    var rootSpan = (root.start * 100) + '–' + (root.end * 100);
    var html = '<div class="tree-root-label">' + escapeHtml(dump.familyName) + ' <span class="muted small">[' + rootSpan + ']</span></div>';
    if (!root.children || root.children.length === 0) {
      html += '<ul class="tree-root">' + renderTreeNode(root, selectedLeafId) + '</ul>';
    } else {
      var children = root.children.map(function (child) { return renderTreeNode(child, selectedLeafId); }).join('');
      html += '<ul class="tree-root">' + children + '</ul>';
    }
    byId('tree').innerHTML = html;
  }

  function pathEventsAndNotes(dump, leafId) {
    var path = findPath(dump.root, leafId, []) || [];
    var items = [];
    path.forEach(function (branch) {
      branch.events.forEach(function (ev) {
        items.push({ century: ev.century, paradigm: false, text: ev.change.description });
      });
      branch.paradigmNotes.forEach(function (note) {
        items.push({ century: note.century, paradigm: true, text: note.note });
      });
    });
    items.sort(function (a, b) { return a.century - b.century; });
    return items;
  }

  function renderBranchHistory(dump, leafId) {
    var items = pathEventsAndNotes(dump, leafId);
    var container = byId('branch-history');
    if (items.length === 0) {
      container.innerHTML = '<p class="muted small">No recorded sound changes.</p>';
      return;
    }
    var rows = items.map(function (item) {
      var cls = item.paradigm ? ' class="paradigm-note"' : '';
      return '<li' + cls + '><span class="year">year ' + (item.century * 100) + '</span>' + escapeHtml(item.text) + '</li>';
    }).join('');
    container.innerHTML = '<ul class="history-list">' + rows + '</ul>';
  }

  function renderDictionary(dump, leafId, filterQuery) {
    var leaf = findDerivedLeaf(dump, leafId);
    var container = byId('dict-list');
    byId('dict-leaf-name').textContent = leaf ? '— ' + leaf.name : '';
    if (!leaf) {
      container.innerHTML = '<p class="muted small">No dictionary available.</p>';
      return;
    }
    var needle = filterQuery.trim().toLowerCase();
    var rows = leaf.dictionary.filter(function (entry) {
      if (!needle) return true;
      return entry.concept.toLowerCase().indexOf(needle) !== -1 || entry.romanized.toLowerCase().indexOf(needle) !== -1;
    });
    if (rows.length === 0) {
      container.innerHTML = '<p class="muted small">No matches.</p>';
      return;
    }
    var html = rows.map(function (entry) {
      var cls = 'dict-row' + (entry.concept === state.concept ? ' selected' : '');
      return '<li><button type="button" class="' + cls + '" data-concept="' + escapeHtml(entry.concept) + '">' +
        '<span class="concept muted">' + escapeHtml(entry.concept) + '</span> — ' +
        '<span class="word">' + escapeHtml(entry.romanized) + '</span></button></li>';
    }).join('');
    container.innerHTML = '<ul class="dict-rows">' + html + '</ul>';
  }

  function renderEtymology(dump, leafId, concept) {
    var container = byId('etymology');
    if (!concept) {
      container.innerHTML = '<p class="muted small">Select a word from the dictionary to see its etymology.</p>';
      return;
    }
    var leaf = findDerivedLeaf(dump, leafId);
    var proto = findProtoLexeme(dump, concept);
    var entry = leaf ? leaf.dictionary.filter(function (e) { return e.concept === concept; })[0] : null;
    if (!leaf || !proto || !entry) {
      container.innerHTML = '<p class="muted small">No etymology available.</p>';
      return;
    }
    var steps = entry.trace;
    var protoStepHtml = '<div class="timeline-step proto' + (steps.length === 0 ? ' final' : '') + '">' +
      '<span class="form">*' + escapeHtml(proto.word.romanized) + '</span>' +
      '<span class="label">' + escapeHtml(dump.familyName) + '</span></div>';
    var stepsHtml = steps.map(function (step, i) {
      var isLast = i === steps.length - 1;
      return '<div class="timeline-step' + (isLast ? ' final' : '') + '">' +
        '<span class="form">' + escapeHtml(step.romanized) + '</span>' +
        '<span class="label">year ' + (step.century * 100) + ' — ' + escapeHtml(step.description) + '</span></div>';
    }).join('');

    var cognateHeaders = dump.derived.leaves.map(function (l) { return '<th>' + escapeHtml(l.name) + '</th>'; }).join('');
    var cognateCells = dump.derived.leaves.map(function (l) {
      var e = l.dictionary.filter(function (d) { return d.concept === concept; })[0];
      var cls = l.branchId === leafId ? ' class="selected"' : '';
      return '<td' + cls + '>' + escapeHtml(e ? e.romanized : '—') + '</td>';
    }).join('');

    container.innerHTML =
      '<div class="etymology-header"><strong>' + escapeHtml(concept) + '</strong>' +
      (steps.length > 0 ? '<button type="button" id="play-btn">▶ Play</button>' : '') + '</div>' +
      '<div class="timeline" id="timeline">' + protoStepHtml + stepsHtml + '</div>' +
      '<h2>Cognates</h2>' +
      '<div class="cognate-table-wrap"><table class="cognate-table"><thead><tr>' + cognateHeaders +
      '</tr></thead><tbody><tr>' + cognateCells + '</tr></tbody></table></div>';

    var playBtn = byId('play-btn');
    if (playBtn) playBtn.addEventListener('click', function () { playTimeline(); });
  }

  function playTimeline() {
    var steps = byId('timeline').querySelectorAll('.timeline-step:not(.proto)');
    for (var i = 0; i < steps.length; i++) steps[i].classList.add('pending');
    var index = 0;
    function revealNext() {
      if (index >= steps.length) return;
      steps[index].classList.remove('pending');
      index++;
      if (index < steps.length) setTimeout(revealNext, 600);
    }
    setTimeout(revealNext, 600);
  }

  // ------------------------------------------------------------- controller

  function selectLeaf(leafId) {
    state.leafId = leafId;
    renderTree(state.dump, state.leafId);
    renderBranchHistory(state.dump, state.leafId);
    renderDictionary(state.dump, state.leafId, state.filterQuery);
    renderEtymology(state.dump, state.leafId, state.concept);
  }

  function selectConcept(concept) {
    state.concept = concept;
    renderDictionary(state.dump, state.leafId, state.filterQuery);
    renderEtymology(state.dump, state.leafId, state.concept);
  }

  function loadDump(dump) {
    state.dump = dump;
    state.concept = null;
    state.filterQuery = '';
    byId('filter').value = '';
    renderHeader(dump);
    if (!hasDerived(dump)) {
      byId('layout').hidden = true;
      byId('empty-state').hidden = false;
      return;
    }
    byId('layout').hidden = false;
    byId('empty-state').hidden = true;
    selectLeaf(dump.derived.leaves[0].branchId);
    renderEtymology(dump, state.leafId, null);
  }

  function looksLikeDump(candidate) {
    return !!candidate && candidate.formatVersion === 1 && !!candidate.root && !!candidate.config && !!candidate.lexicon;
  }

  function handleDroppedFile(file) {
    var reader = new FileReader();
    reader.onload = function () {
      var parsed;
      try {
        parsed = JSON.parse(String(reader.result));
      } catch (err) {
        window.alert('Could not parse that file as JSON.');
        return;
      }
      if (!looksLikeDump(parsed)) {
        window.alert('That file does not look like an etymon dump.');
        return;
      }
      loadDump(parsed);
    };
    reader.readAsText(file);
  }

  function init() {
    byId('filter').addEventListener('input', function (e) {
      state.filterQuery = e.target.value;
      renderDictionary(state.dump, state.leafId, state.filterQuery);
    });
    byId('tree').addEventListener('click', function (e) {
      var btn = e.target.closest('button.leaf-btn');
      if (btn) selectLeaf(btn.getAttribute('data-branch-id'));
    });
    byId('dict-list').addEventListener('click', function (e) {
      var btn = e.target.closest('button.dict-row');
      if (btn) selectConcept(btn.getAttribute('data-concept'));
    });
    document.addEventListener('dragover', function (e) {
      e.preventDefault();
      document.body.classList.add('drag-active');
    });
    document.addEventListener('dragleave', function (e) {
      if (e.target === document.documentElement || e.target === document.body) {
        document.body.classList.remove('drag-active');
      }
    });
    document.addEventListener('drop', function (e) {
      e.preventDefault();
      document.body.classList.remove('drag-active');
      var file = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
      if (file) handleDroppedFile(file);
    });
    loadDump(DUMP);
  }

  init();
})();
</script>
</body>
</html>
`;

/** Replace the template's `__ETYMON_DUMP_JSON__` placeholder with
 * `JSON.stringify(dump)`, escaping `</script`-hostile sequences (so a
 * concept, description, or other dump string containing literal
 * "</script>" text can't prematurely close the embedded <script> block).
 * Uses a function replacer (not a plain string) so `$`-patterns inside the
 * JSON (e.g. "$1", "$$") aren't misinterpreted as replacement specials. */
export function embedDump(dump: unknown): string {
  const json = JSON.stringify(dump).replace(/<\//g, '<\\/');
  return EXPLORER_TEMPLATE.replace('__ETYMON_DUMP_JSON__', () => json);
}
