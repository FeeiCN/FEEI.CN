import {useEffect, useRef, useState} from 'react';
import {createRoot} from 'react-dom/client';
import type {Root} from 'react-dom/client';
import type APlayerInstance from 'aplayer';
import type {Options as APlayerOptions} from 'aplayer';
import 'aplayer/dist/APlayer.min.css';
import {buildAllDerivedGroups, playlistGroupFromManifest, siteMusicGroups} from './playlist';
import type {PlaylistGroup, PlaylistManifestGroup} from './playlist';
import styles from './styles.module.css';
import controlStyles from './controls.module.css';
import Galaxy from './Galaxy';
import Controls from './Controls';
import {
  dispatchMusicPlayerOpen,
  dispatchMusicPlayerState,
  musicPlayerCloseEventName,
  musicPlayerErrorEventName,
  musicPlayerOpenEventName,
  musicPlayerPlayEventName,
  musicPlayerStateRequestEventName,
} from './playerEvents';
import type {MusicPlayerPlayDetail} from './playerEvents';

type APlayerConstructor = new (options: APlayerOptions) => APlayerInstance;
const babyMusicManifestUrl = '/music/baby-music/manifest.json';
const initialMusicGroups = [...siteMusicGroups, ...buildAllDerivedGroups(siteMusicGroups)];
const fullScreenLyricLineHeight = 48;
const playerStateStorageKey = 'feei-global-music-player-state-v1';
const playerVisibleBodyClassName = 'global-music-player-visible';

type StoredGroupPlayback = {currentTime?: number; trackUrl?: string};
type StoredPlayerState = {activeGroupId?: string; groups?: Record<string, StoredGroupPlayback>};
type ExtendedAPlayer = APlayerInstance & {
  audio?: HTMLAudioElement;
  duration?: number;
  list?: {index?: number; hide?: () => void; switch?: (index: number) => void};
  lrc?: {
    index: number;
    current: Array<[number, string]>;
    container: HTMLElement;
    hide?: () => void;
    update?: (time?: number) => void;
  };
  on?: (name: string, callback: () => void) => void;
  play?: () => void;
  seek?: (time: number) => void;
  template?: {lrcButton?: HTMLElement};
};

