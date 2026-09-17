#!/usr/bin/env node
import assert from 'node:assert/strict';
import {mkdirSync, writeFileSync} from 'node:fs';
import {createRequire} from 'node:module';
const require = createRequire(import.meta.url);
const {chromium} = require(process.env.MUSIC_PLAYWRIGHT_PATH || 'playwright');
const base = process.env.MUSIC_TEST_URL || 'http://127.0.0.1:4173';
const artifacts = process.env.MUSIC_TEST_ARTIFACTS || '/tmp/music-player-test';
mkdirSync(artifacts, {recursive: true});

const samples = 8000 * 20;
const wav = Buffer.alloc(44 + samples * 2);
wav.write('RIFF', 0); wav.writeUInt32LE(36 + samples * 2, 4); wav.write('WAVEfmt ', 8);
wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22);
wav.writeUInt32LE(8000, 24); wav.writeUInt32LE(16000, 28); wav.writeUInt16LE(2, 32);
wav.writeUInt16LE(16, 34); wav.write('data', 36); wav.writeUInt32LE(samples * 2, 40);
for (let i = 0; i < samples; i++) wav.writeInt16LE(Math.round(700 * Math.sin(i * Math.PI * 440 / 4000)), 44 + i * 2);

const browser = await chromium.launch({headless: true, args: ['--autoplay-policy=no-user-gesture-required']});
const failures = [];
let checks = 0;
async function mockMusic(page) {
  await page.addInitScript(() => {
    window.__musicAudios = [];
    const original = Document.prototype.createElement;
    Document.prototype.createElement = function(name, options) {
      const element = original.call(this, name, options);
      if (String(name).toLowerCase() === 'audio') window.__musicAudios.push(element);
      return element;
    };
  });
  await page.route('**/music/**', async (route) => {
    const url = route.request().url();
    if (url.endsWith('/manifest.json')) return route.fulfill({json: [{id: 'baby-test', label: '宝宝音乐', tracks: [{title: '测试儿歌', artist: '测试歌手', local_path: 'music/baby-music/test.wav', source_url: ''}]}]});
    if (url.endsWith('.lrc')) return route.fulfill({contentType: 'text/plain', body: '[00:00.00]测试音乐\n[00:05.00]测试下一行'});
    if (/\.(mp3|flac|wav)(\?|$)/.test(url)) return route.fulfill({contentType: 'audio/wav', body: wav});
    return route.fulfill({status: 204, body: ''});
  });
  page.on('pageerror', (error) => failures.push(error.message));
}
async function check(name, task) {
  try { await task(); checks++; console.log(`PASS ${name}`); }
  catch (error) {
    let index = 0;
    for (const context of browser.contexts()) for (const page of context.pages()) {
      const prefix = `${artifacts}/failure-${index++}`;
      await page.screenshot({path: `${prefix}.png`}).catch(() => {});
      writeFileSync(`${prefix}.html`, await page.content());
    }
    console.error('FAILED', name, 'runtime errors:', failures);
    throw error;
  }
}
try {
  const context = await browser.newContext({viewport: {width: 1280, height: 900}});
  const page = await context.newPage();
  await mockMusic(page);
  await page.goto(base, {waitUntil: 'networkidle'});
  const launcher = page.getByRole('button', {name: '打开音乐播放器', exact: true});
  const panel = page.getByRole('dialog', {name: '音乐播放器选歌'});
  await check('全站入口存在且初次不自动播放', async () => {
    await launcher.waitFor(); assert.equal(await page.evaluate(() => window.__musicAudios.filter((a) => a.getAttribute('src')).length), 0);
  });
  await launcher.click();
  await check('只打开面板和浏览歌单不触发播放', async () => {
    await panel.waitFor(); await panel.getByLabel('选择歌单').selectOption('jay');
    assert.equal(await page.evaluate(() => window.__musicAudios.filter((a) => a.getAttribute('src')).length), 0);
  });
  await check('关闭与 Esc 恢复焦点', async () => {
    await page.keyboard.press('Escape'); await panel.waitFor({state: 'hidden'}); await panel.waitFor({state: 'hidden'});
    assert.equal(await launcher.evaluate((el) => el === document.activeElement), true);
    await launcher.click();
  });
  await check('全局搜索去重并支持空结果', async () => {
    const input = panel.getByLabel('搜索歌曲或歌手');
    await input.fill('没有这首歌-xyz'); assert.equal(await panel.locator('[data-music-track]').count(), 0);
    await input.fill('一路向北'); assert.equal(await panel.locator('[data-music-track]').count(), 1);
  });
  await check('搜索后播放正确曲目且歌词默认关闭', async () => {
    await panel.locator('[data-music-track]').first().click();
    await page.waitForFunction(() => window.__musicAudios.at(-1)?.paused === false);
    assert.equal(await page.evaluate(() => window.__musicAudios.filter((a) => a.getAttribute('src')).length), 1);
    assert.equal(await page.locator('.aplayer-lrc').evaluate((el) => el.classList.contains('aplayer-lrc-hide')), true);
    assert.match(decodeURIComponent(await page.evaluate(() => window.__musicAudios.at(-1)?.getAttribute('src'))), /一路向北/);
  });
  await check('重新打开显示当前歌曲', async () => {
    await launcher.click(); await panel.getByLabel('搜索歌曲或歌手').fill('一路向北');
    assert.equal(await panel.locator('[data-music-track][aria-current="true"]').count(), 1);
    await page.keyboard.press('Escape'); await panel.waitFor({state: 'hidden'});
  });
  await check('播放条列表按钮打开同一选歌面板', async () => {
    await page.locator('.aplayer-icon-menu').click(); await panel.waitFor();
    assert.equal(await page.locator('.aplayer-list').isVisible(), false);
    await page.keyboard.press('Escape'); await panel.waitFor({state: 'hidden'});
  });
  await check('切换页面保留同一个 audio 和播放进度', async () => {
    await page.evaluate(() => {window.__musicAudio = window.__musicAudios.at(-1);});
    const before = await page.evaluate(() => window.__musicAudios.at(-1).currentTime);
    await page.locator('a[href="/my-journey-in-cybersecurity"]:visible').first().click();
    await page.waitForURL(/\/my-journey-in-cybersecurity\/?$/);
    assert.equal(await page.evaluate(() => window.__musicAudio === window.__musicAudios.at(-1)), true);
    assert.equal(await page.evaluate(() => window.__musicAudios.filter((a) => a.getAttribute('src')).length), 1);
    assert.equal(await page.evaluate(() => window.__musicAudios.at(-1).paused), false);
    assert.ok(await page.evaluate(() => window.__musicAudios.at(-1).currentTime) >= before);
  });
  await check('暂停并收起保留全站入口', async () => {
    await page.getByRole('button', {name: '暂停并收起播放器'}).click();
    assert.equal(await page.evaluate(() => window.__musicAudios.at(-1).paused), true);
    assert.equal(await page.locator('.aplayer-body').isVisible(), false);
    assert.equal(await launcher.isVisible(), true);
  });
  await check('收起后切换页面不重新展开', async () => {
    await page.goBack();
    await page.waitForURL(/\/$/);
    assert.equal(await page.locator('.aplayer-body').isVisible(), false);
    assert.equal(await page.evaluate(() => window.__musicAudios.at(-1).paused), true);
    await page.locator('a[href="/my-journey-in-cybersecurity"]:visible').first().click();
    await page.waitForURL(/\/my-journey-in-cybersecurity\/?$/);
    assert.equal(await page.locator('.aplayer-body').isVisible(), false);
  });
  await launcher.click();
  await check('按歌手播放保留该歌手队列', async () => {
    await panel.getByLabel('选择歌手').selectOption('artist-周杰伦');
    await panel.locator('[data-music-track]').nth(1).click();
    await page.waitForFunction(() => window.__musicAudios.at(-1)?.paused === false);
    const state = await page.evaluate(() => JSON.parse(localStorage.getItem('feei-global-music-player-state-v1')));
    assert.equal(state.activeGroupId, 'artist-周杰伦');
  });
  await check('扩展宝宝歌单仍可加载和播放', async () => {
    await launcher.click(); await panel.getByLabel('选择歌单').selectOption('baby-test');
    await panel.getByRole('button', {name: '播放 测试儿歌 · 测试歌手', exact: true}).click();
    await page.waitForFunction(() => window.__musicAudios.at(-1)?.src.includes('baby-music/test.wav'));
    await page.waitForFunction(() => window.__musicAudios.at(-1)?.paused === false);
    assert.match(await page.evaluate(() => window.__musicAudios.at(-1)?.getAttribute('src')), /baby-music\/test.wav/);
  });
  await check('当前页面音乐链接不跳走、不自动播放', async () => {
    await page.getByRole('button', {name: '暂停并收起播放器'}).click();
    await page.evaluate(() => { const a = document.createElement('a'); a.href = '?music=open'; a.textContent = '测试音乐入口'; document.body.append(a); });
    await page.getByRole('link', {name: '测试音乐入口'}).click();
    await panel.waitFor(); assert.match(page.url(), /my-journey-in-cybersecurity/);
    assert.equal(await page.evaluate(() => window.__musicAudios.filter((a) => a.getAttribute('src')).length), 0);
    await page.keyboard.press('Escape'); await panel.waitFor({state: 'hidden'});
  });
  await check('旧地址兼容打开面板且不自动播放', async () => {
    await page.goto(`${base}/my-playlist`, {waitUntil: 'networkidle'});
    await panel.waitFor(); assert.equal(new URL(page.url()).pathname, '/');
    assert.equal(await page.evaluate(() => window.__musicAudios.filter((a) => a.getAttribute('src')).length), 0);
    await page.screenshot({path: `${artifacts}/desktop.png`});
  });
  await check('空格以外的键盘浏览与 Enter 选歌', async () => {
    const input = panel.getByLabel('搜索歌曲或歌手'); await input.fill('一路向北');
    await input.press('ArrowDown'); assert.equal(await panel.locator('[data-music-track]').first().evaluate((el) => el === document.activeElement), true);
    await page.keyboard.press('Enter'); await page.waitForFunction(() => window.__musicAudios.at(-1)?.paused === false);
  });
  await check('全屏歌词仍可手动打开关闭', async () => {
    await page.locator('.aplayer-icon-lrc').click(); assert.equal(await page.locator('.aplayer-lrc').evaluate((el) => el.classList.contains('aplayer-lrc-hide')), false);
    await page.locator('.aplayer-icon-lrc').click(); assert.equal(await page.locator('.aplayer-lrc').evaluate((el) => el.classList.contains('aplayer-lrc-hide')), true);
  });
  const mobile = await browser.newContext({viewport: {width: 390, height: 844}, isMobile: true, hasTouch: true, colorScheme: 'dark'});
  const phone = await mobile.newPage(); await mockMusic(phone);
  await phone.goto(`${base}/?music=open`, {waitUntil: 'networkidle'});
  await check('手机与深色模式面板不溢出视口', async () => {
    const dialog = phone.getByRole('dialog'); await dialog.waitFor();
    const box = await dialog.boundingBox(); assert.ok(box.x >= 0 && box.x + box.width <= 390);
    assert.ok(box.y >= 0 && box.y + box.height <= 844);
    await phone.screenshot({path: `${artifacts}/mobile.png`});
    await dialog.getByRole('button', {name: '关闭选歌面板'}).click();
    assert.equal(await phone.getByRole('button', {name: '打开音乐播放器'}).isVisible(), true);
  });
  assert.deepEqual(failures, [], 'Browser runtime errors');
  console.log(JSON.stringify({checks, browserErrors: failures.length}));
} finally { await browser.close(); }
