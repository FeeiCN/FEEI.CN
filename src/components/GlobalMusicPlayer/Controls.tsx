import {lazy, Suspense, useEffect, useRef, useState} from 'react';
import type {CSSProperties, ReactNode} from 'react';
import {createPortal} from 'react-dom';
import {useHistory, useLocation} from '@docusaurus/router';
import {MusicIcon, getItsHoverIcon, type AnimatedIconHandle} from '@site/src/components/ItsHoverIcon';
import ListIcon from '@site/src/components/ItsHoverIcon/icons/unordered-list-icon';
import LibraryIcon from '@site/src/components/ItsHoverIcon/icons/library-icon';
import VolumeIcon from '@site/src/components/ItsHoverIcon/icons/volume-2-icon';
import AlignCenterIcon from '@site/src/components/ItsHoverIcon/icons/align-center-icon';
import RefreshIcon from '@site/src/components/ItsHoverIcon/icons/refresh-icon';
import ShuffleIcon from '@site/src/components/ItsHoverIcon/icons/shuffle-icon';
import XIcon from '@site/src/components/ItsHoverIcon/icons/x-icon';
import {
  dispatchMusicPlayerCommand, dispatchMusicPlayerOpen,
  musicPlayerCloseEventName, musicPlayerErrorEventName, musicPlayerOpenEventName,
  musicPlayerPlayEventName, musicPlayerStateEventName, musicPlayerStateRequestEventName,
} from './playerEvents';
import type {MusicPlayerStateDetail} from './playerEvents';
import styles from './controls.module.css';

const MusicLibrary = lazy(() => import('@site/src/components/MusicLibrary'));
type View = 'playing' | 'library';
const defaultCover = '/music/feei-site-theme-cover.webp';
const PlayerIcon = getItsHoverIcon('player-icon')!;

function timeLabel(seconds: number) {
  const value = Math.max(0, Math.floor(seconds || 0));
  return `${Math.floor(value / 60)}:${String(value % 60).padStart(2, '0')}`;
}

function IconButton({label, children, onClick, pressed, className = ''}: {
  label: string; children: ReactNode; onClick: () => void; pressed?: boolean; className?: string;
}) {
  return <button type="button" className={`${styles.iconButton} ${className}`} aria-label={label}
    title={label} aria-pressed={pressed} onClick={onClick}>{children}</button>;
}

function Cover({src, className = ''}: {src?: string; className?: string}) {
  return <img className={`${styles.cover} ${className}`} src={src || defaultCover} alt="歌曲封面"
    onError={(event) => { if (!event.currentTarget.src.endsWith(defaultCover)) event.currentTarget.src = defaultCover; }} />;
}

