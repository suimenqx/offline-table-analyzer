const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const htmlPath = path.join(__dirname, '..', 'offline_table_analyzer_v18.html');
const html = fs.readFileSync(htmlPath, 'utf8').replace(/^\uFEFF/, '');
const script = html.split('<script>')[1].split('</script>')[0];
const scriptPath = path.join('/tmp', 'offline_table_analyzer_v18_script_check.js');
fs.writeFileSync(scriptPath, script, 'utf8');
execFileSync('node', ['--check', scriptPath], { stdio: 'pipe' });
function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}
[
  'id="expandSourceBtn"',
  'id="sourceEditorModal"',
  'id="rawInputLarge"',
  'id="formatSelectLarge"',
  'id="headerModeSelectLarge"',
  'id="sourceEditorParseBtn"',
  'id="sourceEditorDoneBtn"',
  'id="sourceEditorCloseBtn"',
  'id="sidebarDataTabBtn"',
  'id="sidebarConfigTabBtn"',
  'id="addTabBtn" type="button"'
].forEach(token => assert(html.includes(token), `missing ${token}`));
[
  'openSourceEditor()',
  'closeSourceEditor()',
  'syncSourceTextFromLarge()',
  'syncSourceEditorControls()',
  'runFromSourceEditor(close=false)',
  'setSidebarTab(tabName=\'data\')',
  'applySidebarTab(tabName=\'data\', persist=true)'
].forEach(token => assert(script.includes(token), `missing method ${token}`));
assert(script.includes("if(e.detail > 1) return;"), 'sidebar double-click should not toggle twice');
assert(script.includes('const handleSidebarTabClick = e =>'), 'sidebar config tab should use shared click handler');
assert(script.includes("document.querySelectorAll('[data-tab-btn]').forEach(btn =>"), 'sidebar tabs should also bind direct click handlers');
assert(script.includes('this.bindSidebar(); this.bindAccordions();\n        this.bind();'), 'sidebar binding must run before broad UI binding');
assert(script.includes("Store.curr().raw = large.value"), 'large editor must sync source text to store');
assert(script.includes("if($('sidebar')) this.setSidebarTab"), 'sidebar tab should refresh on document load');
assert(script.includes('createNewTab(e)'), 'App should own robust new tab flow');
assert(script.includes('addTabBtn.onclick = e => this.createNewTab(e)'), 'add tab button should call robust new tab flow');
assert(script.includes("escapeHtml(str='')") && script.includes('renderTabs()'), 'App should escape tab titles when rendering');
console.log('UI interaction tests passed: 16');
