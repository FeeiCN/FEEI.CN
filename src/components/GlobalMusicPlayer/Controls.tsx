import {lazy, Suspense, useEffect, useRef, useState} from 'react';
import type {CSSProperties, ReactNode} from 'react';
import {createPortal} from 'react-dom';
import {Collapsible, Dialog, Popover, Portal, useMediaQuery} from '@chakra-ui/react';
import {staticAssetUrl} from '@site/src/utils/staticAssets';
import {useHistory, useLocation} from '@docusaurus/router';
import {MusicIcon, getItsHoverIcon, type AnimatedIconHandle} from '@site/src/components/ItsHoverIcon';
import ListIcon from '@site/src/components/ItsHoverIcon/icons/unordered-list-icon';
import VolumeIcon from '@site/src/components/ItsHoverIcon/icons/volume-2-icon';
import AlignCenterIcon from '@site/src/components/ItsHoverIcon/icons/align-center-icon';
import RefreshIcon from '@site/src/components/ItsHoverIcon/icons/refresh-icon';
import ShuffleIcon from '@site/src/components/ItsHoverIcon/icons/shuffle-icon';
import XIcon from '@site/src/components/ItsHoverIcon/icons/x-icon';
import {
  dispatchMusicPlayerCommand, dispatchMusicPlayerOpen, dispatchMusicPlayerClose,
  musicPlayerCloseEventName, musicPlayerErrorEventName, musicPlayerOpenEventName,
  musicPlayerPlayEventName, musicPlayerStateEventName, musicPlayerStateRequestEventName,
  musicPlayerPanelStateEventName,
} from './playerEvents';
import type {MusicPlayerOpenDetail, MusicPlayerStateDetail} from './playerEvents';
import styles from './controls.module.css';
import {playbackStatus} from './playbackStatus';

const MusicLibrary = lazy(() => import('@site/src/components/MusicLibrary'));
const defaultCover = staticAssetUrl('/music/feei-site-theme-cover.webp');
const PlayerIcon = getItsHoverIcon('player-icon')!;
let hasStartedPlayback = false;

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
  return <img className={`${styles.cover} ${className}`} src={staticAssetUrl(src) || defaultCover} alt="歌曲封面"
    onError={(event) => { if (!event.currentTarget.src.endsWith(defaultCover)) event.currentTarget.src = defaultCover; }} />;
}

function SkipIcon({back = false}: {back?: boolean}) {
  return <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"
    style={back ? {transform: 'rotate(180deg)'} : undefined}>
    <path d="M5 5.5a1 1 0 0 1 1.55-.83l10 6.5a1 1 0 0 1 0 1.66l-10 6.5A1 1 0 0 1 5 18.5z" />
    <rect x="18" y="5" width="2" height="14" rx="1" />
  </svg>;
}

