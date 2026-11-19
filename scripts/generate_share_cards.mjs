import fs from 'node:fs';
import path from 'node:path';
import createJiti from 'jiti';

const site = path.resolve(import.meta.dirname, '..');
const jiti = createJiti(import.meta.url);
const {featuredReading} = jiti(path.join(site, 'src/data/featuredReading.ts'));
const escape = (value) => value.replace(/[&<>"']/g, (character) => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;'}[character]));
const cards = [{id: 'feei', category: '吴飞飞 · Feei', shareLines: ['高等级的安全如何建设', '也记录生活'], shareSubtitle: '网络安全 · 人工智能安全 · 人生实践'}, ...featuredReading];
const folder = path.join(site, 'static/img/share');
fs.mkdirSync(folder, {recursive: true});
for (const card of cards) {
  const text = card.shareLines.map((line, index) => `<text x="88" y="${270 + index * 91}" font-size="68" font-weight="600">${escape(line)}</text>`).join('\n');
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630">
<rect width="1200" height="630" fill="#f5f5f0"/>
<rect x="0" y="0" width="12" height="630" fill="#4a6458"/>
<g fill="#242b27" font-family="PingFang SC, Noto Sans CJK SC, Microsoft YaHei, sans-serif">
<text x="88" y="100" font-size="34" font-weight="800" letter-spacing="-2">FEEI</text>
<text x="1110" y="96" text-anchor="end" font-size="23" fill="#526257">${escape(card.category)}</text>
${text}
<text x="88" y="${card.shareLines.length > 1 ? 433 : 362}" font-size="28" fill="#526257">${escape(card.shareSubtitle)}</text>
<path d="M88 515H1110" stroke="#cfd4cc"/>
<text x="88" y="571" font-size="25">吴飞飞 · Feei</text>
<text x="1110" y="571" text-anchor="end" font-size="23" fill="#526257">feei.cn</text>
</g>
</svg>\n`;
  fs.writeFileSync(path.join(folder, `${card.id}.svg`), svg);
}
console.log(`已生成 ${cards.length} 张 1200 × 630 SVG 分享封面；PNG 使用浏览器按原尺寸导出。`);
