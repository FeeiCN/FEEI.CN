import BrowserOnly from '@docusaurus/BrowserOnly';
import clsx from 'clsx';
import {Popover, Portal} from '@chakra-ui/react';
import {useCallback, useEffect, useMemo, useRef, useState} from 'react';
import type {Audio} from 'aplayer';
import ArrowDownIcon from '@site/src/components/ItsHoverIcon/icons/arrow-narrow-down-icon';
import MagnifierIcon from '@site/src/components/ItsHoverIcon/icons/magnifier-icon';
import PlayerIcon from '@site/src/components/ItsHoverIcon/icons/player-icon';
import XIcon from '@site/src/components/ItsHoverIcon/icons/x-icon';
import {
  buildArtistGroups,
  babyMusicManifestUrl,
  buildFilterGroups,
  playlistGroupFromManifest,
  primaryArtistOf,
  siteMusicGroups,
} from '@site/src/components/GlobalMusicPlayer/playlist';
import type {
  PlaylistGroup,
  PlaylistManifestGroup,
} from '@site/src/components/GlobalMusicPlayer/playlist';
import {
  dispatchMusicPlayerPlay,
  musicPlayerStateEventName,
  musicPlayerStateRequestEventName,
} from '@site/src/components/GlobalMusicPlayer/playerEvents';
import type {
  MusicPlayerPlayDetail,
  MusicPlayerStateDetail,
} from '@site/src/components/GlobalMusicPlayer/playerEvents';
import styles from './styles.module.css';
import {readLibrarySession, saveLibrarySession} from './session';

type TrackLocation = {groupId: string; index: number};

type MusicLibraryProps = {compact?: boolean};

