from pathlib import Path
p=Path('src/components/GlobalMusicPlayer/Client.tsx')
s=p.read_text().replace('  play?: () => void;','  play?: () => void;\n  pause?: () => void;').replace('player?.pause();','player?.pause?.();')
s=s.replace('new (options: APlayerOptions)', 'new (options: APlayerOptions & {mini?: boolean})')
s=s.replace('          fixed: true,','          fixed: true,\n          mini: false,')
s=s.replace('        _lastGroupId = currentGroup.id;', "        _lastGroupId = currentGroup.id;\n        const info = mount.querySelector<HTMLElement>('.aplayer-info');\n        if (info) info.style.display = 'block';")
s=s.replace("    shell.style.display = isPlayerVisible ? '' : 'none';", "    _wasVisible = isPlayerVisible;\n    shell.style.display = isPlayerVisible ? '' : 'none';")
p.write_text(s)
p=Path('src/components/GlobalMusicPlayer/Controls.tsx')
s=p.read_text().replace("    dialog.showModal();", "    void import('aplayer').catch(() => {});\n    dialog.showModal();")
s=s.replace("        onKeyDown={(event) => {\n          if (event.metaKey", "        onKeyDown={(event) => {\n          if (event.key === 'Escape') {\n            event.preventDefault();\n            event.stopPropagation();\n            close();\n            return;\n          }\n          if (event.metaKey")
p.write_text(s)
p=Path('src/components/GlobalMusicPlayer/controls.module.css')
p.write_text(p.read_text()+'\n@media (max-width: 640px) { .selectors select { font-size: 16px; } }\n')
p=Path('src/components/GlobalMusicPlayer/styles.module.css')
p.write_text(p.read_text()+'\n.musicPlayerMount :global(.aplayer-miniswitcher) { display: none !important; }\n')
p=Path('scripts/test_music_player.mjs')
s=p.read_text().replace("async function mockMusic(page) {", """async function mockMusic(page) {
  await page.addInitScript(() => {
    window.__musicAudios = [];
    const original = Document.prototype.createElement;
    Document.prototype.createElement = function(name, options) {
      const element = original.call(this, name, options);
      if (String(name).toLowerCase() === 'audio') window.__musicAudios.push(element);
      return element;
    };
  });""")
s=s.replace("await page.locator('audio').count()", "await page.evaluate(() => window.__musicAudios.filter((a) => a.getAttribute('src')).length)")
s=s.replace("document.querySelector('audio')", "window.__musicAudios.at(-1)")
s=s.replace("await page.locator('audio').getAttribute('src')", "await page.evaluate(() => window.__musicAudios.at(-1)?.getAttribute('src'))")
s=s.replace("await page.locator('audio').evaluate((el) => el.currentTime)", "await page.evaluate(() => window.__musicAudios.at(-1).currentTime)")
s=s.replace("await page.locator('audio').evaluate((el) => el.paused)", "await page.evaluate(() => window.__musicAudios.at(-1).paused)")
s=s.replace("await page.locator('.aplayer-lrc').isVisible(), false", "await page.locator('.aplayer-lrc').evaluate((el) => el.classList.contains('aplayer-lrc-hide')), true")
s=s.replace("await page.locator('.aplayer-lrc').isVisible(), true", "await page.locator('.aplayer-lrc').evaluate((el) => el.classList.contains('aplayer-lrc-hide')), false")
assert "page.locator('audio')" not in s
s=s.replace("import {mkdirSync} from 'node:fs';", "import {mkdirSync, writeFileSync} from 'node:fs';")
s=s.replace("async function check(name, task) { await task(); checks++; console.log(`PASS ${name}`); }", """async function check(name, task) {
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
}""")
s=s.replace("await launcher.click();\n  await check('按歌手播放", """await check('收起后切换页面不重新展开', async () => {
    await page.goBack();
    await page.waitForURL(/\\/$/);
    assert.equal(await page.locator('.aplayer-body').isVisible(), false);
    assert.equal(await page.evaluate(() => window.__musicAudios.at(-1).paused), true);
    await page.locator('a[href="/my-journey-in-cybersecurity"]').first().click();
    await page.waitForURL(/\\/my-journey-in-cybersecurity\\/?$/);
    assert.equal(await page.locator('.aplayer-body').isVisible(), false);
  });
  await launcher.click();
  await check('按歌手播放""")
s=s.replace("await panel.getByRole('button', {name: '播放 测试儿歌 · 测试歌手', exact: true}).click();", "await panel.getByRole('button', {name: '播放 测试儿歌 · 测试歌手', exact: true}).click();\n    await page.waitForFunction(() => window.__musicAudios.at(-1)?.src.includes('baby-music/test.wav'));" )
s=s.replace("await page.keyboard.press('Escape');", "await page.keyboard.press('Escape'); await panel.waitFor({state: 'hidden'});")
p.write_text(s)
p=Path('docs/01-网络安全/01-网络空间安全/03-安全体系/03-安全合法合规/_移动互联网应用程序信息服务管理规定原文.md')
s=p.read_text()
old='[《互联网新闻信息服务管理规定》](./互联网新闻信息服务管理规定.md)'
assert old in s
p.write_text(s.replace(old,'《互联网新闻信息服务管理规定》'))
