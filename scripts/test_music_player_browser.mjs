import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {pathToFileURL} from 'node:url';

const {chromium} = await import(process.env.PLAYWRIGHT_MODULE
  ? pathToFileURL(process.env.PLAYWRIGHT_MODULE).href : 'playwright');
const output = '.music-player-test';
await fs.mkdir(output, {recursive: true});

function audioFixture() {
  const rate = 8000;
  const samples = rate * 45;
  const data = Buffer.alloc(44 + samples * 2);
  data.write('RIFF', 0);
  data.writeUInt32LE(36 + samples * 2, 4);
  data.write('WAVEfmt ', 8);
  data.writeUInt32LE(16, 16);
  data.writeUInt16LE(1, 20);
  data.writeUInt16LE(1, 22);
  data.writeUInt32LE(rate, 24);
  data.writeUInt32LE(rate * 2, 28);
  data.writeUInt16LE(2, 32);
  data.writeUInt16LE(16, 34);
  data.write('data', 36);
  data.writeUInt32LE(samples * 2, 40);
  return data;
}

const audio = audioFixture();
const browser = await chromium.launch({args: ['--enable-unsafe-swiftshader']});
const page = await browser.newPage({viewport: {width: 1280, height: 900}});
page.setDefaultTimeout(20000);
const errors = [];
page.on('pageerror', (error) => errors.push(error.message));
await page.addInitScript(() => {
  window.__musicTestAudios = [];
  const create = document.createElement.bind(document);
  document.createElement = function(name, options) {
    const element = create(name, options);
    if (String(name).toLowerCase() === 'audio') window.__musicTestAudios.push(element);
    return element;
  };
});
await page.route('**/music/**', async (route) => {
  const pathname = new URL(route.request().url()).pathname;
  if (pathname.endsWith('manifest.json')) {
    await route.fulfill({status: 200, contentType: 'application/json', body: '[]'});
  } else if (pathname.endsWith('.lrc')) {
    await route.fulfill({status: 200, contentType: 'text/plain', body: '[00:00.00]播放测试\n[00:05.00]歌词切换测试\n[00:10.00]退出测试'});
  } else if (/\.(?:mp3|wav|flac)$/i.test(pathname)) {
    const range = route.request().headers().range?.match(/^bytes=(\d+)-(\d*)$/);
    const start = range ? Number(range[1]) : 0;
    const end = range?.[2] ? Math.min(Number(range[2]), audio.length - 1) : audio.length - 1;
    if (start > end || start >= audio.length) {
      await route.fulfill({status: 416, headers: {'Content-Range': `bytes */${audio.length}`}});
      return;
    }
    const body = audio.subarray(start, end + 1);
    await route.fulfill({
      status: range ? 206 : 200,
      contentType: 'audio/wav',
      headers: {
        'Accept-Ranges': 'bytes',
        'Content-Length': String(body.length),
        ...(range ? {'Content-Range': `bytes ${start}-${end}/${audio.length}`} : {}),
      },
      body,
    });
  } else {
    await route.fulfill({status: 200, contentType: 'image/png', body: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aPyoAAAAASUVORK5CYII=', 'base64')});
  }
});

let checks = 0;
const passed = (name) => console.log(`PASS ${++checks}: ${name}`);
const trigger = () => page.getByRole('button', {name: '打开音乐播放器', exact: true});
const panel = () => page.getByRole('dialog', {name: '音乐歌单', exact: true});
const playbackDiagnostic = () => page.evaluate(() => ({
  originalAudioExists: Boolean(window.__playingAudio),
  originalPaused: window.__playingAudio?.paused,
  originalTime: window.__playingAudio?.currentTime,
  audios: window.__musicTestAudios.map((element) => ({
    src: element.currentSrc, paused: element.paused, time: element.currentTime,
    readyState: element.readyState, errorCode: element.error?.code,
    seekable: Array.from({length: element.seekable.length}, (_, index) => [element.seekable.start(index), element.seekable.end(index)]),
  })),
}));

try {
  await page.goto('http://127.0.0.1:4173/', {waitUntil: 'networkidle'});
  await trigger().waitFor();
  assert.equal(await page.evaluate(() => window.__musicTestAudios.length), 0);
  passed('默认只有全站入口，不自动创建或播放音频');

  await trigger().click();
  await panel().waitFor();
  await page.getByRole('searchbox', {name: '搜索音乐'}).waitFor();
  await page.waitForFunction(() => window.__musicTestAudios.length === 1);
  assert.equal(await page.evaluate(() => window.__musicTestAudios[0].paused), true);
  passed('打开选歌面板不自动播放');

  await page.screenshot({path: `${output}/desktop.png`});
  await page.getByRole('searchbox', {name: '搜索音乐'}).fill('晴天');
  const firstTrack = panel().locator('button[class*="trackItem"]').first();
  await firstTrack.waitFor();
  await firstTrack.click();
  await panel().waitFor({state: 'hidden'});
  await page.waitForFunction(() => window.__musicTestAudios.some((element) => !element.paused && element.currentTime > 0));
  assert.equal(await page.locator('.aplayer').count(), 1);
  assert.equal(await page.getByRole('button', {name: '关闭全屏歌词'}).isVisible(), false);
  passed('搜索点选后播放，只有一个播放器，歌词不自动全屏');

  await page.evaluate(() => {
    window.__playingAudio = window.__musicTestAudios.find((element) => !element.paused);
    window.__playingAudio.currentTime = 7;
  });
  await page.waitForFunction(() => window.__playingAudio.currentTime >= 7, null, {timeout: 3000});
  console.log('Before navigation:', await playbackDiagnostic());
  await page.locator('a[href="/my-journey-in-cybersecurity"]:visible').first().click();
  await page.waitForURL('**/my-journey-in-cybersecurity*');
  console.log('After navigation:', await playbackDiagnostic());
  assert.equal(await page.evaluate(() => Boolean(window.__playingAudio) && !window.__playingAudio.paused && window.__playingAudio.currentTime >= 7), true);
  assert.equal(await page.locator('.aplayer').count(), 1);
  assert.equal(await page.getByText('音频加载失败，请尝试另一首歌。', {exact: true}).count(), 0);
  passed('从首页切到文章，音频和进度不中断，旧音频事件不会误报');

  await page.locator('.aplayer-icon-menu').click();
  await panel().waitFor();
  await page.getByRole('button', {name: '关闭音乐歌单', exact: true}).click();
  await page.locator('.aplayer-icon-lrc').click();
  await page.getByRole('button', {name: '关闭全屏歌词'}).waitFor();
  await page.getByRole('button', {name: '关闭全屏歌词'}).click();
  await page.getByRole('button', {name: '关闭全屏歌词'}).waitFor({state: 'hidden'});
  passed('原生列表按钮进入统一选歌面板，歌词可主动打开和关闭');

  const timeBeforeCollapse = await page.evaluate(() => window.__playingAudio.currentTime);
  await page.getByRole('button', {name: '收起播放器并继续播放'}).click();
  await page.waitForTimeout(400);
  assert.equal(await page.evaluate((before) => !window.__playingAudio.paused && window.__playingAudio.currentTime >= before, timeBeforeCollapse), true);
  assert.equal(await page.locator('.aplayer').isVisible(), false);
  await trigger().click();
  await panel().waitFor();
  assert.equal(await page.evaluate(() => !window.__playingAudio.paused), true);
  passed('收起只隐藏界面，播放不中断；重新打开仍继续当前歌曲');

  await page.getByRole('searchbox', {name: '搜索音乐'}).fill('___no_such_track___');
  await panel().getByText('没有匹配', {exact: false}).first().waitFor();
  passed('无结果搜索有明确反馈');

  await page.evaluate(() => window.__musicTestAudios.forEach((element) => element.pause()));
  await page.setViewportSize({width: 390, height: 844});
  await page.goto('http://127.0.0.1:4173/my-playlist', {waitUntil: 'networkidle'});
  await panel().waitFor();
  assert.equal(new URL(page.url()).pathname, '/');
  const box = await panel().boundingBox();
  assert.ok(box && box.x >= 0 && box.x + box.width <= 391 && box.y >= 0 && box.y + box.height <= 844);
  assert.equal(await page.evaluate(() => window.__musicTestAudios.every((element) => element.paused)), true);
  assert.notEqual(await page.evaluate(() => document.activeElement?.getAttribute('aria-label')), '搜索音乐');
  const mobileCloseBox = await page.getByRole('button', {name: '关闭音乐歌单', exact: true}).boundingBox();
  assert.ok(mobileCloseBox && mobileCloseBox.width >= 44 && mobileCloseBox.height >= 44);
  const mobileTrackBox = await panel().locator('button[class*="trackItem"]').first().boundingBox();
  assert.ok(mobileTrackBox && mobileTrackBox.height >= 44);
  await page.screenshot({path: `${output}/mobile.png`});
  passed('旧音乐链接兼容，手机面板不溢出、不自动弹键盘且常用触控目标足够大');

  await page.goto('http://127.0.0.1:4173/health?music=open&example=keep', {waitUntil: 'networkidle'});
  await panel().waitFor();
  assert.equal(new URL(page.url()).pathname.replace(/\/$/, ''), '/health');
  assert.equal(new URL(page.url()).searchParams.get('example'), 'keep');
  assert.equal(new URL(page.url()).searchParams.has('music'), false);
  passed('任意页面打开面板时保留阅读位置及其他查询参数');

  assert.deepEqual(errors, []);
  passed('浏览器没有未处理的运行时异常');
  console.log(`音乐播放器浏览器回归：${checks} 项通过（生成音频夹具）。`);
} catch (error) {
  await page.screenshot({path: `${output}/failure.png`, fullPage: true});
  console.error('Browser errors:', errors);
  console.error('Playback state:', await playbackDiagnostic());
  throw error;
} finally {
  await browser.close();
}
