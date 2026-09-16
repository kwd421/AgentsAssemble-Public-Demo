// Run after `npm run build` with Playwright installed. Local fixture server; no AI quota.
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { chromium } from 'playwright';
import { createDemoServer } from '../server.mjs';

await mkdir('ui-evidence', { recursive: true });
const app = createDemoServer({ env: { DEMO_FAKE_MODE: '1', AI_MAX_TOKENS: '3000' } });
await new Promise(resolve => app.server.listen(0, '127.0.0.1', resolve));
const base = `http://127.0.0.1:${app.server.address().port}`;
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 1 });
const errors = [], commands = [], checks = [];
page.on('pageerror', e => errors.push(e.message));
page.on('websocket', ws => ws.on('framesent', frame => { try { commands.push(JSON.parse(String(frame.payload))); } catch {} }));
const check = (name, value) => { assert.ok(value, name); checks.push(name); console.log(`PASS ${name}`); };
async function shot(name) { await page.screenshot({ path: `ui-evidence/${name}.png`, fullPage: true }); }
async function snapshot() { return page.evaluate(async () => { const id = sessionStorage.getItem('aa-demo-room-v3'); const response = await fetch(`/api/rooms/${id}`); if (!response.ok) throw new Error(`Snapshot HTTP ${response.status}`); return response.json(); }); }
async function openSetup() { await page.locator('.aa-help-button').click(); await page.getByRole('button', { name: '다음', exact: true }).click(); await page.waitForSelector('.aa-setup-card'); }
async function assertFit(label) {
  const d = await page.locator('.aa-dialog').evaluate(el => ({ x: el.getBoundingClientRect().left, width: el.getBoundingClientRect().width, viewport: innerWidth, doc: document.documentElement.scrollWidth, titleHeight: el.querySelector('h2').getBoundingClientRect().height, titleLine: parseFloat(getComputedStyle(el.querySelector('h2')).lineHeight) }));
  check(`${label}: no horizontal overflow`, d.x >= 0 && d.x + d.width <= d.viewport + 1 && d.doc <= d.viewport + 1);
  check(`${label}: setup title stays on one line`, d.titleHeight <= d.titleLine * 1.2);
}
try {
  await page.goto(base);
  await page.waitForSelector('dialog[open]');
  await page.waitForSelector('.aa-welcome-member');
  check('welcome is a native modal', await page.locator('dialog').evaluate(el => el.matches(':modal')));
  for (let i = 0; i < 6; i++) await page.keyboard.press('Tab');
  check('keyboard focus stays in modal', await page.locator('dialog').evaluate(el => el.contains(document.activeElement)));
  await shot('01-welcome-desktop');
  await page.getByRole('button', { name: '다음', exact: true }).click();
  await page.waitForSelector('.aa-setup-card');
  check('three editable profiles', await page.locator('.aa-setup-card').count() === 3);
  check('all six setup fields start empty with real placeholders', await page.locator('.aa-setup-card input, .aa-setup-card textarea').evaluateAll(nodes => nodes.length === 6 && nodes.every(n => n.value === '' && n.placeholder.length > 0)));
  const colors = await page.locator('.aa-setup-card .aa-profile-banner').evaluateAll(nodes => nodes.map(n => getComputedStyle(n).backgroundColor));
  check('each profile has a distinct banner color', new Set(colors).size === 3);
  check('setup text is at least 14px', await page.locator('.aa-setup-card textarea').evaluateAll(nodes => nodes.every(n => parseFloat(getComputedStyle(n).fontSize) >= 14)));
  await assertFit('desktop'); await shot('02-profiles-desktop');
  const before = await snapshot();
  const engineer = page.locator('.aa-setup-card[data-agent="engineer"]');
  await engineer.getByLabel('프로필 이름', { exact: true }).fill('테크리드');
  await engineer.getByLabel('지시문', { exact: true }).fill('구현 가능성을 검토하고 결론, 이유 순으로 짧게 답하세요.');
  await page.getByRole('button', { name: '저장 후 입장', exact: true }).click();
  await page.waitForSelector('dialog', { state: 'detached' });
  const after = await snapshot();
  check('edited name and instruction are persisted in room', after.agents[1].name === '테크리드' && after.agents[1].instruction.startsWith('구현 가능성'));
  check('blank profiles preserve previous defaults', after.agents[0].name === before.agents[0].name && after.agents[0].instruction === before.agents[0].instruction && after.agents[2].instruction === before.agents[2].instruction);
  check('only edited profile is sent', commands.filter(c => c.type === 'agent_profile_update').length === 1);
  const writesBefore = commands.filter(c => c.type === 'agent_profile_update').length;
  await openSetup();
  await page.getByRole('button', { name: '저장 후 입장', exact: true }).click();
  await page.waitForSelector('dialog', { state: 'detached' });
  check('blank setup does not issue profile writes', commands.filter(c => c.type === 'agent_profile_update').length === writesBefore);
  check('blank reopened setup keeps a customized name', (await snapshot()).agents[1].name === '테크리드');
  await page.locator('.aa-member[data-agent="engineer"]').click();
  check('right panel opens actual saved instructions', await page.locator('.aa-profile-editor').getByLabel('프로필 이름', { exact: true }).inputValue() === '테크리드');
  await page.locator('.aa-profile-editor').getByLabel('프로필 이름', { exact: true }).fill('개발 검토자');
  await page.getByRole('button', { name: '변경 저장', exact: true }).click();
  await page.waitForFunction(() => { const button = document.querySelector('.aa-profile-editor button.primary'); return document.querySelector('.aa-profile-editor h3')?.textContent === '개발 검토자' && button?.disabled && button.textContent === '변경 저장'; });
  check('right-panel save updates server', (await snapshot()).agents[1].name === '개발 검토자');
  await page.locator('.aa-profile-editor summary').click();
  await shot('03-profile-editor-desktop');
  await page.locator('.aa-profile-editor').getByRole('button', { name: '멤버 목록', exact: true }).click();
  await page.getByRole('textbox', { name: '채팅 입력', exact: true }).fill('안녕하세요. 짧게 인사해 주세요.');
  await page.getByRole('button', { name: '채팅 메시지 보내기', exact: true }).click();
  await page.waitForFunction(() => document.querySelectorAll('.aa-message[data-agent]').length === 3, null, { timeout: 15000 });
  check('ordinary unmentioned question receives all three fixture replies', (await snapshot()).messages.filter(m => m.kind === 'agent').length === 3);
  await shot('04-chat-desktop');
  await openSetup();
  for (const [id, name] of [['strategist', '기획자'], ['engineer', '개발자'], ['critic', '검토자']]) await page.locator(`.aa-setup-card[data-agent="${id}"]`).getByLabel('프로필 이름', { exact: true }).fill(name);
  await page.getByRole('button', { name: '저장 후 입장', exact: true }).click();
  await page.waitForSelector('dialog', { state: 'detached' });
  check('three-profile save queue completes', (await snapshot()).agents.map(a => a.name).join(',') === '기획자,개발자,검토자');
  await openSetup();
  for (const [width, height, label] of [[1063, 800, 'laptop'], [768, 900, 'tablet'], [390, 844, 'mobile']]) {
    await page.setViewportSize({ width, height });
    await assertFit(label);
    await shot(`05-setup-${label}`);
  }
  await page.keyboard.press('Escape');
  await page.waitForSelector('dialog', { state: 'detached' });
  check('Escape closes modal', await page.locator('dialog').count() === 0);
  // A drawer may cover the header after resizing a desktop page. Close its own visible control first.
  if (await page.locator('.aa-members-header button').isVisible()) await page.locator('.aa-members-header button').click();
  await shot('06-chat-mobile');
  const toggle = page.getByRole('button', { name: '멤버 목록', exact: true });
  await toggle.click({ timeout: 10000 });
  await page.locator('.aa-member[data-agent="engineer"]').click();
  check('member editor remains reachable on mobile', await page.locator('.aa-profile-editor').isVisible());
  await shot('07-profile-mobile');
  check('no frontend JavaScript errors', errors.length === 0);
  await writeFile('ui-evidence/results.json', JSON.stringify({ checks, colors, errors, mode: 'fixture-only', count: checks.length }, null, 2));
} catch (error) {
  await shot('failure').catch(() => {});
  const diagnosis = await page.evaluate(() => [...document.querySelectorAll('.dc-chat-head, .dc-head-actions, .dc-head-actions button')].map(el => ({ tag: el.tagName, class: el.className, label: el.getAttribute('aria-label'), display: getComputedStyle(el).display, visibility: getComputedStyle(el).visibility, rect: el.getBoundingClientRect().toJSON(), ancestors: [...(function* (n) { while(n) { yield { tag: n.tagName, class: n.className, inert: n.inert, hidden: n.getAttribute('aria-hidden'), display: getComputedStyle(n).display }; n = n.parentElement; } })(el)] }))).catch(() => []);
  await writeFile('ui-evidence/failure.txt', `${error.stack}\nBrowser errors: ${JSON.stringify(errors)}\nLayout: ${JSON.stringify(diagnosis, null, 2)}`);
  throw error;
} finally {
  await browser.close();
  await app.close();
}
