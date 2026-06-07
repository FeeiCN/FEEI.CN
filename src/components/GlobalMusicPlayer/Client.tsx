import clsx from 'clsx';
import {useEffect, useRef, useState} from 'react';
import {createRoot} from 'react-dom/client';
import type {Root} from 'react-dom/client';
import type APlayerInstance from 'aplayer';
import type {Options as APlayerOptions} from 'aplayer';
import 'aplayer/dist/APlayer.min.css';
import {buildMusicFilterGroups, playlistGroupFromManifest, siteMusicGroups} from './playlist';
import type {PlaylistGroup, PlaylistManifestGroup} from './playlist';
import styles from './styles.module.css';
import Galaxy from './Galaxy';
import {
  getItsHoverIcon,
  MusicIcon,
} from '@site/src/components/ItsHoverIcon';
import useControlledIconAnimation from '@site/src/components/ItsHoverIcon/useControlledIconAnimation';

type APlayerConstructor = new (options: APlayerOptions) => APlayerInstance;
const babyMusicManifestUrl = '/music/baby-music/manifest.json';
const musicPlayerPlayEventName = 'feei:music-player-play';
const initialMusicGroups = [...siteMusicGroups, ...buildMusicFilterGroups(siteMusicGroups)];
const fullScreenLyricLineHeight = 48;
const playerStateStorageKey = 'feei-global-music-player-state-v1';
const playerVisibleBodyClassName = 'global-music-player-visible';

type StoredGroupPlayback = {
  currentTime?: number;
  trackUrl?: string;
};

type StoredPlayerState = {
  activeGroupId?: string;
  groups?: Record<string, StoredGroupPlayback>;
};

type MusicPlayerPlayDetail = {
  groupId?: string;
  trackIndex?: number;
};

type ExtendedAPlayer = APlayerInstance & {
  audio?: HTMLAudioElement;
  duration?: number;
  list?: {
    index?: number;
    show?: () => void;
    switch?: (index: number) => void;
  };
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
  template?: {
    lrcButton?: HTMLElement;
  };
};

const readStoredPlayerState = (): StoredPlayerState => {
  if (typeof window === 'undefined') return {};
  try {
    const raw = window.localStorage.getItem(playerStateStorageKey);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as StoredPlayerState;
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
};

const writeStoredPlayerState = (state: StoredPlayerState) => {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(playerStateStorageKey, JSON.stringify(state));
  } catch {}
};

const normalizeStoredTime = (time?: number) => {
  if (!Number.isFinite(time) || typeof time !== 'number') return 0;
  return Math.max(0, Math.floor(time));
};

// ─── Module-level singletons ────────────────────────────────────────────────
// These survive React component remounts (happens when navigating between the
// Docusaurus "pages" plugin and the "docs" plugin, which triggers a full
// layout remount). Keeping the APlayer instance and its DOM nodes here means
// music never stops on cross-plugin navigation.
let _shellEl: HTMLDivElement | null = null;
let _mountEl: HTMLDivElement | null = null;
let _player: ExtendedAPlayer | null = null;
let _lastGroupId: string | null = null;
let _wasVisible = false;
let _burstRoot: Root | null = null;

function safeDestroyPlayer(player: ExtendedAPlayer | null) {
  if (!player) return;
  try {
    player.destroy();
  } catch {}
}

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
// ────────────────────────────────────────────────────────────────────────────

