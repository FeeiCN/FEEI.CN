import BrowserOnly from '@docusaurus/BrowserOnly';
import clsx from 'clsx';
import {useEffect, useMemo, useState} from 'react';
import {
  buildMusicFilterGroups,
  playlistGroupFromManifest,
  siteMusicGroups,
} from '@site/src/components/GlobalMusicPlayer/playlist';
import type {
  PlaylistGroup,
  PlaylistManifestGroup,
} from '@site/src/components/GlobalMusicPlayer/playlist';
import styles from './styles.module.css';

const babyMusicManifestUrl = '/music/baby-music/manifest.json';
const musicPlayerPlayEventName = 'feei:music-player-play';
const initialGroups = [...siteMusicGroups, ...buildMusicFilterGroups(siteMusicGroups)];

type MusicPlayerPlayDetail = {
  groupId: string;
  trackIndex?: number;
};

function MusicLibraryClient() {
  const [groups, setGroups] = useState<PlaylistGroup[]>(initialGroups);
  const [activeGroupId, setActiveGroupId] = useState(siteMusicGroups[0]?.id ?? '');
  const activeGroup = useMemo(
    () => groups.find((group) => group.id === activeGroupId) ?? groups[0],
    [activeGroupId, groups],
  );

  useEffect(() => {
    let disposed = false;

    async function loadManifest() {
      try {
        const response = await fetch(babyMusicManifestUrl);
        if (!response.ok) return;
        const manifest = (await response.json()) as PlaylistManifestGroup[];
        if (!disposed) {
          const playlistGroups = [...siteMusicGroups, ...manifest.map(playlistGroupFromManifest)];
          setGroups([...playlistGroups, ...buildMusicFilterGroups(playlistGroups)]);
        }
      } catch {}
    }

    void loadManifest();

    return () => {
      disposed = true;
    };
  }, []);

  const playFromGlobalPlayer = (detail: MusicPlayerPlayDetail) => {
    window.dispatchEvent(new CustomEvent<MusicPlayerPlayDetail>(musicPlayerPlayEventName, {detail}));
  };

  if (!activeGroup) return null;

  return (
    <section className={styles.library}>
      <div className={styles.groupTabs} role="tablist" aria-label="音乐歌单分组">
        {groups.map((group) => (
          <button
            key={group.id}
            type="button"
            className={clsx(styles.groupTab, group.id === activeGroup.id && styles.groupTabActive)}
            onClick={() => setActiveGroupId(group.id)}>
            <span>{group.label}</span>
            <span className={styles.groupCount}>{group.tracks.length}</span>
          </button>
        ))}
      </div>

      <div className={styles.groupActionBar}>
        <div>
          <div className={styles.activeGroupTitle}>{activeGroup.label}</div>
          <div className={styles.activeGroupMeta}>{activeGroup.tracks.length} 首</div>
        </div>
        <button
          type="button"
          className={styles.playGroupButton}
          onClick={() => playFromGlobalPlayer({groupId: activeGroup.id, trackIndex: 0})}>
          播放这个歌单
        </button>
      </div>

      <div className={styles.trackList}>
        {activeGroup.tracks.map((track, index) => (
          <button
            key={`${track.url}-${index}`}
            type="button"
            className={styles.trackItem}
            onClick={() => playFromGlobalPlayer({groupId: activeGroup.id, trackIndex: index})}>
            <span className={styles.trackIndex}>{String(index + 1).padStart(2, '0')}</span>
            <span className={styles.trackName}>{track.name}</span>
            <span className={styles.trackArtist}>{track.artist}</span>
          </button>
        ))}
      </div>
    </section>
  );
}

export default function MusicLibrary() {
  return <BrowserOnly fallback={null}>{() => <MusicLibraryClient />}</BrowserOnly>;
}
