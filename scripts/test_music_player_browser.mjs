import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {pathToFileURL} from 'node:url';

const {chromium} = await import(process.env.PLAYWRIGHT_MODULE
  ? pathToFileURL(process.env.PLAYWRIGHT_MODULE).href : 'playwright');
const output = '.music-player-test';
const baseUrl = process.env.MUSIC_TEST_BASE_URL ?? 'http://127.0.0.1:4173';
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
const browser = await chromium.launch({channel: process.env.PLAYWRIGHT_BROWSER_CHANNEL, args: ['--enable-unsafe-swiftshader']});
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
let failAudioRequests = false;
let audioDelay = 0;
await page.route('**/music/**', async (route) => {
  const pathname = new URL(route.request().url()).pathname;
  if (pathname.endsWith('manifest.json')) {
    await route.fulfill({status: 200, contentType: 'application/json', body: '[]'});
  } else if (pathname.endsWith('.lrc')) {
    await route.fulfill({status: 200, contentType: 'text/plain', body: '[00:00.00]播放测试\n[00:05.00]歌词切换测试\n[00:10.00]退出测试'});
  } else if (/\.(?:mp3|wav|flac)$/i.test(pathname)) {
    if (failAudioRequests) {
      await route.fulfill({status: 404, body: 'Unavailable audio fixture'});
      return;
    }
    if (audioDelay) await new Promise((resolve) => setTimeout(resolve, audioDelay));
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
const trigger = () => page.getByRole('button', {name: '音乐', exact: true});
const panel = () => page.getByRole('dialog', {name: '音乐播放器', exact: true});
const mini = () => page.getByRole('button', {name: '展开音乐播放器', exact: true});
const close = () => page.getByRole('button', {name: '收起播放器并继续播放', exact: true});
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
  await page.goto(`${baseUrl}/`, {waitUntil: 'networkidle'});
  await trigger().waitFor();
  assert.equal(await page.evaluate(() => window.__musicTestAudios.length), 0);
  assert.equal(await trigger().evaluate((element) => Boolean(element.closest('.navbar__items--right'))), true);
  assert.equal(await mini().isVisible(), false);
  const originalBottomPadding = await page.locator('body').evaluate((element) => getComputedStyle(element).paddingBottom);
  passed('默认仅顶部导航显示音乐入口，不显示底部迷你条或创建音频');

  await trigger().click();
  await panel().waitFor();
  await page.getByRole('searchbox', {name: '搜索音乐'}).waitFor();
  await page.waitForFunction(() => window.__musicTestAudios.length === 1);
  assert.equal(await page.evaluate(() => window.__musicTestAudios[0].paused), true);
  const desktopBox = await panel().boundingBox();
  const navbarBox = await trigger().boundingBox();
  assert.ok(desktopBox && navbarBox && desktopBox.y >= navbarBox.y + navbarBox.height && desktopBox.y < 100);
  assert.equal(await panel().getByRole('tab').count(), 0);
  const firstRow = await panel().locator('button[data-track-url]').first().boundingBox();
  assert.ok(firstRow && desktopBox.y + desktopBox.height - firstRow.y > desktopBox.height / 2);
  assert.equal(await panel().locator('footer').count(), 0);
  assert.equal(await trigger().getAttribute('aria-expanded'), 'true');
  await trigger().click();
  await panel().waitFor({state: 'hidden'});
  assert.equal(await trigger().getAttribute('aria-expanded'), 'false');
  await trigger().click();
  await panel().waitFor();
  passed('打开选歌面板不自动播放');

  await page.keyboard.press('Escape');
  await panel().waitFor({state: 'hidden'});
  await page.waitForFunction(() => document.activeElement?.hasAttribute('data-music-trigger'));
  assert.equal(await mini().isVisible(), false);
  await trigger().press('Enter');
  await panel().waitFor();
  passed('入口支持键盘打开，关闭后恢复焦点，尚未播放时底部不留入口');

  assert.equal(await page.locator('select[aria-label="选择歌单"] optgroup[label="歌手"]').count(), 0);
  assert.ok(await page.locator('select[aria-label="选择歌单"] option').count() < 15);
  await page.getByRole('button', {name: '筛选歌手', exact: true}).click();
  await page.getByRole('searchbox', {name: '搜索歌手', exact: true}).fill('周杰伦');
  await page.getByRole('button', {name: /^周杰伦\s+\d+ 首$/}).click();
  await page.waitForFunction(() => document.querySelector('[data-music-scroll]')?.scrollHeight > 1000);
  await page.locator('[data-music-scroll]').evaluate((element) => { element.scrollTop = 500; });
  await page.waitForFunction(() => JSON.parse(sessionStorage.getItem('feei-music-library-session-v1') ?? '{}').scrollTop >= 490);
  const rememberedScroll = await page.locator('[data-music-scroll]').evaluate((element) => element.scrollTop);
  await close().click();
  await trigger().click();
  await page.getByRole('button', {name: '筛选歌手', exact: true}).filter({hasText: '周杰伦'}).waitFor();
  await page.waitForFunction((top) => Math.abs(document.querySelector('[data-music-scroll]').scrollTop - top) <= 2, rememberedScroll);
  passed('歌单和歌手分开筛选，收起后保留歌手及列表滚动位置');

  await page.screenshot({path: `${output}/desktop.png`});
  await page.getByRole('searchbox', {name: '搜索音乐'}).fill('晴天');
  const firstTrack = panel().locator('button[class*="trackItem"]').first();
  await firstTrack.waitFor();
  await firstTrack.click();
  await page.waitForFunction(() => window.__musicTestAudios.some((element) => !element.paused && element.currentTime > 0));
  assert.equal(await trigger().getAttribute('data-playing'), 'true');
  assert.equal(await page.locator('.aplayer').count(), 1);
  assert.equal(await page.getByRole('button', {name: '关闭全屏歌词'}).isVisible(), false);
  passed('搜索点选后播放，只有一个播放器，歌词不自动全屏');

  await close().click();
  assert.equal(await mini().count(), 0);
  await page.waitForFunction(() => !document.body.classList.contains('music-player-active'));
  assert.equal(await page.locator('body').evaluate((element) => getComputedStyle(element).paddingBottom), originalBottomPadding);
  await page.waitForFunction(() => document.querySelector('[data-music-trigger]')?.dataset.playbackState === 'playing');
  await trigger().click();
  await panel().waitFor();
  await page.getByRole('button', {name: '暂停', exact: true}).click();
  await page.waitForFunction(() => window.__musicTestAudios.every((element) => element.paused));
  await page.waitForFunction(() => document.querySelector('[data-music-trigger]')?.dataset.playbackState === 'paused');
  assert.equal(await trigger().getAttribute('data-playing'), null);
  await page.getByRole('button', {name: '播放', exact: true}).click();
  await page.waitForFunction(() => window.__musicTestAudios.some((element) => !element.paused));
  const previousTrackUrl = await page.evaluate(() => window.__musicTestAudios.find((element) => !element.paused)?.currentSrc);
  await page.getByRole('button', {name: '下一首', exact: true}).click();
  await page.waitForFunction((previous) => window.__musicTestAudios.some((element) => !element.paused && element.currentSrc !== previous), previousTrackUrl);
  await close().click();
  passed('桌面收起后仅保留顶部入口，通过顶部窗口暂停、继续和切歌，不增加页面底部留白');

  await page.setViewportSize({width: 390, height: 844});
  await mini().waitFor();
  assert.equal(await page.evaluate(() => window.__musicTestAudios.some((element) => !element.paused)), true);
  await page.setViewportSize({width: 1280, height: 900});
  await page.waitForFunction(() => !document.querySelector('[aria-label="展开音乐播放器"]'));
  assert.equal(await page.evaluate(() => window.__musicTestAudios.some((element) => !element.paused)), true);
  passed('窄屏显示底部迷你条，恢复桌面宽度后移除，切换尺寸不影响播放');

  await trigger().click();
  assert.equal(await page.getByRole('searchbox', {name: '搜索音乐'}).inputValue(), '晴天');
  await page.getByRole('button', {name: '定位当前歌曲', exact: true}).click();
  await page.waitForFunction(() => document.activeElement?.matches('[data-track-url][aria-current="true"]'));
  const located = await panel().locator('button[data-track-url][aria-current="true"]').boundingBox();
  const viewport = await panel().locator('[data-music-scroll]').boundingBox();
  assert.ok(located && viewport && located.y >= viewport.y && located.y + located.height <= viewport.y + viewport.height,
    JSON.stringify({located, viewport, scrollTop: await panel().locator('[data-music-scroll]').evaluate((element) => element.scrollTop)}));
  assert.equal(await page.getByRole('searchbox', {name: '搜索音乐'}).inputValue(), '');
  await close().click();
  passed('重新打开保留搜索，定位当前歌曲会清除筛选并滚到当前曲目');

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

  await trigger().click();
  await panel().waitFor();
  await page.getByRole('button', {name: /^展开播放控制：/}).click();
  await page.getByRole('region', {name: '播放控制', exact: true}).waitFor();
  await page.getByRole('button', {name: '全屏歌词', exact: true}).click();
  await page.getByRole('button', {name: '关闭全屏歌词'}).waitFor();
  await page.getByRole('button', {name: '关闭全屏歌词'}).click();
  await page.getByRole('button', {name: '关闭全屏歌词'}).waitFor({state: 'hidden'});
  passed('顶部窗口内展开当前歌曲，歌词可主动打开和关闭');

  await page.getByRole('button', {name: '调整音量', exact: true}).click();
  const volumeSlider = page.getByRole('slider', {name: '音量', exact: true});
  await volumeSlider.focus();
  await volumeSlider.press('Home');
  await volumeSlider.press('ArrowRight');
  await page.waitForFunction(() => Math.abs(window.__playingAudio.volume - 0.05) < 0.001);
  await page.keyboard.press('Escape');
  await volumeSlider.waitFor({state: 'hidden'});
  await page.waitForFunction(() => document.activeElement?.getAttribute('aria-label') === '调整音量');
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  assert.equal(await panel().isVisible(), true);
  for (let attempt = 0; attempt < 3; attempt++) {
    await page.getByRole('button', {name: '调整音量', exact: true}).click();
    await volumeSlider.waitFor();
    await volumeSlider.focus();
    await page.keyboard.press('Escape');
    await volumeSlider.waitFor({state: 'hidden'});
    await page.waitForFunction(() => document.activeElement?.getAttribute('aria-label') === '调整音量');
    assert.equal(await panel().isVisible(), true);
  }
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  await page.locator('main h1').click({position: {x: 5, y: 5}});
  await panel().waitFor({state: 'hidden'});
  await trigger().click();
  await panel().waitFor();
  await page.getByRole('button', {name: /^展开播放控制：/}).click();
  await page.getByRole('region', {name: '播放控制', exact: true}).waitFor();
  const detailsToggle = () => page.getByRole('button', {name: /^(展开|收起)播放控制：/});
  await page.getByRole('region', {name: '播放控制', exact: true}).waitFor();
  await page.waitForFunction(() => document.querySelector('footer button[aria-expanded]')?.getAttribute('aria-expanded') === 'true');
  await page.getByRole('searchbox', {name: '搜索音乐'}).waitFor();
  await page.waitForFunction(() => Math.abs(document.querySelector('[data-music-scroll]').scrollTop
    - JSON.parse(sessionStorage.getItem('feei-music-library-session-v1')).scrollTop) <= 2);
  await page.locator('[data-music-scroll]').evaluate((element) => { element.scrollTop = 300; window.__libraryBeforeToggle = element; });
  await page.waitForFunction(() => JSON.parse(sessionStorage.getItem('feei-music-library-session-v1')).scrollTop === 300);
  const scrollBeforeToggle = await page.locator('[data-music-scroll]').evaluate((element) => element.scrollTop);
  await detailsToggle().click();
  await page.getByRole('region', {name: '播放控制', exact: true}).waitFor({state: 'hidden'});
  await page.waitForFunction(() => document.querySelector('footer button[aria-expanded]')?.getAttribute('aria-expanded') === 'false');
  assert.equal(await detailsToggle().getAttribute('aria-expanded'), 'false');
  assert.equal(await panel().locator('footer').getByRole('button', {name: '下一首', exact: true}).isVisible(), true);
  await detailsToggle().press('Enter');
  await page.getByRole('region', {name: '播放控制', exact: true}).waitFor();
  assert.equal(await detailsToggle().getAttribute('aria-expanded'), 'true');
  assert.equal(await page.getByRole('searchbox', {name: '搜索音乐'}).isVisible(), true);
  assert.equal(await page.locator('[data-music-scroll]').evaluate((element) => element === window.__libraryBeforeToggle), true);
  assert.equal(await page.locator('[data-music-scroll]').evaluate((element) => element.scrollTop), scrollBeforeToggle);
  assert.equal(await page.evaluate(() => window.__playingAudio.paused), false);
  passed('音量支持键盘，播放控制原地展开收起，歌单保持挂载及滚动位置，播放不中断');

  const timeBeforeCollapse = await page.evaluate(() => window.__playingAudio.currentTime);
  await close().click();
  assert.equal(await mini().count(), 0);
  assert.equal(await page.evaluate((before) => !window.__playingAudio.paused && window.__playingAudio.currentTime >= before, timeBeforeCollapse), true);
  assert.equal(await page.locator('.aplayer').isVisible(), false);
  await trigger().click();
  await panel().waitFor();
  assert.equal(await page.evaluate(() => !window.__playingAudio.paused), true);
  passed('收起只隐藏界面，播放不中断；重新打开仍继续当前歌曲');

  await page.getByRole('searchbox', {name: '搜索音乐'}).fill('___no_such_track___');
  await panel().getByText('没有匹配', {exact: false}).first().waitFor();
  passed('无结果搜索有明确反馈');
  await page.getByRole('button', {name: '清空搜索', exact: true}).click();

  await page.evaluate(() => window.__musicTestAudios.forEach((element) => element.pause()));
  await page.setViewportSize({width: 390, height: 844});
  await page.goto(`${baseUrl}/my-playlist`, {waitUntil: 'networkidle'});
  await panel().waitFor();
  assert.equal(new URL(page.url()).pathname, '/');
  const box = await panel().boundingBox();
  assert.ok(box && box.x >= 0 && box.x + box.width <= 391 && box.y >= 0 && box.y + box.height <= 844);
  assert.ok(box.height <= 680 && box.y >= 160);
  assert.equal(await panel().getAttribute('aria-modal'), 'true');
  assert.equal(await page.evaluate(() => window.__musicTestAudios.every((element) => element.paused)), true);
  assert.notEqual(await page.evaluate(() => document.activeElement?.getAttribute('aria-label')), '搜索音乐');
  const mobileCloseBox = await close().boundingBox();
  assert.ok(mobileCloseBox && mobileCloseBox.width >= 44 && mobileCloseBox.height >= 44);
  const mobileTrackBox = await panel().locator('button[class*="trackItem"]').first().boundingBox();
  assert.ok(mobileTrackBox && mobileTrackBox.height >= 44);
  await page.screenshot({path: `${output}/mobile.png`});
  passed('旧音乐链接兼容，手机面板不溢出、不自动弹键盘且常用触控目标足够大');

  await page.waitForFunction(() => document.body.hasAttribute('data-scroll-lock'));
  const backgroundScroll = await page.evaluate(() => scrollY);
  await page.mouse.move(5, 80);
  await page.mouse.wheel(0, 600);
  await page.waitForTimeout(150);
  assert.equal(await page.evaluate(() => scrollY), backgroundScroll);
  await close().focus();
  await page.keyboard.press('Shift+Tab');
  assert.equal(await page.evaluate(() => Boolean(document.activeElement?.closest('#music-player-panel'))), true);
  passed('手机底部对话框锁定背景滚动，键盘焦点留在面板内');

  await close().click();
  const mobileTriggerBox = await trigger().boundingBox();
  const searchBox = await page.locator('.navbar__search-input').boundingBox();
  assert.ok(mobileTriggerBox && mobileTriggerBox.width >= 44 && mobileTriggerBox.height >= 44);
  assert.ok(searchBox && searchBox.x + searchBox.width <= mobileTriggerBox.x);
  await trigger().click();
  await panel().waitFor();
  await panel().locator('button[class*="trackItem"]').first().click();
  await page.waitForFunction(() => window.__musicTestAudios.some((element) => !element.paused));
  await page.getByRole('button', {name: /^展开播放控制：/}).click();
  await page.getByRole('button', {name: '全屏歌词', exact: true}).click();
  await page.getByRole('dialog', {name: '全屏歌词', exact: true}).waitFor();
  await page.keyboard.press('Escape');
  await page.getByRole('dialog', {name: '全屏歌词', exact: true}).waitFor({state: 'hidden'});
  await panel().waitFor();
  assert.equal(await panel().getAttribute('aria-modal'), 'true');
  await close().click();
  await mini().waitFor();
  const miniBox = await mini().boundingBox();
  assert.ok(miniBox && miniBox.y > 700 && miniBox.x >= 0 && miniBox.x + miniBox.width <= 390);
  await page.screenshot({path: `${output}/mobile-mini.png`});
  passed('手机搜索和顶部音乐入口不重叠，播放后迷你条位于底部');

  await page.getByRole('button', {name: '停止播放并收起', exact: true}).click();
  await mini().waitFor({state: 'hidden'});
  await page.waitForFunction(() => window.__musicTestAudios.every((element) => element.paused));
  await page.waitForFunction(() => !document.querySelector('[data-music-trigger]')?.hasAttribute('data-playing'));
  await trigger().click();
  await panel().waitFor();
  assert.equal(await panel().locator('footer').count(), 0);
  passed('结束听歌会暂停音频并隐藏迷你条，重新打开不会误显示正在播放');

  await page.goto(`${baseUrl}/health?music=open&example=keep`, {waitUntil: 'networkidle'});
  await panel().waitFor();
  assert.equal(new URL(page.url()).pathname.replace(/\/$/, ''), '/health');
  assert.equal(new URL(page.url()).searchParams.get('example'), 'keep');
  assert.equal(new URL(page.url()).searchParams.has('music'), false);
  passed('任意页面打开面板时保留阅读位置及其他查询参数');

  await page.getByRole('button', {name: '筛选歌手', exact: true}).click();
  await page.getByRole('searchbox', {name: '搜索歌手', exact: true}).fill('周杰伦');
  await page.getByRole('button', {name: /^周杰伦\s+\d+ 首$/}).click();
  await close().click();
  await page.reload({waitUntil: 'networkidle'});
  await trigger().click();
  await page.getByRole('button', {name: '筛选歌手', exact: true}).filter({hasText: '周杰伦'}).waitFor();
  passed('刷新和换页后仍保留选歌筛选');

  await page.getByRole('searchbox', {name: '搜索音乐'}).fill('晴天');
  failAudioRequests = true;
  await panel().locator('button[data-track-url]').first().click();
  await page.waitForFunction(() => document.querySelector('[data-music-trigger]')?.dataset.playbackState === 'error');
  await close().click();
  await page.getByRole('button', {name: '重试播放', exact: true}).waitFor();
  failAudioRequests = false;
  audioDelay = 1200;
  await page.getByRole('button', {name: '重试播放', exact: true}).click();
  await page.waitForFunction(() => document.querySelector('[data-music-trigger]')?.dataset.playbackState === 'loading');
  await page.waitForFunction(() => window.__musicTestAudios.some((element) => !element.paused && element.currentTime > 0));
  await page.waitForFunction(() => document.querySelector('[data-music-trigger]')?.dataset.playbackState === 'playing');
  audioDelay = 0;
  passed('真实请求失败显示失败状态，迷你条可直接重试，加载及播放状态同步');

  await mini().click();
  await page.setViewportSize({width: 320, height: 568});
  const playBox = await page.getByRole('button', {name: '暂停', exact: true}).boundingBox();
  const progressBox = await page.getByRole('slider', {name: '播放进度', exact: true}).boundingBox();
  assert.ok(playBox && progressBox && playBox.y + playBox.height < 568 && progressBox.y + progressBox.height < playBox.y);
  assert.equal(await page.getByRole('searchbox', {name: '搜索音乐'}).isVisible(), true);
  const listBox = await page.locator('[data-music-scroll]').boundingBox();
  assert.ok(listBox && listBox.height >= 160);
  assert.equal(await page.getByRole('button', {name: '返回选歌', exact: true}).count(), 0);
  await page.screenshot({path: `${output}/mobile-controls.png`});
  passed('小屏中播放控制和歌单共存，保持原地操作');

  for (const scheme of ['light', 'dark']) {
    await page.emulateMedia({colorScheme: scheme});
    await page.waitForFunction((value) => document.documentElement.dataset.theme === value, scheme);
    const contrast = await page.getByRole('button', {name: '暂停', exact: true}).evaluate((button) => {
      const style = getComputedStyle(button);
      const luminance = (color) => {
        const channels = color.match(/[\d.]+/g).slice(0, 3).map(Number).map((value) => {
          const channel = value / 255;
          return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
        });
        return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
      };
      const foreground = luminance(style.color);
      const background = luminance(style.backgroundColor);
      return (Math.max(foreground, background) + 0.05) / (Math.min(foreground, background) + 0.05);
    });
    assert.ok(contrast >= 4.5, `${scheme} 播放按钮对比度不足：${contrast}`);
  }
  passed('深浅主题下主播放按钮的图形与背景均保持清楚对比');

  await page.setViewportSize({width: 844, height: 390});
  await page.waitForFunction(() => document.querySelector('[data-music-scroll]').clientHeight >= 150);
  const landscapeList = await page.locator('[data-music-scroll]').boundingBox();
  const landscapeControls = await page.getByRole('region', {name: '播放控制', exact: true}).boundingBox();
  assert.ok(landscapeList && landscapeControls && landscapeControls.x >= landscapeList.x + landscapeList.width);
  assert.ok(landscapeControls.y >= 0 && landscapeControls.y + landscapeControls.height <= 390);
  await page.screenshot({path: `${output}/landscape-controls.png`});
  passed('低高度横屏并排展示歌单和展开的播放控制，两边均可操作');

  await page.emulateMedia({reducedMotion: 'reduce'});
  await detailsToggle().press('Space');
  await page.getByRole('region', {name: '播放控制', exact: true}).waitFor({state: 'hidden'});
  assert.equal(await detailsToggle().evaluate((element) => element === document.activeElement), true);
  await detailsToggle().press('Space');
  await page.getByRole('region', {name: '播放控制', exact: true}).waitFor();
  assert.equal(await page.getByRole('region', {name: '播放控制', exact: true}).evaluate((element) => getComputedStyle(element).animationName), 'none');
  assert.equal(await page.getByRole('searchbox', {name: '搜索音乐'}).isVisible(), true);
  passed('收缩支持键盘且保留焦点，减少动态效果设置下关闭动画');

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