function GlobalMusicPlayerClient() {
  const musicIconAnimation = useControlledIconAnimation(true);
  const playerRef = useRef<APlayerInstance | null>(_player);
  const isListOpenRef = useRef(false);
  const shouldKeepListOpenOnNextMountRef = useRef(false);
  const shouldAutoplayOnNextMountRef = useRef(false);
  const requestedTrackIndexRef = useRef<number | undefined>(undefined);
  const groupPanelRef = useRef<HTMLDivElement | null>(null);
  const groupToggleButtonRef = useRef<HTMLButtonElement | null>(null);
  const storedStateRef = useRef<StoredPlayerState>(readStoredPlayerState());
  const [groups, setGroups] = useState<PlaylistGroup[]>(initialMusicGroups);
  const [hasResolvedGroups, setHasResolvedGroups] = useState(false);
  const [activeGroupId, setActiveGroupId] = useState(
    storedStateRef.current.activeGroupId ?? initialMusicGroups[0]?.id ?? '',
  );
  // When reusing an existing player after a cross-plugin navigation (pages ↔ docs),
  // the player is already running — skip the pending/fade-in state entirely.
  const [isReady, setIsReady] = useState(_wasVisible && _player !== null);
  const [isPlayerVisible, setIsPlayerVisible] = useState(_wasVisible);
  const [isListOpen, setIsListOpen] = useState(false);
  const [isGroupPanelOpen, setIsGroupPanelOpen] = useState(false);
  const matchedActiveGroup = groups.find((g) => g.id === activeGroupId);
  const shouldWaitForActiveGroup = !hasResolvedGroups && activeGroupId !== '' && !matchedActiveGroup;
  const activeGroup = matchedActiveGroup ?? (shouldWaitForActiveGroup ? undefined : groups[0]);

  const updateListOpenState = (open: boolean) => {
    isListOpenRef.current = open;
    setIsListOpen(open);
  };

  const persistStoredState = (updater: (current: StoredPlayerState) => StoredPlayerState) => {
    const nextState = updater(storedStateRef.current);
    storedStateRef.current = nextState;
    writeStoredPlayerState(nextState);
  };

  const persistGroupPlayback = (group: PlaylistGroup | undefined, player?: ExtendedAPlayer | null) => {
    if (!group) return;
    const activePlayer = player ?? (playerRef.current as ExtendedAPlayer | null);
    const trackIndex = activePlayer?.list?.index ?? 0;
    const currentTrack = group.tracks[trackIndex] ?? group.tracks[0];
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

  const playRequestedTrack = (group: PlaylistGroup | undefined, trackIndex?: number) => {
    const player = playerRef.current as ExtendedAPlayer | null;
    if (!group || !player) return false;
    const safeTrackIndex =
      typeof trackIndex === 'number' && trackIndex >= 0 && trackIndex < group.tracks.length ? trackIndex : 0;
    try {
      player.list?.switch?.(safeTrackIndex);
      player.play?.();
      void player.audio?.play?.().catch(() => {});
      persistGroupPlayback(group, player);
      return true;
    } catch {
      return false;
    }
  };

  useEffect(() => {
    if (!activeGroupId) return;
    persistStoredState((current) => ({...current, activeGroupId}));
  }, [activeGroupId]);

  // Sync shell visibility and body padding class with React state
  useEffect(() => {
    const {shell} = ensurePlayerDOM();
    shell.style.display = isPlayerVisible ? '' : 'none';
    document.body.classList.toggle(playerVisibleBodyClassName, isPlayerVisible);
  }, [isPlayerVisible]);

  // Toggle the pending (fade-in) class imperatively on the shell element
  useEffect(() => {
    if (!_shellEl) return;
    _shellEl.classList.toggle(styles.musicPlayerShellPending, !isReady);
  }, [isReady]);

  useEffect(() => {
    if (!isGroupPanelOpen) return;
    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target as Node | null;
      if (!target) return;
      if (groupPanelRef.current?.contains(target) || groupToggleButtonRef.current?.contains(target)) return;
      setIsGroupPanelOpen(false);
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setIsGroupPanelOpen(false);
    };
    document.addEventListener('pointerdown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [isGroupPanelOpen]);

  useEffect(() => {
    let disposed = false;
    async function loadBabyMusicGroups() {
      try {
        const response = await fetch(babyMusicManifestUrl);
        if (!response.ok) return;
        const manifest = (await response.json()) as PlaylistManifestGroup[];
        if (disposed || manifest.length === 0) return;
        const playlistGroups = [...siteMusicGroups, ...manifest.map(playlistGroupFromManifest)];
        setGroups([...playlistGroups, ...buildMusicFilterGroups(playlistGroups)]);
      } catch {
      } finally {
        if (!disposed) setHasResolvedGroups(true);
      }
    }
    void loadBabyMusicGroups();
    return () => { disposed = true; };
  }, []);

  useEffect(() => {
    if (!hasResolvedGroups) return;
    if (!matchedActiveGroup && groups[0]) setActiveGroupId(groups[0].id);
  }, [groups, hasResolvedGroups, matchedActiveGroup]);

  useEffect(() => {
    const handleMusicPlayerPlay = (event: Event) => {
      const detail = (event as CustomEvent<MusicPlayerPlayDetail>).detail;
      const requestedGroup = groups.find((group) => group.id === detail?.groupId) ?? groups[0];
      if (!requestedGroup) return;
      requestedTrackIndexRef.current = detail?.trackIndex;
      shouldAutoplayOnNextMountRef.current = true;
      shouldKeepListOpenOnNextMountRef.current = true;
      setIsGroupPanelOpen(false);
      setIsPlayerVisible(true);
      if (requestedGroup.id === activeGroup?.id && _player) {
        playRequestedTrack(requestedGroup, detail?.trackIndex);
        return;
      }
      setActiveGroupId(requestedGroup.id);
    };

    window.addEventListener(musicPlayerPlayEventName, handleMusicPlayerPlay);
    return () => window.removeEventListener(musicPlayerPlayEventName, handleMusicPlayerPlay);
  }, [activeGroup?.id, groups]);

  useEffect(() => {
    let disposed = false;
    const shouldAutoplay = shouldAutoplayOnNextMountRef.current;
    const shouldRestoreListOpen =
      isPlayerVisible && (shouldKeepListOpenOnNextMountRef.current || isListOpen || isListOpenRef.current);
    shouldAutoplayOnNextMountRef.current = false;
    shouldKeepListOpenOnNextMountRef.current = false;

    if (!isPlayerVisible || !activeGroup) {
      setIsReady(false);
      updateListOpenState(false);
      return;
    }

    const currentGroup = activeGroup;

    async function mountPlayer() {
      const {mount} = ensurePlayerDOM();

      // Reuse existing player when navigating back (same group, already running)
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

        if (_player) {
          _burstRoot?.unmount();
          _burstRoot = null;
          safeDestroyPlayer(_player);
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
          listFolded: !shouldRestoreListOpen,
          listMaxHeight: '14rem',
          lrcType: 3,
          theme: '#205d3b',
        });

        _player = playerRef.current as ExtendedAPlayer;
        _lastGroupId = currentGroup.id;

        const lrcEl = mount.querySelector('.aplayer-lrc') as HTMLElement | null;
        if (lrcEl) {
          const burstContainer = document.createElement('div');
          lrcEl.insertBefore(burstContainer, lrcEl.firstChild);
          _burstRoot = createRoot(burstContainer);
          _burstRoot.render(<Galaxy density={1} glowIntensity={0.3} twinkleIntensity={0.3} rotationSpeed={0.1} hueShift={140} saturation={0.4} />);
        }

        const player = playerRef.current as ExtendedAPlayer;
        const savedGroupPlayback = storedStateRef.current.groups?.[currentGroup.id];
        const savedTrackIndex = savedGroupPlayback?.trackUrl
          ? currentGroup.tracks.findIndex((t) => t.url === savedGroupPlayback.trackUrl)
          : -1;
        const requestedTrackIndex = requestedTrackIndexRef.current;
        requestedTrackIndexRef.current = undefined;
        const restoreTrackIndex =
          typeof requestedTrackIndex === 'number' && requestedTrackIndex >= 0 && requestedTrackIndex < currentGroup.tracks.length
            ? requestedTrackIndex
            : savedTrackIndex >= 0 ? savedTrackIndex : 0;
        const restoreCurrentTime = normalizeStoredTime(savedGroupPlayback?.currentTime);
        let lastSavedPlaybackSecond = -1;
        let hasRestoredProgress = restoreCurrentTime === 0;

        if (player.lrc?.update) {
          player.lrc.update = (time = player.audio?.currentTime ?? 0) => {
            const lyricState = player.lrc;
            const currentLyrics = lyricState?.current ?? [];
            const lyricContainer = lyricState?.container;
            if (!lyricState || !lyricContainer || currentLyrics.length === 0) return;
            if (
              lyricState.index > currentLyrics.length - 1 ||
              time < currentLyrics[lyricState.index]?.[0] ||
              !currentLyrics[lyricState.index + 1] ||
              time >= currentLyrics[lyricState.index + 1][0]
            ) {
              for (let i = 0; i < currentLyrics.length; i++) {
                if (time >= currentLyrics[i][0] && (!currentLyrics[i + 1] || time < currentLyrics[i + 1][0])) {
                  lyricState.index = i;
                  lyricContainer.style.transform = `translateY(${fullScreenLyricLineHeight * -i}px)`;
                  lyricContainer.style.webkitTransform = `translateY(${fullScreenLyricLineHeight * -i}px)`;
                  lyricContainer.querySelector('.aplayer-lrc-current')?.classList.remove('aplayer-lrc-current');
                  lyricContainer.getElementsByTagName('p').item(i)?.classList.add('aplayer-lrc-current');
                  break;
                }
              }
            }
          };
          player.lrc.hide?.();
          player.lrc.update(0);
        }

        player.template?.lrcButton?.classList.add('aplayer-icon-lrc-inactivity');

        const restorePlaybackProgress = () => {
          if (hasRestoredProgress || !player.seek || !player.audio) return;
          const duration = player.duration ?? player.audio.duration;
          if (!Number.isFinite(duration) || !duration || duration <= 0) return;
          player.seek(Math.min(restoreCurrentTime, Math.max(duration - 1, 0)));
          hasRestoredProgress = true;
        };

        if (restoreTrackIndex > 0) {
          try {
            player.list?.switch?.(restoreTrackIndex);
          } catch {}
        }
        restorePlaybackProgress();

        let hasAttemptedAutoplay = false;
        const attemptAutoplay = () => {
          if (!shouldAutoplay || hasAttemptedAutoplay) return;
          hasAttemptedAutoplay = true;
          try {
            player.play?.();
          } catch {}
          void player.audio?.play?.().catch(() => {});
        };

        player.on?.('loadedmetadata', restorePlaybackProgress);
        player.on?.('canplay', restorePlaybackProgress);
        player.on?.('canplay', attemptAutoplay);
        player.on?.('listswitch', () => {
          lastSavedPlaybackSecond = -1;
          persistGroupPlayback(currentGroup, player);
          const lyricState = player.lrc;
          const lyricContainer = lyricState?.container;
          if (lyricState && lyricContainer) {
            lyricState.index = 0;
            lyricContainer.style.transform = 'translateY(0)';
            lyricContainer.style.webkitTransform = 'translateY(0)';
            lyricContainer.querySelector('.aplayer-lrc-current')?.classList.remove('aplayer-lrc-current');
            lyricContainer.getElementsByTagName('p').item(0)?.classList.add('aplayer-lrc-current');
          }
        });
        player.on?.('play', () => persistGroupPlayback(currentGroup, player));
        player.on?.('pause', () => persistGroupPlayback(currentGroup, player));
        player.on?.('seeked', () => persistGroupPlayback(currentGroup, player));
        player.on?.('ended', () => persistGroupPlayback(currentGroup, player));
        player.on?.('timeupdate', () => {
          const s = normalizeStoredTime(player.audio?.currentTime);
          if (s === lastSavedPlaybackSecond || s === 0 || s % 5 !== 0) return;
          lastSavedPlaybackSecond = s;
          persistGroupPlayback(currentGroup, player);
        });

        const listElement = mount.querySelector('.aplayer-list');
        if (shouldRestoreListOpen) listElement?.classList.remove('aplayer-list-hide');
        updateListOpenState(
          shouldRestoreListOpen || (listElement ? !listElement.classList.contains('aplayer-list-hide') : false),
        );
        player.on?.('listshow', () => updateListOpenState(true));
        player.on?.('listhide', () => updateListOpenState(false));

        if (shouldRestoreListOpen) {
          window.requestAnimationFrame(() => {
            listElement?.classList.remove('aplayer-list-hide');
            try {
              player.list?.show?.();
            } catch {}
          });
          try {
            player.list?.show?.();
          } catch {}
        }

        if (shouldAutoplay) window.requestAnimationFrame(attemptAutoplay);

        const handlePageHide = () => persistGroupPlayback(currentGroup, player);
        window.addEventListener('pagehide', handlePageHide);

        setIsReady(true);

        return () => { window.removeEventListener('pagehide', handlePageHide); };
      } catch (error) {
        console.error('Failed to initialize global music player.', error);
      }
    }

    let cleanupMount: (() => void) | undefined;
    void mountPlayer().then((cleanup) => {
      if (disposed) { cleanup?.(); return; }
      cleanupMount = cleanup;
    });

    return () => {
      disposed = true;
      // Save visibility so the next mount can restore it
      _wasVisible = isPlayerVisible;
      persistGroupPlayback(currentGroup, playerRef.current as ExtendedAPlayer | null);
      cleanupMount?.();
      // Do NOT destroy the player — keep it alive across layout remounts
    };
  }, [activeGroup, isPlayerVisible]);

  if (!activeGroup) return null;

  const handleGroupSelect = (groupId: string) => {
    shouldKeepListOpenOnNextMountRef.current = isPlayerVisible && (isListOpen || isListOpenRef.current);
    setIsGroupPanelOpen(false);
    if (isPlayerVisible && groupId === activeGroup.id) {
      const p = playerRef.current as ExtendedAPlayer | null;
      p?.play?.();
      void p?.audio?.play?.().catch(() => {});
      return;
    }
    shouldAutoplayOnNextMountRef.current = true;
    setActiveGroupId(groupId);
    setIsPlayerVisible(true);
  };

  const groupSwitcher =
    groups.length > 1 ? (
      <div className={styles.musicGroupNavbarItem}>
        <button
          ref={groupToggleButtonRef}
          type="button"
          className={clsx(
            'clean-btn',
            styles.musicGroupActionButton,
            styles.musicGroupToggleButton,
            isGroupPanelOpen && styles.musicGroupToggleButtonActive,
          )}
          aria-label="切换音乐歌单分组"
          aria-expanded={isGroupPanelOpen}
          aria-controls="global-music-group-panel"
          onMouseEnter={musicIconAnimation.onMouseEnter}
          onMouseLeave={musicIconAnimation.onMouseLeave}
          onClick={(event) => {
            event.stopPropagation();
            setIsGroupPanelOpen((open) => !open);
          }}>
          <MusicIcon
            ref={musicIconAnimation.iconRef}
            size={24}
            strokeWidth={2}
            disableHover={musicIconAnimation.disableHover}
            className={styles.musicGroupToggleIcon}
          />
        </button>
        <div
          id="global-music-group-panel"
          ref={groupPanelRef}
          className={clsx(styles.musicGroupPanel, isGroupPanelOpen && styles.musicGroupPanelOpen)}
          role="dialog"
          aria-label="音乐歌单分组">
          <div className={styles.musicGroupPanelTitle}>歌单分类</div>
          <div className={styles.musicGroupPanelList} role="tablist" aria-label="音乐歌单分组">
            {groups.map((group) => (
              <button
                key={group.id}
                type="button"
                role="tab"
                aria-selected={group.id === activeGroup.id}
                className={clsx(
                  styles.musicGroupPanelItem,
                  group.id === activeGroup.id && styles.musicGroupPanelItemActive,
                )}
                onClick={(event) => {
                  event.stopPropagation();
                  handleGroupSelect(group.id);
                }}>
                <span className={styles.musicGroupPanelItemLabel}>{group.label}</span>
                <span className={styles.musicGroupPanelItemCount}>{group.tracks.length}</span>
              </button>
            ))}
          </div>
        </div>
      </div>
    ) : null;

  return <>{groupSwitcher}</>;
}

export default GlobalMusicPlayerClient;