const readStoredPlayerState = (): StoredPlayerState => {
  if (typeof window === 'undefined') return {};
  try {
    const parsed = JSON.parse(window.localStorage.getItem(playerStateStorageKey) ?? '{}');
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
};

const writeStoredPlayerState = (state: StoredPlayerState) => {
  try {
    window.localStorage.setItem(playerStateStorageKey, JSON.stringify(state));
  } catch {}
};

const normalizeStoredTime = (time?: number) => (
  typeof time === 'number' && Number.isFinite(time) ? Math.max(0, Math.floor(time)) : 0
);

// The audio element and its DOM survive pages/docs layout remounts.
let _shellEl: HTMLDivElement | null = null;
let _mountEl: HTMLDivElement | null = null;
let _player: ExtendedAPlayer | null = null;
let _lastGroupId: string | null = null;
let _wasVisible = false;
let _burstRoot: Root | null = null;

function ensurePlayerDOM(): {shell: HTMLDivElement; mount: HTMLDivElement} {
  if (!_shellEl) {
    _shellEl = document.createElement('div');
    _shellEl.className = styles.musicPlayerShell;
    _shellEl.style.display = 'none';
    document.body.appendChild(_shellEl);
    _mountEl = document.createElement('div');
    _mountEl.className = styles.musicPlayerMount;
    _mountEl.setAttribute('aria-label', '站点音乐播放器');
    _shellEl.appendChild(_mountEl);
  }
  return {shell: _shellEl, mount: _mountEl!};
}

function reportPlaybackError(message: string) {
  window.dispatchEvent(new CustomEvent(musicPlayerErrorEventName, {detail: message}));
}

function startPlayback(player: ExtendedAPlayer) {
  if (player.audio) {
    void player.audio.play().catch(() => {
      reportPlaybackError('暂时无法播放，请点击播放器的播放按钮重试。');
    });
  } else {
    player.play?.();
  }
}

function collapseLyricOverlay(player: ExtendedAPlayer | null) {
  player?.lrc?.hide?.();
  player?.template?.lrcButton?.classList.add('aplayer-icon-lrc-inactivity');
}

export default function GlobalMusicPlayerClient() {
  const playerRef = useRef<APlayerInstance | null>(_player);
  const shouldAutoplayOnNextMountRef = useRef(false);
  const requestedTrackIndexRef = useRef<number | undefined>(undefined);
  const pendingRequestRef = useRef<MusicPlayerPlayDetail | null>(null);
  const storedStateRef = useRef<StoredPlayerState>(readStoredPlayerState());
  const [groups, setGroups] = useState<PlaylistGroup[]>(initialMusicGroups);
  const [hasResolvedGroups, setHasResolvedGroups] = useState(false);
  const [activeGroupId, setActiveGroupId] = useState(
    storedStateRef.current.activeGroupId ?? initialMusicGroups[0]?.id ?? '',
  );
  const [isReady, setIsReady] = useState(_wasVisible && _player !== null);
  const [isPlayerVisible, setIsPlayerVisible] = useState(_wasVisible);
  const matchedActiveGroup = groups.find((group) => group.id === activeGroupId);
  const shouldWaitForActiveGroup = !hasResolvedGroups && activeGroupId !== '' && !matchedActiveGroup;
  const activeGroup = matchedActiveGroup ?? (shouldWaitForActiveGroup ? undefined : groups[0]);

  const persistStoredState = (updater: (current: StoredPlayerState) => StoredPlayerState) => {
    const nextState = updater(storedStateRef.current);
    storedStateRef.current = nextState;
    writeStoredPlayerState(nextState);
  };

  const persistGroupPlayback = (group: PlaylistGroup | undefined, player?: ExtendedAPlayer | null) => {
    if (!group) return;
    const activePlayer = player ?? (playerRef.current as ExtendedAPlayer | null);
    const currentTrack = group.tracks[activePlayer?.list?.index ?? 0];
    if (!currentTrack) return;
    persistStoredState((current) => ({
      ...current,
      groups: {
        ...current.groups,
        [group.id]: {
          trackUrl: currentTrack.url,
          currentTime: normalizeStoredTime(activePlayer?.audio?.currentTime),
        },
      },
    }));
  };

  const playRequestedTrack = (group: PlaylistGroup, trackIndex?: number) => {
    const player = playerRef.current as ExtendedAPlayer | null;
    if (!player) return;
    const index = typeof trackIndex === 'number' && Number.isInteger(trackIndex)
      && trackIndex >= 0 && trackIndex < group.tracks.length ? trackIndex : 0;
    try {
      player.list?.switch?.(index);
      collapseLyricOverlay(player);
      startPlayback(player);
      persistGroupPlayback(group, player);
      dispatchMusicPlayerState({groupId: group.id, trackIndex: index});
    } catch {
      reportPlaybackError('切换歌曲失败，请重试。');
    }
  };

  useEffect(() => {
    if (activeGroupId) persistStoredState((current) => ({...current, activeGroupId}));
  }, [activeGroupId]);

  useEffect(() => {
    const {shell} = ensurePlayerDOM();
    _wasVisible = isPlayerVisible;
    shell.style.display = isPlayerVisible ? '' : 'none';
    document.body.classList.toggle(playerVisibleBodyClassName, isPlayerVisible);
  }, [isPlayerVisible]);

  useEffect(() => {
    _shellEl?.classList.toggle(styles.musicPlayerShellPending, !isReady);
  }, [isReady]);

  useEffect(() => {
    let disposed = false;
    async function loadBabyMusicGroups() {
      try {
        const response = await fetch(babyMusicManifestUrl);
        if (!response.ok) return;
        const manifest = (await response.json()) as PlaylistManifestGroup[];
        if (disposed || !Array.isArray(manifest) || manifest.length === 0) return;
        const playlistGroups = [...siteMusicGroups, ...manifest.map(playlistGroupFromManifest)];
        setGroups([...playlistGroups, ...buildAllDerivedGroups(playlistGroups)]);
      } catch {
      } finally {
        if (!disposed) setHasResolvedGroups(true);
      }
    }
    void loadBabyMusicGroups();
    return () => { disposed = true; };
  }, []);

  useEffect(() => {
    if (hasResolvedGroups && !matchedActiveGroup && groups[0]) setActiveGroupId(groups[0].id);
  }, [groups, hasResolvedGroups, matchedActiveGroup]);

  useEffect(() => {
    const handlePlay = (event: Event) => {
      const detail = (event as CustomEvent<MusicPlayerPlayDetail>).detail;
      const requestedGroup = groups.find((group) => group.id === detail?.groupId);
      if (!requestedGroup) {
        if (!hasResolvedGroups) pendingRequestRef.current = detail;
        else reportPlaybackError('未找到这个歌单，请重新选择。');
        return;
      }
      if (!requestedGroup.tracks.length) return;
      reportPlaybackError('');
      setIsPlayerVisible(true);
      if (requestedGroup.id === activeGroup?.id && _player && _lastGroupId === requestedGroup.id) {
        requestedTrackIndexRef.current = undefined;
        shouldAutoplayOnNextMountRef.current = false;
        playRequestedTrack(requestedGroup, detail.trackIndex);
        return;
      }
      requestedTrackIndexRef.current = detail.trackIndex;
      shouldAutoplayOnNextMountRef.current = true;
      setActiveGroupId(requestedGroup.id);
    };
    const handleOpen = () => setIsPlayerVisible(true);
    const handleClose = () => {
      pendingRequestRef.current = null;
      requestedTrackIndexRef.current = undefined;
      shouldAutoplayOnNextMountRef.current = false;
      const player = playerRef.current as ExtendedAPlayer | null;
      player?.audio?.pause();
      collapseLyricOverlay(player);
      persistGroupPlayback(activeGroup, player);
      setIsPlayerVisible(false);
      _wasVisible = false;
    };
    const reportState = () => {
      if (_player && _lastGroupId) {
        dispatchMusicPlayerState({groupId: _lastGroupId, trackIndex: _player.list?.index ?? 0});
      }
    };
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') collapseLyricOverlay(playerRef.current as ExtendedAPlayer | null);
    };
    window.addEventListener(musicPlayerPlayEventName, handlePlay);
    window.addEventListener(musicPlayerOpenEventName, handleOpen);
    window.addEventListener(musicPlayerCloseEventName, handleClose);
    window.addEventListener(musicPlayerStateRequestEventName, reportState);
    window.addEventListener('keydown', handleEscape);
    if (hasResolvedGroups && pendingRequestRef.current) {
      const detail = pendingRequestRef.current;
      pendingRequestRef.current = null;
      handlePlay(new CustomEvent(musicPlayerPlayEventName, {detail}));
    }
    return () => {
      window.removeEventListener(musicPlayerPlayEventName, handlePlay);
      window.removeEventListener(musicPlayerOpenEventName, handleOpen);
      window.removeEventListener(musicPlayerCloseEventName, handleClose);
      window.removeEventListener(musicPlayerStateRequestEventName, reportState);
      window.removeEventListener('keydown', handleEscape);
    };
  }, [activeGroup, groups, hasResolvedGroups]);

  useEffect(() => {
    const handlePageHide = () => persistGroupPlayback(activeGroup);
    window.addEventListener('pagehide', handlePageHide);
    return () => window.removeEventListener('pagehide', handlePageHide);
  }, [activeGroup]);

  useEffect(() => {
    let disposed = false;
    const shouldAutoplay = shouldAutoplayOnNextMountRef.current;
    shouldAutoplayOnNextMountRef.current = false;
    if (!isPlayerVisible || !activeGroup) {
      setIsReady(false);
      return;
    }
    const currentGroup = activeGroup;

    async function mountPlayer() {
      const {mount} = ensurePlayerDOM();
      if (_player && _lastGroupId === currentGroup.id) {
        playerRef.current = _player;
        const requestedTrackIndex = requestedTrackIndexRef.current;
        requestedTrackIndexRef.current = undefined;
        if (shouldAutoplay || typeof requestedTrackIndex === 'number') {
          playRequestedTrack(currentGroup, requestedTrackIndex);
        }
        setIsReady(true);
        return;
      }
      try {
        const module = (await import('aplayer')) as unknown as {default?: APlayerConstructor};
        const APlayer = module.default ?? (module as unknown as APlayerConstructor);
        if (disposed) return;
        const playAfterLoad = shouldAutoplay || shouldAutoplayOnNextMountRef.current;
        shouldAutoplayOnNextMountRef.current = false;
        if (_player) {
          _burstRoot?.unmount();
          _burstRoot = null;
          try { _player.destroy(); } catch {}
          _player = null;
          mount.innerHTML = '';
        }
        playerRef.current = new APlayer({
          container: mount,
          fixed: true,
          audio: currentGroup.tracks,
          autoplay: false,
          loop: 'all',
          order: 'list',
          preload: 'metadata',
          volume: 0.45,
          mutex: false,
          listFolded: true,
          listMaxHeight: '14rem',
          lrcType: 3,
          theme: '#205d3b',
        });
        _player = playerRef.current as ExtendedAPlayer;
        _lastGroupId = currentGroup.id;
        const player = _player;
        mount.querySelector('.aplayer')?.classList.remove('aplayer-narrow');
        const lrcEl = mount.querySelector('.aplayer-lrc') as HTMLElement | null;
        if (lrcEl) {
          const burstContainer = document.createElement('div');
          lrcEl.insertBefore(burstContainer, lrcEl.firstChild);
          _burstRoot = createRoot(burstContainer);
          _burstRoot.render(<Galaxy density={1} glowIntensity={0.3} twinkleIntensity={0.3} rotationSpeed={0.1} hueShift={140} saturation={0.4} />);
          const closeButton = document.createElement('button');
          closeButton.type = 'button';
          closeButton.className = controlStyles.lyricCloseButton;
          closeButton.setAttribute('aria-label', '关闭全屏歌词');
          closeButton.textContent = '关闭歌词';
          closeButton.addEventListener('click', () => collapseLyricOverlay(player));
          lrcEl.appendChild(closeButton);
        }
        const saved = storedStateRef.current.groups?.[currentGroup.id];
        const requested = requestedTrackIndexRef.current;
        requestedTrackIndexRef.current = undefined;
        const savedIndex = saved?.trackUrl ? currentGroup.tracks.findIndex((track) => track.url === saved.trackUrl) : -1;
        const hasRequestedTrack = typeof requested === 'number' && Number.isInteger(requested)
          && requested >= 0 && requested < currentGroup.tracks.length;
        const restoreTrackIndex = hasRequestedTrack ? requested : Math.max(0, savedIndex);
        const restoreCurrentTime = hasRequestedTrack || savedIndex < 0 ? 0 : normalizeStoredTime(saved?.currentTime);
        let hasRestoredProgress = restoreCurrentTime === 0;
        let lastSavedPlaybackSecond = -1;

        if (player.lrc?.update) {
          player.lrc.update = (time = player.audio?.currentTime ?? 0) => {
            const lyricState = player.lrc;
            const lyrics = lyricState?.current ?? [];
            const container = lyricState?.container;
            if (!lyricState || !container || !lyrics.length) return;
            if (lyricState.index > lyrics.length - 1 || time < lyrics[lyricState.index]?.[0]
              || !lyrics[lyricState.index + 1] || time >= lyrics[lyricState.index + 1][0]) {
              for (let index = 0; index < lyrics.length; index++) {
                if (time >= lyrics[index][0] && (!lyrics[index + 1] || time < lyrics[index + 1][0])) {
                  lyricState.index = index;
                  container.style.transform = `translateY(${fullScreenLyricLineHeight * -index}px)`;
                  container.style.webkitTransform = container.style.transform;
                  container.querySelector('.aplayer-lrc-current')?.classList.remove('aplayer-lrc-current');
                  container.getElementsByTagName('p').item(index)?.classList.add('aplayer-lrc-current');
                  break;
                }
              }
            }
          };
        }
        collapseLyricOverlay(player);
        const restoreProgress = () => {
          if (hasRestoredProgress || !player.seek || !player.audio) return;
          const duration = player.duration ?? player.audio.duration;
          if (!Number.isFinite(duration) || !duration || duration <= 0) return;
          player.seek(Math.min(restoreCurrentTime, Math.max(duration - 1, 0)));
          hasRestoredProgress = true;
        };
        if (restoreTrackIndex > 0) player.list?.switch?.(restoreTrackIndex);
        dispatchMusicPlayerState({groupId: currentGroup.id, trackIndex: restoreTrackIndex});
        restoreProgress();
        player.on?.('loadedmetadata', restoreProgress);
        player.on?.('canplay', restoreProgress);
        player.on?.('listswitch', () => {
          hasRestoredProgress = true;
          lastSavedPlaybackSecond = -1;
          persistGroupPlayback(currentGroup, player);
          const lyricState = player.lrc;
          if (lyricState?.container) {
            lyricState.index = 0;
            lyricState.container.style.transform = 'translateY(0)';
            lyricState.container.style.webkitTransform = 'translateY(0)';
          }
          dispatchMusicPlayerState({groupId: currentGroup.id, trackIndex: player.list?.index ?? 0});
        });
        for (const event of ['play', 'pause', 'seeked', 'ended']) {
          player.on?.(event, () => persistGroupPlayback(currentGroup, player));
        }
        player.on?.('play', () => reportPlaybackError(''));
        player.on?.('error', () => reportPlaybackError('音频加载失败，请尝试另一首歌。'));
        player.on?.('timeupdate', () => {
          const second = normalizeStoredTime(player.audio?.currentTime);
          if (second === lastSavedPlaybackSecond || second === 0 || second % 5 !== 0) return;
          lastSavedPlaybackSecond = second;
          persistGroupPlayback(currentGroup, player);
        });
        player.on?.('listshow', () => {
          player.list?.hide?.();
          dispatchMusicPlayerOpen();
        });
        if (playAfterLoad) startPlayback(player);
        setIsReady(true);
      } catch (error) {
        console.error('Failed to initialize global music player.', error);
        reportPlaybackError('播放器加载失败，请收起后重新打开。');
      }
    }
    void mountPlayer();
    return () => {
      disposed = true;
      persistGroupPlayback(currentGroup, playerRef.current as ExtendedAPlayer | null);
    };
  }, [activeGroup, isPlayerVisible]);

  return <Controls />;
}
