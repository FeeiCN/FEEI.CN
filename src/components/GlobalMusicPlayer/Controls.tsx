import clsx from 'clsx';
import {useCallback, useEffect, useMemo, useRef, useState} from 'react';
import {useHistory, useLocation} from '@docusaurus/router';
import {MusicIcon} from '@site/src/components/ItsHoverIcon';
import type {PlaylistGroup} from './playlist';
import {musicPlayerOpenEventName} from './playerEvents';
import type {MusicPlayerPlayDetail} from './playerEvents';
import styles from './controls.module.css';

type Props = {
  groups: PlaylistGroup[];
  activeGroupId: string;
  currentTrackUrl: string;
  visible: boolean;
  error: string;
  onPlay: (detail: MusicPlayerPlayDetail) => void;
  onHide: () => void;
};
type TrackRow = {track: PlaylistGroup['tracks'][number]; groupId: string; index: number};

export default function MusicControls({groups, activeGroupId, currentTrackUrl, visible, error, onPlay, onHide}: Props) {
  const [open, setOpen] = useState(false);
  const [selectedGroupId, setSelectedGroupId] = useState(activeGroupId);
  const [query, setQuery] = useState('');
  const dialogRef = useRef<HTMLDialogElement>(null);
  const launcherRef = useRef<HTMLButtonElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const resultsRef = useRef<HTMLDivElement>(null);
  const history = useHistory();
  const location = useLocation();
  const close = useCallback(() => setOpen(false), []);

  useEffect(() => {
    const handleOpen = () => setOpen(true);
    window.addEventListener(musicPlayerOpenEventName, handleOpen);
    return () => window.removeEventListener(musicPlayerOpenEventName, handleOpen);
  }, []);

  useEffect(() => {
    const params = new URLSearchParams(location.search);
    if (params.get('music') !== 'open') return;
    setOpen(true);
    params.delete('music');
    const search = params.toString();
    history.replace({...location, search: search ? `?${search}` : ''});
  }, [location, history]);

  useEffect(() => {
    if (!open || !dialogRef.current) return;
    const dialog = dialogRef.current;
    const previousOverflow = document.body.style.overflow;
    void import('aplayer').catch(() => {});
    dialog.showModal();
    document.body.style.overflow = 'hidden';
    if (window.matchMedia('(max-width: 640px)').matches) closeRef.current?.focus();
    else searchRef.current?.focus();
    return () => {
      dialog.close();
      document.body.style.overflow = previousOverflow;
      launcherRef.current?.focus({preventScroll: true});
    };
  }, [open]);

  const playlists = useMemo(() => groups.filter((group) => !group.id.startsWith('artist-')), [groups]);
  const artists = useMemo(() => groups.filter((group) => group.id.startsWith('artist-')), [groups]);
  const selectedGroup = groups.find((group) => group.id === selectedGroupId) ?? groups[0];
  const rows = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase();
    if (!needle) return selectedGroup?.tracks.map((track, index) => ({track, index, groupId: selectedGroup.id})) ?? [];
    const unique = new Map<string, TrackRow>();
    for (const group of groups) {
      group.tracks.forEach((track, index) => {
        if (!unique.has(track.url) && `${track.name ?? ''} ${track.artist ?? ''}`.toLocaleLowerCase().includes(needle)) {
          unique.set(track.url, {track, index, groupId: group.id});
        }
      });
    }
    return [...unique.values()];
  }, [groups, selectedGroup, query]);

  const selectGroup = (id: string) => {
    setSelectedGroupId(id);
    setQuery('');
    resultsRef.current?.scrollTo({top: 0});
  };
  const play = (row: TrackRow) => {
    onPlay({groupId: row.groupId, trackIndex: row.index, showList: false});
    close();
  };

  return (
    <>
      <div className={clsx(styles.launcher, visible && styles.abovePlayer)} data-testid="music-launcher">
        {error && <span className={styles.error} role="status">{error}</span>}
        <button ref={launcherRef} type="button" className={styles.launchButton}
          aria-label="打开音乐播放器" aria-haspopup="dialog" aria-expanded={open}
          aria-controls="global-music-dialog" onClick={() => setOpen(true)}>
          <MusicIcon size={20} disableHover />
          <span>{visible ? '选歌' : '音乐'}</span>
        </button>
        {visible && <button type="button" className={styles.hideButton}
          aria-label="暂停并收起播放器" title="暂停并收起播放器" onClick={onHide}>×</button>}
      </div>
      <dialog ref={dialogRef} id="global-music-dialog" aria-label="音乐播放器选歌" className={styles.dialog}
        onCancel={(event) => { event.preventDefault(); close(); }}
        onClick={(event) => {
          if (event.target !== event.currentTarget) return;
          const rect = event.currentTarget.getBoundingClientRect();
          if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) close();
        }}
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            event.preventDefault();
            event.stopPropagation();
            close();
            return;
          }
          if (event.metaKey || event.ctrlKey || event.altKey) return;
          const buttons = Array.from(resultsRef.current?.querySelectorAll<HTMLButtonElement>('[data-music-track]') ?? []);
          const target = event.target as HTMLElement;
          if (target === searchRef.current && event.key === 'ArrowDown') {
            event.preventDefault(); buttons[0]?.focus(); return;
          }
          if (!target.hasAttribute('data-music-track')) return;
          const direction = ['ArrowDown', 'j'].includes(event.key) ? 1 : ['ArrowUp', 'k'].includes(event.key) ? -1 : 0;
          if (!direction) return;
          event.preventDefault();
          const index = buttons.indexOf(target as HTMLButtonElement);
          buttons[Math.max(0, Math.min(buttons.length - 1, index + direction))]?.focus();
        }}>
        <header className={styles.header}>
          <div><strong>音乐</strong><span className={styles.caption}>选一首，继续阅读</span></div>
          <button ref={closeRef} type="button" className={styles.closeButton} aria-label="关闭选歌面板" onClick={close}>×</button>
        </header>
        <div className={styles.filters}>
          <input ref={searchRef} type="search" value={query} className={styles.search}
            placeholder="搜索全部歌曲或歌手" aria-label="搜索歌曲或歌手"
            onChange={(event) => { setQuery(event.target.value); resultsRef.current?.scrollTo({top: 0}); }} />
          <div className={styles.selectors}>
            <label>歌单与筛选<select aria-label="选择歌单" value={selectedGroup?.id.startsWith('artist-') ? '' : selectedGroup?.id ?? ''}
              onChange={(event) => selectGroup(event.target.value)}>
              <option value="" disabled>选择歌单</option>
              {playlists.map((group) => <option key={group.id} value={group.id}>{group.label} · {group.tracks.length}</option>)}
            </select></label>
            <label>歌手<select aria-label="选择歌手" value={selectedGroup?.id.startsWith('artist-') ? selectedGroup.id : ''}
              onChange={(event) => selectGroup(event.target.value || playlists[0]?.id || '')}>
              <option value="">选择歌手</option>
              {artists.map((group) => <option key={group.id} value={group.id}>{group.label} · {group.tracks.length}</option>)}
            </select></label>
          </div>
          <div className={styles.listHeading}>
            <span role="status">{query.trim() ? `搜索结果 · ${rows.length} 首` : `${selectedGroup?.label ?? '歌单'} · ${rows.length} 首`}</span>
            {!query.trim() && rows.length > 0 && <button type="button" onClick={() => play(rows[0])}>播放歌单</button>}
          </div>
        </div>
        <div ref={resultsRef} className={styles.results}>
          {rows.length === 0 && <p className={styles.empty}>没有找到歌曲，试试其他曲名或歌手。</p>}
          {open && rows.map((row) => <button key={`${row.groupId}:${row.index}`} type="button" data-music-track
            className={clsx(styles.track, row.track.url === currentTrackUrl && styles.current)}
            aria-label={`播放 ${row.track.name} · ${row.track.artist}`}
            aria-current={row.track.url === currentTrackUrl ? 'true' : undefined}
            onClick={() => play(row)}>
            <span className={styles.trackIcon} aria-hidden="true">{row.track.url === currentTrackUrl ? '♫' : '▶'}</span>
            <span className={styles.trackText}><span className={styles.trackName}>{row.track.name}</span><span className={styles.artist}>{row.track.artist}</span></span>
          </button>)}
        </div>
        <footer className={styles.footer}>↑ ↓ 选择 · Enter 播放 · Esc 返回阅读</footer>
      </dialog>
    </>
  );
}