function MusicLibraryClient({compact = false}: MusicLibraryProps) {
  const [initialSession] = useState(() => readLibrarySession(siteMusicGroups[0]?.id ?? ''));
  // Core groups are static (shipped in playlist.ts). The baby-music manifest
  // loads asynchronously and is appended to extensionGroups so we can keep
  // the two lifecycles separate and reason about cache invalidation per side.
  const [coreGroups] = useState<PlaylistGroup[]>(siteMusicGroups);
  const [extensionGroups, setExtensionGroups] = useState<PlaylistGroup[]>([]);
  const [manifestLoaded, setManifestLoaded] = useState(false);
  const baseGroups = useMemo(
    () => [...coreGroups, ...extensionGroups],
    [coreGroups, extensionGroups],
  );
  const [activeGroupId, setActiveGroupId] = useState(initialSession.groupId);
  const [activeArtist, setActiveArtist] = useState(initialSession.artist);
  const [searchQuery, setSearchQuery] = useState(initialSession.query);
  const [artistSearch, setArtistSearch] = useState('');
  const [artistPickerOpen, setArtistPickerOpen] = useState(false);
  const [locateUrl, setLocateUrl] = useState('');
  const [singerDrawerOpen, setSingerDrawerOpen] = useState(false);
  const [currentTrackKey, setCurrentTrackKey] = useState('');
  const [currentTrackUrl, setCurrentTrackUrl] = useState('');
  const [playbackPaused, setPlaybackPaused] = useState(true);
  const [highlightedIndex, setHighlightedIndex] = useState(-1);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const libraryRef = useRef<HTMLElement>(null);
  const sessionRef = useRef(initialSession);
  const restoredScroll = useRef(false);

  useEffect(() => {
    if (compact && window.innerWidth > 640 && !window.matchMedia('(pointer: coarse)').matches) searchInputRef.current?.focus({preventScroll: true});
  }, [compact]);

  useEffect(() => {
    let disposed = false;

    async function loadManifest() {
      try {
        const response = await fetch(babyMusicManifestUrl);
        if (!response.ok) return;
        const manifest = (await response.json()) as PlaylistManifestGroup[];
        if (disposed || manifest.length === 0) return;
        setExtensionGroups(manifest.map(playlistGroupFromManifest));
      } catch {} finally { if (!disposed) setManifestLoaded(true); }
    }

    void loadManifest();

    return () => {
      disposed = true;
    };
  }, []);

  const derived = useMemo(
    () => ({
      fixed: baseGroups,
      filter: buildFilterGroups(baseGroups),
      artist: buildArtistGroups(baseGroups),
    }),
    [baseGroups],
  );

  const activeArtistGroup = useMemo(
    () => derived.artist.find((g) => g.id === activeGroupId),
    [derived.artist, activeGroupId],
  );

  const activeGroup = useMemo(() => {
    return (
      derived.fixed.find((g) => g.id === activeGroupId) ??
      derived.filter.find((g) => g.id === activeGroupId) ??
      activeArtistGroup ??
      derived.fixed[0]
    );
  }, [derived, activeGroupId, activeArtistGroup]);

  const searchActive = searchQuery.trim().length > 0;
  const searchedTracks = useMemo(() => {
    if (!searchActive) return null;
    const q = searchQuery.trim().toLowerCase();
    return baseGroups.flatMap((g) => g.tracks).filter((t) => {
      const name = (t.name ?? '').toLowerCase();
      const artist = (t.artist ?? '').toLowerCase();
      return name.includes(q) || artist.includes(q);
    });
  }, [baseGroups, searchActive, searchQuery]);

  const tracksToShow = useMemo(() => {
    const tracks = searchActive && searchedTracks ? searchedTracks : activeGroup?.tracks ?? [];
    return activeArtist ? tracks.filter((track) => primaryArtistOf(track.artist) === activeArtist) : tracks;
  }, [searchActive, searchedTracks, activeGroup, activeArtist]);

  const artistOptions = useMemo(() => {
    const tracks = searchActive && searchedTracks ? searchedTracks : activeGroup?.tracks ?? [];
    const counts = new Map<string, number>();
    tracks.forEach((track) => {
      const artist = primaryArtistOf(track.artist);
      counts.set(artist, (counts.get(artist) ?? 0) + 1);
    });
    return [...counts].sort(([left], [right]) => left.localeCompare(right, 'zh-Hans-CN'));
  }, [activeGroup, searchActive, searchedTracks]);

  const groupedTracks = useMemo(() => {
    if (compact) return [{artist: null as string | null, tracks: tracksToShow}];
    const buckets = new Map<string, PlaylistGroup['tracks']>();
    tracksToShow.forEach((track) => {
      const artist = primaryArtistOf(track.artist);
      if (!buckets.has(artist)) buckets.set(artist, []);
      buckets.get(artist)!.push(track);
    });
    if (buckets.size < 2) {
      return [{artist: null as string | null, tracks: tracksToShow}];
    }
    return Array.from(buckets.entries())
      .sort(([a], [b]) => a.localeCompare(b, 'zh-Hans-CN'))
      .map(([artist, tracks]) => ({artist, tracks}));
  }, [compact, tracksToShow]);

  const flatTracks = useMemo(() => groupedTracks.flatMap((g) => g.tracks), [groupedTracks]);

  // O(1) lookup of "where in the visible list is this track?" — replaces the
  // O(n) flatTracks.indexOf calls that used to fire in both the render loop
  // and the onMouseEnter handler.
  const flatIndexByTrack = useMemo(() => {
    const map = new Map<PlaylistGroup['tracks'][number], number>();
    flatTracks.forEach((track, index) => {
      if (!map.has(track)) map.set(track, index);
    });
    return map;
  }, [flatTracks]);

  useEffect(() => {
    setHighlightedIndex(-1);
  }, [activeGroupId, searchQuery]);

  useEffect(() => {
    if (highlightedIndex >= flatTracks.length) setHighlightedIndex(Math.max(0, flatTracks.length - 1));
  }, [flatTracks.length, highlightedIndex]);

  const playFromGlobalPlayer = useCallback((detail: MusicPlayerPlayDetail) => {
    dispatchMusicPlayerPlay(detail);
    setCurrentTrackUrl('');
    setCurrentTrackKey(`${detail.groupId}:${detail.trackIndex ?? 0}`);
  }, []);

  // Reverse channel: the global player dispatches `feei:music-player-state`
  // whenever the active track changes (manual switch, auto-advance on
  // `ended`, mount-time restore). Keep `currentTrackKey` in sync so the
  // "now playing" highlight follows along even when the user uses the
  // mini-player controls.
  useEffect(() => {
    const handlePlayerState = (event: Event) => {
      const detail = (event as CustomEvent<MusicPlayerStateDetail>).detail;
      if (!detail?.groupId) return;
      setCurrentTrackKey(`${detail.groupId}:${detail.trackIndex ?? 0}`);
      setCurrentTrackUrl(detail.trackUrl ?? '');
      setPlaybackPaused(detail.paused !== false);
    };
    window.addEventListener(musicPlayerStateEventName, handlePlayerState);
    window.dispatchEvent(new CustomEvent(musicPlayerStateRequestEventName));
    return () => window.removeEventListener(musicPlayerStateEventName, handlePlayerState);
  }, []);

  const selectGroup = useCallback((groupId: string) => {
    setActiveGroupId(groupId);
    setActiveArtist('');
    setSearchQuery('');
  }, []);

  useEffect(() => {
    if (!compact) return;
    const scroller = libraryRef.current?.closest<HTMLElement>('[data-music-scroll]');
    if (!scroller) return;
    const sameFilters = sessionRef.current.groupId === activeGroupId
      && sessionRef.current.artist === activeArtist && sessionRef.current.query === searchQuery;
    sessionRef.current = {
      groupId: activeGroupId, artist: activeArtist, query: searchQuery,
      scrollTop: sameFilters ? sessionRef.current.scrollTop : 0,
    };
    saveLibrarySession(sessionRef.current);
    if (!manifestLoaded) return;
    restoredScroll.current = false;
    const frame = window.requestAnimationFrame(() => {
      scroller.scrollTop = sessionRef.current.scrollTop;
      restoredScroll.current = true;
    });
    const remember = () => {
      if (!restoredScroll.current) return;
      sessionRef.current = {...sessionRef.current, scrollTop: scroller.scrollTop};
      saveLibrarySession(sessionRef.current);
    };
    scroller.addEventListener('scroll', remember, {passive: true});
    return () => {
      window.cancelAnimationFrame(frame);
      scroller.removeEventListener('scroll', remember);
    };
  }, [compact, manifestLoaded, activeGroupId, activeArtist, searchQuery]);

  const locateCurrentTrack = () => {
    if (!currentTrackUrl) return;
    const group = baseGroups.find((item) => item.tracks.some((track) => track.url === currentTrackUrl));
    if (!group) return;
    selectGroup(group.id);
    setLocateUrl(currentTrackUrl);
  };

  useEffect(() => {
    if (!locateUrl || !manifestLoaded) return;
    const frame = window.requestAnimationFrame(() => {
      const row = [...(libraryRef.current?.querySelectorAll<HTMLButtonElement>('[data-track-url]') ?? [])]
        .find((element) => element.dataset.trackUrl === locateUrl);
      const scroller = libraryRef.current?.closest<HTMLElement>('[data-music-scroll]');
      if (!row || !scroller) return;
      const bounds = scroller.getBoundingClientRect();
      const scale = bounds.height / scroller.clientHeight || 1;
      scroller.scrollTop += (row.getBoundingClientRect().top - bounds.top) / scale
        - scroller.clientHeight / 2 + row.clientHeight / 2;
      row.focus({preventScroll: true});
      setLocateUrl('');
    });
    return () => window.cancelAnimationFrame(frame);
  }, [locateUrl, flatTracks, manifestLoaded]);

  const playGroup = useCallback(
    (groupId: string) => {
      selectGroup(groupId);
      playFromGlobalPlayer({groupId, trackIndex: 0});
    },
    [playFromGlobalPlayer, selectGroup],
  );

  // O(1) lookup of "which base group does this track belong to, and at what
  // index?" — replaces the baseGroups.find(...).tracks.indexOf(...) chain
  // that ran on every click and made the search-state trackKey wrong.
  const trackLocationByTrack = useMemo(() => {
    const map = new Map<PlaylistGroup['tracks'][number], TrackLocation>();
    baseGroups.forEach((group) => {
      group.tracks.forEach((track, index) => {
        if (!map.has(track)) {
          map.set(track, {groupId: group.id, index});
        }
      });
    });
    return map;
  }, [baseGroups]);

  const playTrack = useCallback(
    (track: PlaylistGroup['tracks'][number]) => {
      const location = trackLocationByTrack.get(track);
      if (!location) return;
      playFromGlobalPlayer({groupId: location.groupId, trackIndex: location.index});
    },
    [playFromGlobalPlayer, trackLocationByTrack],
  );

  const totalTracks = useMemo(
    () => baseGroups.reduce((sum, g) => sum + g.tracks.length, 0),
    [baseGroups],
  );

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      const target = event.target;
      if (compact && (artistPickerOpen || !libraryRef.current?.contains(target as Node))) return;
      if (target instanceof HTMLSelectElement) return;
      if (compact && event.key === 'Escape') return;
      if (event.key === 'Enter' && target instanceof HTMLElement && target.closest('button, a')) return;
      const isTyping =
        target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement;

      if (event.key === 'Escape') {
        if (singerDrawerOpen) {
          event.preventDefault();
          setSingerDrawerOpen(false);
          return;
        }
        if (isTyping) {
          if (document.querySelector('#global-music-panel')?.contains(target as Node)) return;
          (target as HTMLInputElement).blur();
          setSearchQuery('');
          return;
        }
        if (searchQuery) {
          setSearchQuery('');
          return;
        }
        return;
      }

      if (isTyping) return;

      if (event.key === '/') {
        event.preventDefault();
        searchInputRef.current?.focus();
        searchInputRef.current?.select();
        return;
      }

      if (event.key === 'j' || event.key === 'ArrowDown') {
        event.preventDefault();
        setHighlightedIndex((i) => Math.min(i + 1, Math.max(0, flatTracks.length - 1)));
      } else if (event.key === 'k' || event.key === 'ArrowUp') {
        event.preventDefault();
        setHighlightedIndex((i) => Math.max(0, i - 1));
      } else if (event.key === 'Enter' && flatTracks[highlightedIndex]) {
        event.preventDefault();
        playTrack(flatTracks[highlightedIndex]);
      }
    }

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [compact, artistPickerOpen, flatTracks, highlightedIndex, playTrack, searchQuery, singerDrawerOpen]);

  if (!activeGroup && !searchActive) return null;

  const isArtistGrouping = Boolean(activeArtistGroup);

  const renderTab = (group: PlaylistGroup) => {
    const isActive = group.id === activeGroupId;
    return (
      <div
        key={group.id}
        className={clsx(styles.groupTab, isActive && styles.groupTabActive)}>
        <button
          type="button"
          className={styles.groupTabSelect}
          aria-pressed={isActive}
          onClick={() => selectGroup(group.id)}>
          <span className={styles.groupTabLabel}>{group.label}</span>
          <span className={styles.groupCount}>{group.tracks.length}</span>
        </button>
        <button
          type="button"
          className={styles.groupTabPlay}
          aria-label={`播放 ${group.label}`}
          title={`播放 ${group.label}`}
          onClick={() => playGroup(group.id)}>
          <PlayerIcon size={13} />
        </button>
      </div>
    );
  };

  return (
    <section ref={libraryRef} className={clsx(styles.library, compact && styles.compact)}>
      {!compact && <div className={styles.stats}>
        {searchActive
          ? `全库搜索「${searchQuery}」· ${tracksToShow.length} 首`
          : activeArtist ? `${activeArtist} · ${tracksToShow.length} 首` : `共 ${totalTracks} 首 · ${derived.artist.length} 位歌手`}
      </div>}

      <div className={styles.toolbar}>
        <div className={styles.searchRow}>
          <span className={styles.searchIcon} aria-hidden="true">
            <MagnifierIcon size={16} />
          </span>
          <input
            ref={searchInputRef}
            type="search"
            className={styles.searchInput}
            placeholder="搜索全部歌曲或歌手"
            value={searchQuery}
            onChange={(event) => { setSearchQuery(event.target.value); setActiveArtist(''); }}
            aria-label="搜索音乐"
          />
          {searchQuery ? (
            <button
              type="button"
              className={styles.searchClearButton}
              onClick={() => {
                setSearchQuery('');
                searchInputRef.current?.focus();
              }}
              aria-label="清空搜索">
              清空
            </button>
          ) : (
            <kbd className={styles.searchKbd} aria-hidden="true">
              /
            </kbd>
          )}
        </div>

        {compact ? <div className={styles.compactFilters}><label className={styles.compactFilter}>
          <select aria-label="选择歌单" value={activeGroupId} onChange={(event) => selectGroup(event.target.value)}>
            <optgroup label="我的歌单">{derived.fixed.map((group) => <option key={group.id} value={group.id}>{group.label}</option>)}</optgroup>
            <optgroup label="分类">{derived.filter.map((group) => <option key={group.id} value={group.id}>{group.label}</option>)}</optgroup>
          </select>
        </label>
          <Popover.Root open={artistPickerOpen} onOpenChange={({open}) => { setArtistPickerOpen(open); if (!open) setArtistSearch(''); }}
            positioning={{placement: 'bottom-start', strategy: 'fixed'}} lazyMount unmountOnExit>
            <Popover.Trigger asChild><button type="button" className={styles.artistTrigger} aria-label="筛选歌手">
              <span>{activeArtist || '全部歌手'}</span><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true"><path d="m6 9 6 6 6-6" /></svg>
            </button></Popover.Trigger>
            <Portal><Popover.Positioner><Popover.Content className={styles.artistPicker}>
              <Popover.Title className={styles.artistPickerTitle}>筛选歌手</Popover.Title>
              <input type="search" aria-label="搜索歌手" placeholder="输入歌手名" value={artistSearch}
                onChange={(event) => setArtistSearch(event.target.value)} />
              <div className={styles.artistOptions}>
                <button type="button" aria-pressed={!activeArtist} onClick={() => { setActiveArtist(''); setArtistPickerOpen(false); }}>全部歌手</button>
                {artistOptions.filter(([artist]) => artist.toLowerCase().includes(artistSearch.trim().toLowerCase())).map(([artist, count]) =>
                  <button key={artist} type="button" aria-pressed={activeArtist === artist} onClick={() => { setActiveArtist(artist); setArtistPickerOpen(false); setArtistSearch(''); }}>
                    <span>{artist}</span><small>{count} 首</small>
                  </button>)}
                {artistSearch && !artistOptions.some(([artist]) => artist.toLowerCase().includes(artistSearch.trim().toLowerCase())) && <p>没有匹配的歌手</p>}
              </div>
            </Popover.Content></Popover.Positioner></Portal>
          </Popover.Root>
        </div> : <div className={styles.filtersBar}>
          <div className={styles.filtersGroup}>
            <span className={styles.filtersLabel}>歌单</span>
            {derived.fixed.map(renderTab)}
          </div>

          {derived.filter.length > 0 && (
            <div className={styles.filtersGroup}>
              <span className={styles.filtersLabel}>筛选</span>
              {derived.filter.map(renderTab)}
            </div>
          )}

          {derived.artist.length > 0 && (
            <div className={styles.filtersGroup}>
              <span className={styles.filtersLabel}>歌手</span>
              <button
                type="button"
                className={clsx(
                  styles.groupTab,
                  styles.singerTrigger,
                  isArtistGrouping && styles.groupTabActive,
                )}
                onClick={() => setSingerDrawerOpen(true)}
                aria-haspopup="dialog">
                <span className={styles.groupTabSelect}>
                  <span className={styles.groupTabLabel}>
                    {activeArtistGroup ? activeArtistGroup.label : '全部'}
                  </span>
                  <span className={styles.groupCount}>
                    {isArtistGrouping
                      ? `${activeArtistGroup!.tracks.length} 首`
                      : `${derived.artist.length} 位`}
                  </span>
                </span>
                <span className={styles.singerTriggerCaret} aria-hidden="true">
                  <ArrowDownIcon size={13} />
                </span>
              </button>
            </div>
          )}
        </div>}
      </div>

      {compact && <div className={styles.listHeading}>
        <span className={styles.stats}>{searchActive ? `搜索结果 · ${tracksToShow.length} 首` : activeArtist ? `${activeArtist} · ${tracksToShow.length} 首` : `${tracksToShow.length} 首歌曲`}</span>
        <button type="button" className={styles.locateButton} aria-label="定位当前歌曲" title="定位当前歌曲" disabled={!currentTrackUrl} onClick={locateCurrentTrack}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true"><circle cx="12" cy="12" r="7" /><circle cx="12" cy="12" r="2" /><path d="M12 2v3m0 14v3M2 12h3m14 0h3" /></svg>当前歌曲
        </button>
      </div>}
      <div className={styles.trackList}>
        {tracksToShow.length === 0 ? (
          <div className={styles.emptyState}>
            没有匹配「{searchQuery}」的歌曲
            <div className={styles.emptyStateHint}>试试切换歌手或维度筛选</div>
          </div>
        ) : (
          groupedTracks.map((group, groupIndex) => (
            <div key={group.artist ?? 'all'} className={styles.trackGroup}>
              {group.artist && (
                <div className={styles.trackGroupHeader}>
                  <span className={styles.trackGroupName}>{group.artist}</span>
                  <span className={styles.trackGroupCount}>{group.tracks.length} 首</span>
                </div>
              )}
              {group.tracks.map((track) => {
                const flatIndex = flatIndexByTrack.get(track) ?? -1;
                const trackLocation = trackLocationByTrack.get(track);
                const trackKey = trackLocation ? `${trackLocation.groupId}:${trackLocation.index}` : '';
                const isCurrent = currentTrackUrl ? track.url === currentTrackUrl : trackKey !== '' && currentTrackKey === trackKey;
                const isHighlighted = flatIndex === highlightedIndex;
                const hideArtist = Boolean(group.artist) || isArtistGrouping;
                return (
                  <div key={`${track.url}-${groupIndex}`} className={compact ? styles.trackRow : styles.plainTrackRow}>
                  <button
                    type="button"
                    className={clsx(
                      styles.trackItem,
                      hideArtist && styles.trackItemNoArtist,
                      isHighlighted && styles.trackItemHighlighted,
                      isCurrent && styles.trackItemCurrent,
                    )}
                    onClick={() => playTrack(track)}
                    aria-current={isCurrent ? 'true' : undefined}
                    data-track-url={track.url}
                    aria-label={`${track.name} · ${track.artist}${isCurrent ? playbackPaused ? ' · 已暂停' : ' · 播放中' : ''}`}
                    onMouseEnter={() => setHighlightedIndex(flatIndex)}
                    onMouseLeave={() => setHighlightedIndex(-1)}>
                    <span className={styles.trackPlayHint} aria-hidden="true">
                      {isCurrent ? <span className={clsx(styles.playingBars, playbackPaused && styles.playingBarsPaused)}><i /><i /><i /></span> : <PlayerIcon size={12} />}
                    </span>
                    <span className={styles.trackName}>{track.name}</span>
                    {!hideArtist && (
                      <span className={styles.trackArtist}>{track.artist}</span>
                    )}
                  </button>
                  </div>
                );
              })}
            </div>
          ))
        )}
      </div>

      {singerDrawerOpen && (
        <SingerDrawer
          artists={derived.artist}
          activeGroupId={activeGroupId}
          onClose={() => setSingerDrawerOpen(false)}
          onSelect={(id) => {
            selectGroup(id);
            setSingerDrawerOpen(false);
          }}
          onPlay={(id) => {
            playGroup(id);
            setSingerDrawerOpen(false);
          }}
        />
      )}

      {!compact && <div className={styles.keyboardHints} aria-hidden="true">
        <span><kbd>/</kbd> 搜索</span>
        <span><kbd>J</kbd> <kbd>K</kbd> 上下</span>
        <span><kbd>Enter</kbd> 播放</span>
        <span><kbd>Esc</kbd> 关闭</span>
      </div>}
    </section>
  );
}

