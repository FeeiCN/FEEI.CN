import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';
import createJiti from 'jiti';

const siteDir = path.resolve(import.meta.dirname, '..');
const jiti = createJiti(import.meta.url);
const {staticAssetUrl, staticAssetSrcSet} = jiti(path.join(siteDir, 'src/utils/staticAssets.ts'));
const remarkStaticMedia = jiti(path.join(siteDir, 'plugins/remarkStaticMedia.ts')).default;
const {siteMusicGroups, playlistGroupFromManifest, babyMusicManifestUrl} = jiti(path.join(siteDir, 'src/components/GlobalMusicPlayer/playlist.ts'));

test('static media uses the production origin from nested pages without double encoding', () => {
  for (const value of ['/media/图片.webp', 'music/歌曲.mp3', 'static/img/logo.svg', '../static/media/video.mp4']) {
    const url = staticAssetUrl(value);
    assert.equal(new URL(url).origin, 'https://feei.cn');
    assert.equal(staticAssetUrl(url), url);
  }
  assert.equal(staticAssetUrl('/media/a%20b.webp?v=2#photo'), 'https://feei.cn/media/a%20b.webp?v=2#photo');
});

test('external URLs, browser media, bundled assets and document routes stay intact', () => {
  for (const value of ['https://example.com/image.png', '//cdn.example.com/video.mp4', 'data:image/png;base64,AAAA', 'blob:https://feei.cn/id', '/assets/images/hash.png', '/security-threats', undefined]) {
    assert.equal(staticAssetUrl(value), value);
  }
});

test('responsive images retain descriptors and embedded data', () => {
  assert.equal(staticAssetSrcSet(' /media/a.webp 1x, /media/b.webp 2x'), ' https://feei.cn/media/a.webp 1x, https://feei.cn/media/b.webp 2x');
  assert.equal(staticAssetSrcSet('data:image/png;base64,AAAA 1x, /media/b.webp 2x'), 'data:image/png;base64,AAAA 1x, https://feei.cn/media/b.webp 2x');
});

test('Markdown media is rewritten before Docusaurus imports local static files', () => {
  const tree = {type: 'root', children: [
    {type: 'image', url: '/media/article/photo.webp'},
    {type: 'definition', identifier: 'photo', url: '/img/logo.svg'},
    {type: 'mdxJsxFlowElement', name: 'video', attributes: [{name: 'src', value: '/media/movie.mp4'}, {name: 'poster', value: '/media/poster.webp'}]},
    {type: 'html', value: '<audio controls src="/music/sample.mp3"></audio>'},
    {type: 'code', value: '<img src="/media/example.webp">'},
    {type: 'link', url: '/security-threats'},
  ]};
  remarkStaticMedia()(tree);
  assert.equal(tree.children[0].url, 'https://feei.cn/media/article/photo.webp');
  assert.equal(tree.children[1].url, 'https://feei.cn/img/logo.svg');
  assert.deepEqual(tree.children[2].attributes.map(item => item.value), ['https://feei.cn/media/movie.mp4', 'https://feei.cn/media/poster.webp']);
  assert.match(tree.children[3].value, /src="https:\/\/feei.cn\/music\/sample.mp3"/);
  assert.equal(tree.children[4].value, '<img src="/media/example.webp">');
  assert.equal(tree.children[5].url, '/security-threats');
});

test('all registered music, covers, lyrics and manifest tracks use absolute URLs', () => {
  for (const track of siteMusicGroups.flatMap(group => group.tracks)) {
    for (const key of ['url', 'cover', 'lrc']) {
      if (typeof track[key] === 'string') assert.ok(track[key].startsWith('https://feei.cn/music/'), `${key}: ${track[key]}`);
    }
  }
  const group = playlistGroupFromManifest({id: 'test', label: 'test', tracks: [{title: 'test', artist: 'test', source_url: '', local_path: 'static/music/宝宝/歌曲.mp3'}]});
  assert.equal(group.tracks[0].url, 'https://feei.cn/music/%E5%AE%9D%E5%AE%9D/%E6%AD%8C%E6%9B%B2.mp3');
});

test('music metadata bypasses cached responses from before CORS was enabled', () => {
  const version = new URL(babyMusicManifestUrl).searchParams.get('v');
  assert.ok(version);
  const lyrics = siteMusicGroups.flatMap(group => group.tracks).filter(track => typeof track.lrc === 'string');
  assert.ok(lyrics.length > 0);
  assert.ok(lyrics.every(track => new URL(track.lrc).searchParams.get('v') === version));
});