export default function Controls() {
  const [expanded, setExpanded] = useState(false);
  const [view, setView] = useState<View>('playing');
  const [lyricsOpen, setLyricsOpen] = useState(false);
  const [playback, setPlayback] = useState<MusicPlayerStateDetail | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [scrub, setScrub] = useState<number | null>(null);
  const [following, setFollowing] = useState(true);
  const [controlsVisible, setControlsVisible] = useState(true);
  const rootRef = useRef<HTMLDivElement>(null);
  const expandRef = useRef<HTMLButtonElement>(null);
  const vinylRef = useRef<AnimatedIconHandle>(null);
  const collapseRef = useRef<HTMLButtonElement>(null);
  const lyricScrollRef = useRef<HTMLDivElement>(null);
  const lyricSceneRef = useRef<HTMLElement>(null);
  const lineRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const location = useLocation();
  const history = useHistory();
  const duration = playback?.duration ?? 0;
  const currentTime = scrub ?? playback?.currentTime ?? 0;
  const lyrics = playback?.lyrics ?? [];
  const hasCustomCover = Boolean(playback?.cover && playback.cover !== defaultCover);
  const artistSeed = playback?.artist?.split(/[&,，、/]/)[0]?.trim().slice(0, 2);
  const coverLabel = artistSeed ? `${artistSeed}精选` : '我的音乐';
  const tonearmProgress = duration > 0 ? Math.min(1, Math.max(0, (playback?.currentTime ?? 0) / duration)) : 0;
  const tonearmStyle = {'--tonearm-angle': `${-34 + tonearmProgress * 16}deg`} as CSSProperties;
  let currentLine = -1;
  for (let index = 0; index < lyrics.length; index++) {
    if (lyrics[index][0] <= (playback?.currentTime ?? 0)) currentLine = index;
  }

  const collapse = () => {
    setExpanded(false);
    window.requestAnimationFrame(() => expandRef.current?.focus({preventScroll: true}));
  };
  const wakeControls = () => {
    setControlsVisible(true);
    if (hideTimer.current) clearTimeout(hideTimer.current);
    hideTimer.current = setTimeout(() => setControlsVisible(false), 4000);
  };
  const openLyrics = () => { setLyricsOpen(true); setFollowing(true); wakeControls(); };
  const commitScrub = () => {
    if (scrub === null) return;
    dispatchMusicPlayerCommand({action: 'seek', value: scrub});
    setScrub(null);
  };

  useEffect(() => {
    const onState = (event: Event) => setPlayback((event as CustomEvent<MusicPlayerStateDetail>).detail);
    const onError = (event: Event) => setError(String((event as CustomEvent).detail ?? ''));
    const onOpen = () => { setExpanded(true); setView('playing'); };
    const onPlay = () => { setError(''); setNotice(''); };
    const onClose = () => { setExpanded(false); setLyricsOpen(false); };
    window.addEventListener(musicPlayerStateEventName, onState);
    window.addEventListener(musicPlayerErrorEventName, onError);
    window.addEventListener(musicPlayerOpenEventName, onOpen);
    window.addEventListener(musicPlayerPlayEventName, onPlay);
    window.addEventListener(musicPlayerCloseEventName, onClose);
    window.dispatchEvent(new CustomEvent(musicPlayerStateRequestEventName));
    return () => {
      window.removeEventListener(musicPlayerStateEventName, onState);
      window.removeEventListener(musicPlayerErrorEventName, onError);
      window.removeEventListener(musicPlayerOpenEventName, onOpen);
      window.removeEventListener(musicPlayerPlayEventName, onPlay);
      window.removeEventListener(musicPlayerCloseEventName, onClose);
    };
  }, []);

  useEffect(() => {
    const params = new URLSearchParams(location.search);
    if (params.get('music') !== 'open') return;
    params.delete('music');
    const frame = window.requestAnimationFrame(() => {
      dispatchMusicPlayerOpen();
      history.replace({...location, search: params.toString() ? `?${params}` : ''});
    });
    return () => window.cancelAnimationFrame(frame);
  }, [location.search, history]);

  useEffect(() => {
    document.body.classList.remove('global-music-player-visible', 'global-music-player-collapsed');
    document.body.classList.add('music-player-active');
    return () => document.body.classList.remove('music-player-active', 'music-player-expanded');
  }, []);

  useEffect(() => {
    document.body.classList.toggle('music-player-expanded', expanded);
    return () => document.body.classList.remove('music-player-expanded');
  }, [expanded]);

  useEffect(() => {
    if (expanded || !playback || playback.paused || window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      vinylRef.current?.stopAnimation();
      return;
    }
    vinylRef.current?.startAnimation();
    return () => vinylRef.current?.stopAnimation();
  }, [expanded, playback?.paused]);

  useEffect(() => {
    if (window.matchMedia('(max-width: 640px)').matches) {
      setExpanded(false);
      setLyricsOpen(false);
    }
  }, [location.pathname]);

  useEffect(() => {
    if (!expanded || lyricsOpen) return;
    const frame = window.requestAnimationFrame(() => {
      if (view === 'library' && window.innerWidth > 640) {
        rootRef.current?.querySelector<HTMLInputElement>('input[type="search"]')?.focus({preventScroll: true});
      } else collapseRef.current?.focus({preventScroll: true});
    });
    return () => window.cancelAnimationFrame(frame);
  }, [expanded, lyricsOpen]);

  useEffect(() => {
    if (!expanded && !lyricsOpen) return;
    const onPointer = (event: PointerEvent) => {
      if (!lyricsOpen && event.target instanceof Node && !rootRef.current?.contains(event.target)) collapse();
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented || rootRef.current?.querySelector('[aria-modal="true"]')) return;
      event.preventDefault();
      if (lyricsOpen) { setLyricsOpen(false); return; }
      collapse();
    };
    document.addEventListener('pointerdown', onPointer);
    window.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('pointerdown', onPointer); window.removeEventListener('keydown', onKey); };
  }, [expanded, lyricsOpen]);

  useEffect(() => {
    if (!lyricsOpen) return;
    const previousOverflow = document.body.style.overflow;
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const scene = lyricSceneRef.current;
    const siblings = [...document.body.children].filter((element): element is HTMLElement => element instanceof HTMLElement && element !== scene && !element.inert);
    siblings.forEach((element) => { element.inert = true; });
    document.body.style.overflow = 'hidden';
    scene?.querySelector<HTMLButtonElement>('button')?.focus({preventScroll: true});
    return () => {
      document.body.style.overflow = previousOverflow;
      siblings.forEach((element) => { element.inert = false; });
      if (hideTimer.current) clearTimeout(hideTimer.current);
      previousFocus?.focus({preventScroll: true});
    };
  }, [lyricsOpen]);
  useEffect(() => {
    if (!lyricsOpen || !following || currentLine < 0) return;
    const line = lineRefs.current[currentLine];
    const container = lyricScrollRef.current;
    if (!line || !container) return;
    container.scrollTo({top: line.offsetTop - container.clientHeight / 2 + line.clientHeight / 2,
      behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth'});
  }, [lyricsOpen, following, currentLine, lyrics.length]);
  useEffect(() => { setFollowing(true); setScrub(null); }, [playback?.groupId, playback?.trackIndex]);
  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(''), 2500);
    return () => clearTimeout(timer);
  }, [notice]);

  const progressStyle = {'--progress': `${duration ? currentTime / duration * 100 : 0}%`} as CSSProperties;
  const playButton = (large = false) => <IconButton label={!playback || playback.paused ? '播放' : '暂停'}
    className={large ? styles.primaryPlay : ''} onClick={() => dispatchMusicPlayerCommand({action: 'toggle'})}>
    {!playback || playback.paused ? <PlayerIcon size={large ? 28 : 20} disableHover /> : <span className={styles.pauseGlyph} aria-hidden="true" />}
  </IconButton>;
  const loop = playback?.loop ?? 'all';
  const order = playback?.order ?? 'list';
  const nextLoop = loop === 'none' ? 'all' : loop === 'all' ? 'one' : 'none';
  const loopLabel = loop === 'none' ? '不循环，点击切换列表循环' : loop === 'all' ? '列表循环，点击切换单曲循环' : '单曲循环，点击关闭循环';
  const transport = <div className={styles.transport}>
    <IconButton label={order === 'list' ? '顺序播放，点击切换随机播放' : '随机播放，点击切换顺序播放'}
      className={styles.modeButton} pressed={order === 'random'}
      onClick={() => dispatchMusicPlayerCommand({action: 'order', value: order === 'list' ? 'random' : 'list'})}>
      {order === 'list' ? <ListIcon size={19} /> : <ShuffleIcon size={19} />}
    </IconButton>
    <IconButton label="上一首" onClick={() => dispatchMusicPlayerCommand({action: 'previous'})}><span className={`${styles.skipGlyph} ${styles.skipBackward}`} aria-hidden="true"><PlayerIcon size={16} disableHover /><PlayerIcon size={16} disableHover /></span></IconButton>
    {playButton(true)}
    <IconButton label="下一首" onClick={() => dispatchMusicPlayerCommand({action: 'next'})}><span className={styles.skipGlyph} aria-hidden="true"><PlayerIcon size={16} disableHover /><PlayerIcon size={16} disableHover /></span></IconButton>
    <IconButton label={loopLabel} className={styles.modeButton} pressed={loop !== 'none'}
      onClick={() => dispatchMusicPlayerCommand({action: 'loop', value: nextLoop})}>
      <span className={styles.loopIcon}><RefreshIcon size={19} />{loop === 'one' && <small>1</small>}</span>
    </IconButton>
  </div>;
  const progress = <div className={styles.progress}>
    {scrub !== null && <span className={styles.scrubTime} role="status">{timeLabel(currentTime)} / {timeLabel(duration)}</span>}
    <input type="range" aria-label="播放进度" min="0" max={duration || 1} step="1" disabled={!duration}
      value={Math.min(currentTime, duration || 1)} style={progressStyle}
      aria-valuetext={`${timeLabel(currentTime)} / ${timeLabel(duration)}`}
      onChange={(event) => setScrub(Number(event.target.value))}
      onPointerUp={commitScrub} onPointerCancel={() => setScrub(null)} onKeyUp={commitScrub} onBlur={commitScrub} />
    <div className={styles.times}><span>{timeLabel(currentTime)}</span><span>−{timeLabel(duration - currentTime)}</span></div>
  </div>;
  const status = (error || notice) && <div className={styles.status} role="status">
    <span>{error || notice}</span>{error && <button type="button" onClick={() => dispatchMusicPlayerCommand({action: 'retry'})}>重试</button>}
  </div>;
  const libraryActive = view === 'library';

  return createPortal(<>
    {expanded && <div className={styles.scrim} aria-hidden="true" />}
    <div ref={rootRef} className={`${styles.player} ${expanded ? styles.expanded : ''}`}>
      {!expanded ? <div className={styles.mini}>
        <button ref={expandRef} type="button" className={styles.miniTrack} aria-label="展开音乐播放器"
          aria-haspopup="dialog" onClick={() => { dispatchMusicPlayerOpen(); setView('playing'); }}>
          <span className={styles.miniVinyl} aria-hidden="true"><MusicIcon ref={vinylRef} size={26} strokeWidth={1.8} disableHover /></span>
          <span className={styles.miniText}><strong>{playback?.title || '音乐'}</strong><span>{playback?.artist || '我的音乐库'}</span></span>
        </button>
        {playback && playButton()}
        <IconButton label="打开音乐库" className={styles.miniLibraryButton} onClick={() => { dispatchMusicPlayerOpen(); setView('library'); }}><MusicIcon size={20} disableHover /></IconButton>
        {playback && <div className={styles.miniProgress} style={progressStyle} />}
        {!expanded && error && <span className={styles.errorDot} title={error} aria-label={error} />}
      </div> : <section role="dialog" aria-label="音乐播放器" className={styles.panel}>
        <header className={styles.header}>
          <button ref={collapseRef} type="button" className={styles.iconButton} aria-label="收起播放器并继续播放" title="收起" onClick={collapse}><XIcon size={18} /></button>
          <span className={styles.headerTitle}>{view === 'playing' ? (playback?.title || '正在播放') : '音乐库'}</span>
          <span className={styles.headerSpacer} aria-hidden="true" />
        </header>
        <div className={styles.views} role="tablist" aria-label="播放器视图">
          {([['playing', '正在播放'], ['library', '音乐']] as const).map(([value, label]) =>
            <button key={value} type="button" role="tab" id={`music-tab-${value}`} aria-controls={`music-view-${value}`}
              aria-selected={view === value} tabIndex={view === value ? 0 : -1}
              onKeyDown={(event) => {
                if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
                event.preventDefault(); event.stopPropagation();
                const views: View[] = ['playing', 'library'];
                const next = views[(views.indexOf(value) + (event.key === 'ArrowRight' ? 1 : views.length - 1)) % views.length];
                setView(next);
                window.requestAnimationFrame(() => rootRef.current?.querySelector<HTMLButtonElement>(`#music-tab-${next}`)?.focus());
              }} onClick={() => setView(value)}>{label}</button>)}
        </div>
        <div className={styles.view} role="tabpanel" id={`music-view-${view}`} aria-labelledby={`music-tab-${view}`}>
          {view === 'playing' && <div className={styles.nowPlaying}>
            <div className={`${styles.turntable} ${error ? styles.turntableError : ''}`} aria-label="唱片机">
              <div className={`${styles.vinyl} ${playback && !playback.paused ? styles.vinylPlaying : ''}`}>
                {hasCustomCover ? <Cover src={playback?.cover} className={styles.vinylLabel} /> : <div className={`${styles.vinylLabel} ${styles.genericLabel}`} aria-label={`${coverLabel}通用封面`}><span className={styles.genericLabelText}>{coverLabel}</span></div>}
                <span className={styles.vinylCenter} aria-hidden="true" />
              </div>
              <span className={styles.tonearmDock} aria-hidden="true" />
              <span style={tonearmStyle} className={`${styles.tonearm} ${playback && !playback.paused ? styles.tonearmPlaying : styles.tonearmRest}`} aria-hidden="true" />
              {playback?.loading && !playback.paused && <span className={styles.turntableStatus} role="status">正在加载</span>}
            </div>
            <div className={styles.trackInfo}><h2>{playback?.title || '音乐'}</h2><p>{playback?.artist || '我的音乐库'}</p></div>
            {progress}{transport}
            <div className={styles.volume}><VolumeIcon size={17} /><input type="range" aria-label="音量" min="0" max="1" step="0.05" value={playback?.volume ?? 0.45}
              style={{'--progress': `${(playback?.volume ?? 0.45) * 100}%`} as CSSProperties}
              onChange={(event) => dispatchMusicPlayerCommand({action: 'volume', value: Number(event.target.value)})} /></div>
            <div className={styles.secondary}>
              <div className={`${styles.secondaryItem} ${lyricsOpen ? styles.secondaryItemActive : ''}`}><IconButton label="全屏歌词" pressed={lyricsOpen} onClick={openLyrics}><AlignCenterIcon size={21} /></IconButton><span>歌词</span></div>
              <div className={`${styles.secondaryItem} ${libraryActive ? styles.secondaryItemActive : ''}`}><IconButton label="打开音乐库" pressed={libraryActive} onClick={() => setView('library')}><LibraryIcon size={21} /></IconButton><span>音乐库</span></div>
            </div>
          </div>}
          {view === 'library' && <div id="global-music-panel" className={styles.library}>
            <Suspense fallback={<p role="status">正在加载音乐…</p>}><MusicLibrary compact /></Suspense>
          </div>}
        </div>
        {status}
        {view !== 'playing' && playback && <footer className={styles.footer}>
          <Cover src={playback.cover} /><div><strong>{playback.title}</strong><span>{playback.loading && !playback.paused ? '正在加载…' : playback.artist}</span></div>{playButton()}
        </footer>}
      </section>}
    </div>
    {lyricsOpen && <section ref={lyricSceneRef} className={styles.lyricScene} role="dialog" aria-modal="true" aria-label="全屏歌词" onPointerMove={wakeControls} onPointerDown={wakeControls}
      onKeyDown={(event) => {
        wakeControls();
        if (event.key !== 'Tab') return;
        const items = [...(lyricSceneRef.current?.querySelectorAll<HTMLElement>('button, input:not(:disabled)') ?? [])];
        const first = items[0]; const last = items[items.length - 1];
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
      }}>
      <img src={playback?.cover || defaultCover} alt="" className={styles.lyricBackdrop} />
      <div className={`${styles.lyricHeader} ${!controlsVisible ? styles.quiet : ''}`}>
        <div><strong>{playback?.title}</strong><span>{playback?.artist}</span></div>
        <IconButton label="关闭全屏歌词" onClick={() => setLyricsOpen(false)}><XIcon size={20} /></IconButton>
      </div>
      {lyrics.length ? <div ref={lyricScrollRef} className={styles.lyricLines}
        onWheel={() => setFollowing(false)} onTouchMove={() => setFollowing(false)}>
        {lyrics.map(([time, line], index) => <button key={`${time}-${index}`} ref={(element) => { lineRefs.current[index] = element; }}
          type="button" className={`${styles.lyricLine} ${index === currentLine ? styles.currentLine : ''}`}
          aria-label={`跳转到 ${timeLabel(time)} ${line}`} aria-current={index === currentLine ? 'true' : undefined}
          onClick={() => { dispatchMusicPlayerCommand({action: 'seek', value: time}); setFollowing(true); wakeControls(); }}>{line}</button>)}
      </div> : <div className={styles.noLyrics}><Cover src={playback?.cover} /><h2>{playback?.title}</h2><p>暂无歌词</p></div>}
      {!following && <button type="button" className={styles.followButton} onClick={() => { setFollowing(true); wakeControls(); }}>回到当前句</button>}
      <div className={`${styles.lyricControls} ${!controlsVisible ? styles.quiet : ''}`} onFocus={wakeControls}>
        {progress}{transport}{status}
      </div>
    </section>}
  </>, document.body);
}