function SingerDrawer({
  artists,
  activeGroupId,
  onClose,
  onSelect,
  onPlay,
}: {
  artists: PlaylistGroup[];
  activeGroupId: string;
  onClose: () => void;
  onSelect: (id: string) => void;
  onPlay: (id: string) => void;
}) {
  const [filter, setFilter] = useState('');

  useEffect(() => {
    function handleKey(event: KeyboardEvent) {
      if (event.key === 'Escape') onClose();
    }
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [onClose]);

  const visible = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return artists;
    return artists.filter((a) => a.label.toLowerCase().includes(q));
  }, [artists, filter]);

  return (
    <div
      className={styles.drawerOverlay}
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label="全部歌手">
      <div className={styles.drawer} onClick={(event) => event.stopPropagation()}>
        <div className={styles.drawerHeader}>
          <div className={styles.drawerTitle}>全部歌手</div>
          <button
            type="button"
            className={styles.drawerCloseButton}
            onClick={onClose}
            aria-label="关闭">
            <XIcon size={19} />
          </button>
        </div>
        <input
          type="search"
          className={styles.drawerSearch}
          placeholder="筛选歌手"
          value={filter}
          onChange={(event) => setFilter(event.target.value)}
          aria-label="筛选歌手"
        />
        <div className={styles.drawerList}>
          {visible.length === 0 ? (
            <div className={styles.drawerEmpty}>没有匹配的歌手</div>
          ) : (
            visible.map((artist) => (
              <div
                key={artist.id}
                className={clsx(
                  styles.drawerItem,
                  activeGroupId === artist.id && styles.drawerItemActive,
                )}>
                <button
                  type="button"
                  className={styles.drawerItemSelect}
                  onClick={() => onSelect(artist.id)}>
                  <span className={styles.drawerItemName}>{artist.label}</span>
                  <span className={styles.drawerItemCount}>{artist.tracks.length}</span>
                </button>
                <button
                  type="button"
                  className={styles.drawerItemPlay}
                  aria-label={`播放 ${artist.label}`}
                  title={`播放 ${artist.label}`}
                  onClick={() => onPlay(artist.id)}>
                  <PlayerIcon size={13} />
                </button>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}

export default function MusicLibrary(props: MusicLibraryProps) {
  return <BrowserOnly fallback={null}>{() => <MusicLibraryClient {...props} />}</BrowserOnly>;
}