export default function Controls() {
  const [isMobile] = useMediaQuery(['(max-width: 640px)'], {ssr: false});
  const [expanded, setExpanded] = useState(false);
  const [detailsExpanded, setDetailsExpanded] = useState(false);
  const [lyricsOpen, setLyricsOpen] = useState(false);
  const [volumeOpen, setVolumeOpen] = useState(false);
  const [playback, setPlayback] = useState<MusicPlayerStateDetail | null>(null);
  const [hasPlayed, setHasPlayed] = useState(hasStartedPlayback);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [scrub, setScrub] = useState<number | null>(null);
  const [following, setFollowing] = useState(true);
  const [controlsVisible, setControlsVisible] = useState(true);
  const [isScrolling, setIsScrolling] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLElement>(null);
  const expandRef = useRef<HTMLButtonElement>(null);
  const openerRef = useRef<HTMLElement | null>(null);
  const pointerDismissRef = useRef(false);
  const expandedRef = useRef(false);
  const vinylRef = useRef<AnimatedIconHandle>(null);
  const collapseRef = useRef<HTMLButtonElement>(null);
  const lyricScrollRef = useRef<HTMLDivElement>(null);
  const lyricSceneRef = useRef<HTMLElement>(null);
  const lineRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const scrollTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const location = useLocation();
  const history = useHistory();
  useEffect(() => {
    if (!expanded || lyricsOpen || !detailsExpanded) setVolumeOpen(false);
  }, [expanded, lyricsOpen, detailsExpanded]);
  const duration = playback?.duration ?? 0;
  const currentTime = scrub ?? playback?.currentTime ?? 0;
  const lyrics = playback?.lyrics ?? [];
  let currentLine = -1;
  for (let index = 0; index < lyrics.length; index++) {
    if (lyrics[index][0] <= (playback?.currentTime ?? 0)) currentLine = index;
  }

  const collapse = () => {
    setExpanded(false);
    expandedRef.current = false;
    if (pointerDismissRef.current) {
      pointerDismissRef.current = false;
      return;
    }
    window.requestAnimationFrame(() => {
      const opener = openerRef.current;
      const target = opener?.isConnected && opener !== document.body
        ? opener : expandRef.current ?? document.querySelector<HTMLButtonElement>('[data-music-trigger]');
      target?.focus({preventScroll: true});
    });
  };
  const dismiss = () => {
    dispatchMusicPlayerClose();
    window.requestAnimationFrame(() => document.querySelector<HTMLButtonElement>('[data-music-trigger]')?.focus({preventScroll: true}));
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
    const onState = (event: Event) => {
      const detail = (event as CustomEvent<MusicPlayerStateDetail>).detail;
      setPlayback(detail);
      if (detail.paused === false) {
        hasStartedPlayback = true;
        setHasPlayed(true);
      }
    };
    const onError = (event: Event) => setError(String((event as CustomEvent).detail ?? ''));
    const onOpen = (event: Event) => {
      const detail = (event as CustomEvent<MusicPlayerOpenDetail>).detail;
      if (detail?.toggle && expandedRef.current) {
        collapse();
        return;
      }
      if (document.activeElement instanceof HTMLElement && !rootRef.current?.contains(document.activeElement)) {
        openerRef.current = document.activeElement;
      }
      setExpanded(true);
      expandedRef.current = true;
      setDetailsExpanded(detail?.view !== 'library');
    };
    const onPlay = () => { setError(''); setNotice(''); };
    const onClose = () => {
      hasStartedPlayback = false;
      setHasPlayed(false);
      expandedRef.current = false;
      setExpanded(false);
      setLyricsOpen(false);
    };
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
    expandedRef.current = expanded;
    window.dispatchEvent(new CustomEvent(musicPlayerPanelStateEventName, {detail: expanded}));
  }, [expanded]);

  useEffect(() => {
    const params = new URLSearchParams(location.search);
    if (params.get('music') !== 'open') return;
    params.delete('music');
    const frame = window.requestAnimationFrame(() => {
      dispatchMusicPlayerOpen({view: 'library'});
      history.replace({...location, search: params.toString() ? `?${params}` : ''});
    });
    return () => window.cancelAnimationFrame(frame);
  }, [location.search, history]);

  useEffect(() => {
    document.body.classList.remove('global-music-player-visible', 'global-music-player-collapsed');
    document.body.classList.toggle('music-player-active', expanded || (hasPlayed && isMobile));
    document.body.classList.toggle('music-player-expanded', expanded);
    return () => document.body.classList.remove('music-player-active', 'music-player-expanded');
  }, [expanded, hasPlayed, isMobile]);

  useEffect(() => {
    if (expanded) {
      setIsScrolling(false);
      return undefined;
    }

    const onScroll = () => {
      setIsScrolling(true);
      if (scrollTimer.current) clearTimeout(scrollTimer.current);
      scrollTimer.current = setTimeout(() => setIsScrolling(false), 700);
    };

    window.addEventListener('scroll', onScroll, {passive: true});
    return () => {
      window.removeEventListener('scroll', onScroll);
      if (scrollTimer.current) clearTimeout(scrollTimer.current);
    };
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
    if (!lyricsOpen) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented) return;
      event.preventDefault();
      setLyricsOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [lyricsOpen]);

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
  const errorMessage = error || playback?.error || '';
  const playButton = (large = false) => <IconButton label={errorMessage ? '重试播放' : !playback || playback.paused ? '播放' : '暂停'}
    className={large ? styles.primaryPlay : ''} onClick={() => dispatchMusicPlayerCommand({action: errorMessage ? 'retry' : 'toggle'})}>
    {errorMessage ? <RefreshIcon size={large ? 26 : 20} /> : !playback || playback.paused ? <PlayerIcon size={large ? 26 : 20} disableHover /> : <span className={styles.pauseGlyph} aria-hidden="true" />}
  </IconButton>;
  const loop = playback?.loop ?? 'all';
  const order = playback?.order ?? 'list';
  const nextLoop = loop === 'none' ? 'all' : loop === 'all' ? 'one' : 'none';
  const loopLabel = loop === 'none' ? '不循环，点击切换列表循环' : loop === 'all' ? '列表循环，点击切换单曲循环' : '单曲循环，点击关闭循环';
  const transport = <div className={styles.transport}>
    <IconButton label="上一首" onClick={() => dispatchMusicPlayerCommand({action: 'previous'})}><SkipIcon back /></IconButton>
    {playButton(true)}
    <IconButton label="下一首" onClick={() => dispatchMusicPlayerCommand({action: 'next'})}><SkipIcon /></IconButton>
  </div>;
  const tools = <div className={styles.tools}>
    <div className={styles.tool}>
    <IconButton label={order === 'list' ? '顺序播放，点击切换随机播放' : '随机播放，点击切换顺序播放'}
      className={styles.modeButton} pressed={order === 'random'}
      onClick={() => dispatchMusicPlayerCommand({action: 'order', value: order === 'list' ? 'random' : 'list'})}>
      {order === 'list' ? <ListIcon size={19} /> : <ShuffleIcon size={19} />}
    </IconButton><span>{order === 'random' ? '随机' : '顺序'}</span></div>
    <div className={styles.tool}>
    <IconButton label={loopLabel} className={styles.modeButton} pressed={loop !== 'none'}
      onClick={() => dispatchMusicPlayerCommand({action: 'loop', value: nextLoop})}>
      <span className={styles.loopIcon}><RefreshIcon size={19} />{loop === 'one' && <small>1</small>}</span>
    </IconButton><span>{loop === 'one' ? '单曲' : loop === 'all' ? '列表循环' : '不循环'}</span></div>
    <div className={styles.tool}>
      <Popover.Root open={volumeOpen} onOpenChange={({open}) => setVolumeOpen(open)}
        onEscapeKeyDown={(event) => {
          event.preventDefault();
          event.stopImmediatePropagation();
          setVolumeOpen(false);
        }}
        positioning={{placement: 'top', strategy: 'fixed'}} lazyMount unmountOnExit>
        <Popover.Trigger asChild><button type="button" className={styles.iconButton} aria-label="调整音量"><VolumeIcon size={19} /></button></Popover.Trigger>
        <Portal><Popover.Positioner><Popover.Content className={styles.volumePopover}>
          <Popover.Title>音量</Popover.Title>
          <input type="range" aria-label="音量" min="0" max="1" step="0.05" value={playback?.volume ?? 0.45}
            onChange={(event) => dispatchMusicPlayerCommand({action: 'volume', value: Number(event.target.value)})} />
        </Popover.Content></Popover.Positioner></Portal>
      </Popover.Root><span>音量</span>
    </div>
    <div className={styles.tool}><IconButton label="全屏歌词" onClick={openLyrics}><AlignCenterIcon size={19} /></IconButton><span>歌词</span></div>
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
  const status = (errorMessage || notice) && <div className={styles.status} role="status">
    <span>{errorMessage || notice}</span>
  </div>;
  const playbackState = playbackStatus(playback, error);
  const playbackLabel = !hasPlayed && playbackState.kind !== 'error' ? '尚未播放' : playbackState.label;
  const playbackDescription = error || playback?.error || `${playbackLabel}${playback?.artist ? ` · ${playback.artist}` : ''}`;

  return createPortal(<Dialog.Root open={expanded && !lyricsOpen} aria-label="音乐播放器" modal={isMobile} trapFocus={isMobile}
    preventScroll={isMobile} restoreFocus={false} closeOnInteractOutside unstyled
    ids={{content: 'music-player-panel'}}
    initialFocusEl={() => !isMobile
      ? rootRef.current?.querySelector<HTMLInputElement>('input[type="search"]') ?? collapseRef.current
      : collapseRef.current}
    onFocusOutside={(event) => event.preventDefault()}
    onEscapeKeyDown={(event) => {
      if (!volumeOpen) return;
      event.preventDefault();
      setVolumeOpen(false);
    }}
    onInteractOutside={(event) => {
      const target = event.detail.originalEvent.target;
      if (target instanceof Element && target.closest('[data-music-trigger]')) {
        event.preventDefault();
        return;
      }
      pointerDismissRef.current = event.detail.originalEvent.type.startsWith('pointer');
    }}
    onOpenChange={({open}) => { if (!open) collapse(); }}>
    {expanded && <Dialog.Backdrop asChild><div className={styles.scrim} /></Dialog.Backdrop>}
    <div ref={rootRef} hidden={!expanded && (!hasPlayed || !isMobile)} className={`${styles.player} ${expanded ? styles.expanded : ''} ${isScrolling ? styles.scrolling : ''}`}>
      {!expanded ? isMobile && <div className={styles.mini}>
        <button ref={expandRef} type="button" className={styles.miniTrack} aria-label="展开音乐播放器"
          aria-haspopup="dialog" onClick={() => dispatchMusicPlayerOpen()}>
          <span className={styles.miniVinyl} aria-hidden="true"><MusicIcon ref={vinylRef} size={26} strokeWidth={1.8} disableHover /></span>
          <span className={styles.miniText}><strong title={playback?.title}>{playback?.title || '音乐'}</strong><span title={playbackDescription}>{playbackDescription}</span></span>
        </button>
        {playback && playButton()}
        {playback && <IconButton label="下一首" onClick={() => dispatchMusicPlayerCommand({action: 'next'})}><SkipIcon /></IconButton>}
        <IconButton label="停止播放并收起" onClick={dismiss}><XIcon size={16} disableHover /></IconButton>
        {playback && <div className={styles.miniProgress} style={progressStyle} />}
        {!expanded && error && <span className={styles.errorDot} title={error} aria-label={error} />}
      </div> : <Dialog.Content asChild><section ref={panelRef} aria-label="音乐播放器" data-details-expanded={detailsExpanded && hasPlayed} className={styles.panel}>
        <header className={styles.header}>
          <Dialog.Title className={styles.headerTitle}>音乐</Dialog.Title>
          <button ref={collapseRef} type="button" className={styles.iconButton} aria-label="收起播放器并继续播放" title="收起面板" onClick={collapse}><XIcon size={18} disableHover /></button>
        </header>
        <div className={styles.view} data-music-scroll role="region" aria-label="选歌">
          <div id="global-music-panel" className={styles.library}>
            <Suspense fallback={<p role="status">正在加载音乐…</p>}><MusicLibrary compact /></Suspense>
          </div>
        </div>
        {status}
        {playback && hasPlayed && <Collapsible.Root asChild open={detailsExpanded}
          onOpenChange={({open}) => setDetailsExpanded(open)} lazyMount unmountOnExit>
          <footer className={styles.footer}>
            <div className={styles.footerSummary}>
              <Collapsible.Trigger asChild>
                <button type="button" className={styles.footerTrack} aria-label={`${detailsExpanded ? '收起' : '展开'}播放控制：${playback.title}`}>
                  <Cover src={playback.cover} />
                  <span className={styles.footerText}><strong title={playback.title}>{playback.title}</strong><span title={playbackDescription}>{playbackDescription}</span></span>
                  <svg className={styles.expandChevron} width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true"><path d="m6 15 6-6 6 6" /></svg>
                </button>
              </Collapsible.Trigger>
              {!detailsExpanded && <>{playButton()}<IconButton label="下一首" onClick={() => dispatchMusicPlayerCommand({action: 'next'})}><SkipIcon /></IconButton></>}
            </div>
            <Collapsible.Content className={styles.playbackDetails} role="region" aria-label="播放控制">
              <div className={styles.playbackDetailsInner}>{progress}{transport}{tools}</div>
            </Collapsible.Content>
            {!detailsExpanded && <div className={styles.miniProgress} style={progressStyle} />}
          </footer>
        </Collapsible.Root>}
      </section></Dialog.Content>}
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
      <img src={staticAssetUrl(playback?.cover) || defaultCover} alt="" className={styles.lyricBackdrop} />
      <div className={`${styles.lyricHeader} ${!controlsVisible ? styles.quiet : ''}`}>
        <div><strong>{playback?.title}</strong><span>{playback?.artist}</span></div>
        <IconButton label="关闭全屏歌词" onClick={() => setLyricsOpen(false)}><XIcon size={20} disableHover /></IconButton>
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
  </Dialog.Root>, document.body);
}
