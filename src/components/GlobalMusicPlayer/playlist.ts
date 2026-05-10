import type {Audio} from 'aplayer';
import {localLyricsFileByAudioFile} from './localLyrics';

export type PlaylistGroup = {
  id: string;
  label: string;
  tracks: Audio[];
};

export type PlaylistManifestTrack = {
  title: string;
  artist: string;
  source_url: string;
  local_path: string;
};

export type PlaylistManifestGroup = {
  id: string;
  label: string;
  tracks: PlaylistManifestTrack[];
};

const defaultCover = '/music/feei-site-theme-cover.webp';
const defaultTheme = '#205d3b';

const toEncodedUrl = (path: string): string => {
  const normalizedPath = path.replace(/^\/+/, '').replace(/^static\//, '');
  const encodedPath = normalizedPath
    .split('/')
    .filter(Boolean)
    .map((segment) => encodeURIComponent(segment))
    .join('/');

  return `/${encodedPath}`;
};

const localTrack = (name: string, artist: string, fileName: string): Audio => {
  const lyricFileName = localLyricsFileByAudioFile[fileName];

  return {
    name,
    artist,
    url: toEncodedUrl(`music/${fileName}`),
    ...(lyricFileName ? {lrc: toEncodedUrl(`music/${lyricFileName}`)} : {}),
    cover: defaultCover,
    theme: defaultTheme,
  };
};

export const playlistGroupFromManifest = (group: PlaylistManifestGroup): PlaylistGroup => ({
  id: group.id,
  label: group.label,
  tracks: group.tracks.map((track) => ({
    name: track.title,
    artist: track.artist,
    url: toEncodedUrl(track.local_path),
    cover: defaultCover,
    theme: defaultTheme,
  })),
});

const favoriteTracks: Audio[] = [
  // 我喜欢的音乐
  localTrack('我走后', 'ycccc', '我走后.mp3'),
  localTrack('只对你有感觉', '飞轮海&田馥甄', '只对你有感觉.mp3'),
  localTrack('你就不要想起我', '田馥甄', '你就不要想起我.mp3'),
  localTrack('魔鬼中的天使', '田馥甄', '魔鬼中的天使.mp3'),
  localTrack('我知道', 'BY2', '我知道.mp3'),
  localTrack('忘记时间', '胡歌', '忘记时间-胡歌.mp3'),
  localTrack('等一分钟', '徐誉滕', '等一分钟-徐誉滕.mp3'),
  localTrack('别怕我伤心', '张信哲', '别怕我伤心-张信哲.mp3'),
  localTrack('乌兰巴托的夜', '半吨兄弟&张茜', '乌兰巴托的夜-半吨兄弟张茜.mp3'),
  localTrack('黄梅戏', '慕容晓晓', '黄梅戏-慕容晓晓.mp3'),
  localTrack('Plain Jane', 'A$AP Ferg&Nicki Minaj', 'Plain-Jane-AAP-FergNicki-Minaj.mp3'),
  localTrack('广岛之恋', '莫文蔚', '广岛之恋-莫文蔚.mp3'),
  localTrack('这世界这么多人', '莫文蔚', '这世界那么多人-莫文蔚.mp3'),
  localTrack('差不多先生', '热狗', '差不多先生-热狗.mp3'),
  localTrack('爱我别走', '张震岳', '爱我别走-张震岳.mp3'),
  localTrack('再见', '张震岳', '再见-张震岳.mp3'),
  localTrack('爱的初体验', '张震岳', '爱的初体验-张震岳.mp3'),
  localTrack('思念是一种病', '张震岳&蔡健雅', '思念是一种病-张震岳蔡健雅.mp3'),
  localTrack('坠落', '蔡健雅', '坠落-蔡健雅.mp3'),
  localTrack('寂寞寂寞不好', '曹格', '寂寞寂寞不好-曹格.mp3'),
  localTrack('跳楼机', '利比', '跳楼机-利比.mp3'),
  localTrack('开始懂了', '孙燕姿', '开始懂了-孙燕姿.mp3'),
  localTrack('我怀念的', '孙燕姿', '我怀念的-孙燕姿.mp3'),
  localTrack('遇见', '孙燕姿', '遇见-孙燕姿.mp3'),
  localTrack('就是爱你', '陶喆', '就是爱你-陶喆.mp3'),
  localTrack('爱很简单', '陶喆', '爱很简单-陶喆.mp3'),
  localTrack('往后余生', '马良&孙茜茹', '往后余生-马良孙茜茹.mp3'),
  localTrack('谁', '洋澜一', '谁-洋澜一.mp3'),
  localTrack('年轮', '张碧晨', '年轮-张碧晨.mp3'),
  localTrack('把回忆拼好给你', 'cici_', '把回忆拼好给你-cici_.mp3'),
  localTrack('冬天的秘密', '周传雄', '冬天的秘密-周传雄.mp3'),
  localTrack('可不可以', '张紫豪', '可不可以-张紫豪.mp3'),
  localTrack('如果爱忘了', '旺仔小乔', '如果爱忘了-旺仔小乔.mp3'),
  localTrack('还有我', '任贤齐', '还有我-任贤齐.mp3'),
  localTrack('小宇', '张震岳', '小宇-张震岳.mp3'),
  localTrack('最后一页', '姚晓棠', '最后一页-姚晓棠.mp3'),
  localTrack('关山酒', '等什么君', '关山酒-等什么君.mp3'),
  localTrack('须尽欢', '郑浩', '须尽欢-郑浩.mp3'),
  localTrack('The Nights', 'Avicii', 'The-Nights.mp3'),
  localTrack('いつも何度でも', '宗次郎', 'いつも何度でも.mp3'),
  localTrack('愛にできることはまだあるかい', 'RADWIMPS', '愛にできることはまだあるかい.mp3'),
  localTrack('夢灯籠', 'RADWIMPS', '夢灯籠.mp3'),
  localTrack('三葉のテーマ', 'RADWIMPS', '三葉のテーマ.mp3'),
  localTrack('笔记', '周笔畅', '笔记-周笔畅.mp3'),
  localTrack('如愿', '王菲', '如愿-王菲.mp3'),
  localTrack('体面', '于文文', '体面-于文文.mp3'),
  localTrack('海底', '凤凰传奇', '海底-凤凰传奇.mp3'),
  localTrack('童年', '张艾嘉', '童年.mp3'),
  localTrack('东西', '林俊呈', '东西-林俊呈.mp3'),
  localTrack('卜卦', '崔子格', '卜卦-崔子格.mp3'),
  localTrack('后来', '刘若英', '后来-刘若英.mp3'),
  localTrack('黄昏', '周传雄', '黄昏-周传雄.mp3'),
  localTrack('房间', '刘瑞琦', '房间.mp3'),
  localTrack('青花', '周传雄', '青花-周传雄.mp3'),
  localTrack('勇气', '梁静茹', '勇气-梁静茹.mp3'),
  localTrack('宁夏', '梁静茹', '宁夏-梁静茹.mp3'),
  localTrack('泡沫', '邓紫棋', '泡沫-邓紫棋.mp3'),
  localTrack('城府', '许嵩', '城府-许嵩.mp3'),
  localTrack('素颜', '许嵩', '素颜-许嵩.mp3'),
  localTrack('幻听', '许嵩', '幻听-许嵩.mp3'),
  localTrack('花海', '周杰伦', '花海.mp3'),
  localTrack('夜曲', '周杰伦', '夜曲.mp3'),
  localTrack('退后', '周杰伦', '退后.mp3'),
  localTrack('外婆', '周杰伦', '外婆.mp3'),
  localTrack('逍遥叹', '胡歌', '逍遥叹.mp3'),
  localTrack('第一次', '房东的猫&戴羽彤', '第一次-房东的猫戴羽彤.mp3'),
  localTrack('起风了', '买辣椒也用券', '起风了-买辣椒也用券.mp3'),
  localTrack('春庭雪', '等什么君', '春庭雪-寒情.mp3'),
  localTrack('七里香', '周杰伦', '七里香.mp3'),
  localTrack('猜不透', '丁当', '猜不透-丁当.mp3'),
  localTrack('不怪她', '马思唯', '不怪她-马思唯.mp3'),
  localTrack('一笑江湖', '临渊不羡鱼', '一笑江湖-临渊不羡鱼.mp3'),
  localTrack('忽然之间', '莫文蔚', '忽然之间.mp3'),
  localTrack('千里之外', '周杰伦', '千里之外.mp3'),
  localTrack('我们的歌', '王力宏', '王力宏-我们的歌.mp3'),
  localTrack('无名的人', '孙楠', '无名的人-孙楠.mp3'),
  localTrack('个人简介', '安全着陆', '个人简介-安全着陆.mp3'),
  localTrack('此生不换', '青鸟飞鱼', '此生不换-青鸟飞鱼.mp3'),
  localTrack('有何不可', '许嵩', '有何不可-许嵩.mp3'),
  localTrack('孤单心事', '蓝又时', '孤单心事-蓝又时.mp3'),
  localTrack('铁血丹心', '罗文，甄妮', '铁血丹心.mp3'),
  localTrack('红色石头', '李智楠', '红色石头.mp3'),
  localTrack('我欲乘风', '安全着落', '我欲乘风-安全着陆.mp3'),
  localTrack('回到过去', '周杰伦', '回到过去.mp3'),
  localTrack('回到未来', 'Double Zhuo & Tizzy T', '回到未来-DoubleZhuoTizzyT.mp3'),
  localTrack('电台情歌', '莫文蔚', '电台情歌.mp3'),
  localTrack('清明雨上', '许嵩', '清明雨上-许嵩.mp3'),
  localTrack('需要人陪', '王力宏', '需要人陪.mp3'),
  localTrack('灰色头像', '许嵩', '灰色头像-许嵩.mp3'),
  localTrack('纸短情长', '烟把儿', '纸短情长.mp3'),
  localTrack('一生所爱', '卢冠廷&莫文蔚', '一生所爱-卢冠廷莫文蔚.mp3'),
  localTrack('平凡之路', '后会无期', '平凡之路.mp3'),
  localTrack('漫步人生路', '邓丽君', '漫步人生路-邓丽君.mp3'),
  localTrack('盛夏的果实', '莫文蔚', '盛夏的果实-莫文蔚.mp3'),
  localTrack('小手拉大手', '梁静茹', '小手拉大手-梁静茹.mp3'),
  localTrack('每个人都会', '方大同', '每个人都会-方大同.mp3'),
  localTrack('听妈妈的话', '周杰伦', '听妈妈的话.mp3'),
  localTrack('红色高跟鞋', '蔡健雅', '红色高跟鞋-蔡健雅.mp3'),
  localTrack('多余的解释', '许嵩', '多余的解释-许嵩.mp3'),
  localTrack('最好的安排', '曲婉婷', '最好的安排-曲婉婷.mp3'),
  localTrack('爱就一个字', '张信哲', '爱就一个字.mp3'),
  localTrack('可惜不是你', '梁静茹', '可惜不是你-梁静茹.mp3'),
  localTrack('会呼吸的痛', '梁静茹', '会呼吸的痛-梁静茹.mp3'),
  localTrack('玫瑰花的葬礼', '许嵩', '玫瑰花的葬礼-许嵩.mp3'),
  localTrack('有没有人告诉你', '陈楚生', '有没有人告诉你-陈楚生.mp3'),
  localTrack('给我一首歌的时间', '周杰伦', '给我一首歌的时间.mp3'),
  localTrack('最远的你是我最近的爱', '车继铃', '最远的你是我最近的爱.mp3'),
  localTrack('总有一天你会在我身边', '棱境', '总有一天你会在我身边-棱境.mp3'),
  localTrack('APT', 'ROSÉ & Bruno Mars', 'ROSE-Bruno-Mars-APT.mp3'),
  localTrack('Time', '小青龙 & 辉子', 'Time-小青龙辉子.mp3'),
  localTrack('August', 'Intelligency', 'August-Intelligency.mp3'),
  localTrack('Don\'t matter', 'Akon', 'Dont-Matter-Akon.mp3'),
  localTrack('Free Loop', 'Daniel Powter', 'freeloop.mp3'),
  localTrack('Jar of Love', '曲婉婷', 'jaroflove-曲婉婷.mp3'),
  localTrack('Plain Jane', 'A$AP Ferg&Nicki Minaj', 'Plain-JaneRemix-AAP-FergNicki-Minaj.mp3-.mp3'),
  localTrack('Thank You', 'Dido', 'Thank-You-Dido.mp3'),
  localTrack('I miss you', '罗百吉', 'IMissYou-罗百吉.mp3'),
  localTrack('See You Again', 'Wiz Khalifa&Charlie Puth ', 'SeeYouAgain-WizKhalifaCharliePuth.mp3'),
  localTrack('Rage Your Dream', 'm.o.v.e', 'Rage-Your-Dream-m.o.v.e.mp3'),
  localTrack('Welcome to New York', 'Taylor Swift', 'Welcome-to-new-york.mp3'),

];

const ambientTracks: Audio[] = [
  // 白噪音
  localTrack('雨声', '未知', '雨声.mp3'),
  localTrack('水流声1', 'BBC', 'bbc_water-gen_07031094.mp3'),
  localTrack('烟花声2', 'BBC', 'bbc_bonfires-_07019119.mp3'),
  localTrack('烟花声1', 'BBC', 'bbc_fireworks-_07019117.mp3'),
  localTrack('蝉鸣声1', 'BBC', 'bbc_desert-atm_nhu9327601.mp3'),
  localTrack('火焰声1', 'BBC', 'bbc_household-_07002052.mp3'),
  localTrack('鸟叫声5', 'BBC', 'bbc_birds-bla_07051151.mp3'),
  localTrack('鸟叫声4', 'BBC', 'bbc_deciduous-_nhu0509405.mp3'),
  localTrack('鸟叫声3', 'BBC', 'bbc_mixed-wood_nhu0509415.mp3'),
  localTrack('鸟叫声2', 'BBC', 'bbc_moorland-_nhu0510424.mp3'),
  localTrack('鸟叫声1', 'BBC', 'bbc_tropical-s_nhu0501109.mp3'),
];

export const siteMusicGroups: PlaylistGroup[] = [
  {
    id: 'favorites',
    label: '我喜欢的音乐',
    tracks: favoriteTracks,
  },
  {
    id: 'ambient',
    label: '白噪音',
    tracks: ambientTracks,
  },
];

export const siteMusicPlaylist: Audio[] = favoriteTracks;
