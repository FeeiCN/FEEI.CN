import {useEffect, useState} from 'react';
import {Portal, Tooltip} from '@chakra-ui/react';
import {MusicIcon} from '@site/src/components/ItsHoverIcon';
import useControlledIconAnimation from '@site/src/components/ItsHoverIcon/useControlledIconAnimation';
import {
  dispatchMusicPlayerOpen,
  musicPlayerStateEventName,
  musicPlayerPanelStateEventName,
  musicPlayerStateRequestEventName,
} from './playerEvents';
import type {MusicPlayerStateDetail} from './playerEvents';
import styles from './navbarButton.module.css';
import {playbackStatus} from './playbackStatus';

export default function MusicButton() {
  const [playback, setPlayback] = useState<MusicPlayerStateDetail | null>(null);
  const [expanded, setExpanded] = useState(false);
  const iconAnimation = useControlledIconAnimation();

  useEffect(() => {
    const onState = (event: Event) => {
      const {groupId, trackIndex, title, artist, paused, loading, error} = (event as CustomEvent<MusicPlayerStateDetail>).detail;
      const next = {groupId, trackIndex, title, artist, paused, loading, error};
      setPlayback((current) => JSON.stringify(current) === JSON.stringify(next) ? current : next);
    };
    window.addEventListener(musicPlayerStateEventName, onState);
    const onPanelState = (event: Event) => setExpanded((event as CustomEvent<boolean>).detail);
    window.addEventListener(musicPlayerPanelStateEventName, onPanelState);
    window.dispatchEvent(new CustomEvent(musicPlayerStateRequestEventName));
    return () => {
      window.removeEventListener(musicPlayerStateEventName, onState);
      window.removeEventListener(musicPlayerPanelStateEventName, onPanelState);
    };
  }, []);

  const status = playbackStatus(playback);
  const playing = playback?.paused === false;
  const description = playback?.title ? `${status.label} · ${playback.title}${playback.artist ? ` — ${playback.artist}` : ''}` : '音乐';

  return <Tooltip.Root openDelay={250} positioning={{placement: 'bottom'}}>
    <Tooltip.Trigger asChild>
      <button type="button" className={styles.button} aria-label="音乐" aria-haspopup="dialog"
        aria-expanded={expanded} aria-controls={expanded ? 'music-player-panel' : undefined}
        data-music-trigger data-playing={playing || undefined}
        data-playback-state={status.kind}
        onMouseEnter={iconAnimation.onMouseEnter} onMouseLeave={iconAnimation.onMouseLeave}
        onClick={() => dispatchMusicPlayerOpen({view: 'library', toggle: true})}>
        <MusicIcon ref={iconAnimation.iconRef} size={24} strokeWidth={1.6} disableHover />
        {(playing || status.kind === 'error') && <span className={styles.playing} data-state={status.kind} aria-label={status.label} />}
      </button>
    </Tooltip.Trigger>
    <Portal><Tooltip.Positioner><Tooltip.Content className={styles.tooltip}>
      {description}
    </Tooltip.Content></Tooltip.Positioner></Portal>
  </Tooltip.Root>;
}
