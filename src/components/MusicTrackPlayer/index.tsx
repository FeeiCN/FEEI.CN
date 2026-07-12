import {useMemo} from 'react';
import {getItsHoverIcon} from '@site/src/components/ItsHoverIcon';
import {dispatchMusicPlayerPlay} from '@site/src/components/GlobalMusicPlayer/playerEvents';
import {siteMusicGroups} from '@site/src/components/GlobalMusicPlayer/playlist';
import styles from './styles.module.css';

type MusicTrackPlayerProps = {
  name: string;
  artist?: string;
  groupId?: string;
  context?: string;
};

const PlayIcon = getItsHoverIcon('play-icon');

export default function MusicTrackPlayer({
  name,
  artist,
  groupId = 'favorites',
  context,
}: MusicTrackPlayerProps) {
  const trackLocation = useMemo(() => {
    const group = siteMusicGroups.find((candidate) => candidate.id === groupId);
    const trackIndex = group?.tracks.findIndex(
      (track) => track.name === name && (!artist || track.artist === artist),
    ) ?? -1;
    const track = group?.tracks[trackIndex];
    return group && track && trackIndex >= 0 ? {group, track, trackIndex} : null;
  }, [artist, groupId, name]);

  if (!trackLocation) return null;

  return (
    <div className={styles.player}>
      <button
        type="button"
        className={styles.playButton}
        aria-label={`播放《${name}》`}
        title={`播放《${name}》`}
        onClick={() => {
          dispatchMusicPlayerPlay({
            groupId: trackLocation.group.id,
            trackIndex: trackLocation.trackIndex,
            showList: false,
          });
        }}>
        {PlayIcon ? <PlayIcon size={16} strokeWidth={1.8} /> : <span aria-hidden="true">▶</span>}
      </button>
      <div className={styles.metadata}>
        <div className={styles.trackName}>{name}</div>
        <div className={styles.artist}>{trackLocation.track.artist}</div>
        {context ? <div className={styles.context}>{context}</div> : null}
      </div>
    </div>
  );
}
