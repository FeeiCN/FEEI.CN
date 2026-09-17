import {lazy, Suspense, useEffect, useRef, useState} from 'react';
import {useHistory, useLocation} from '@docusaurus/router';
import {MusicIcon} from '@site/src/components/ItsHoverIcon';
import {
  dispatchMusicPlayerOpen,
  musicPlayerCloseEventName,
  musicPlayerErrorEventName,
  musicPlayerOpenEventName,
  musicPlayerPlayEventName,
  musicPlayerStateRequestEventName,
} from './playerEvents';
import styles from './controls.module.css';

const MusicLibrary = lazy(() => import('@site/src/components/MusicLibrary'));
const playerCollapsedBodyClassName = 'global-music-player-collapsed';

function SelectorReady() {
  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      const coarsePointer = window.matchMedia('(pointer: coarse)').matches;
      if (!coarsePointer && window.innerWidth > 640) {
        document.querySelector<HTMLInputElement>('#global-music-panel input[type="search"]')?.focus();
      }
      window.dispatchEvent(new CustomEvent(musicPlayerStateRequestEventName));
    });
    return () => window.cancelAnimationFrame(frame);
  }, []);
  return null;
}

export default function Controls() {
  const [open, setOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const [error, setError] = useState('');
  const panelRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const location = useLocation();
  const history = useHistory();

  const setPlayerCollapsed = (nextCollapsed: boolean) => {
    document.body.classList.toggle(playerCollapsedBodyClassName, nextCollapsed);
    setCollapsed(nextCollapsed);
  };

  const closePanel = () => {
    setOpen(false);
    window.requestAnimationFrame(() => triggerRef.current?.focus({preventScroll: true}));
  };

  useEffect(() => {
    setCollapsed(document.body.classList.contains(playerCollapsedBodyClassName));
  }, []);

  useEffect(() => {
    const onOpen = () => {
      setPlayerCollapsed(false);
      setOpen(true);
      setError('');
    };
    const onClose = () => {
      setPlayerCollapsed(false);
      setOpen(false);
      setError('');
    };
    const onPlay = () => {
      setPlayerCollapsed(false);
      closePanel();
    };
    const onError = (event: Event) => {
      const message = (event as CustomEvent<unknown>).detail;
      setError(typeof message === 'string' ? message : '播放失败，请重试。');
    };
    window.addEventListener(musicPlayerOpenEventName, onOpen);
    window.addEventListener(musicPlayerCloseEventName, onClose);
    window.addEventListener(musicPlayerPlayEventName, onPlay);
    window.addEventListener(musicPlayerErrorEventName, onError);
    return () => {
      window.removeEventListener(musicPlayerOpenEventName, onOpen);
      window.removeEventListener(musicPlayerCloseEventName, onClose);
      window.removeEventListener(musicPlayerPlayEventName, onPlay);
      window.removeEventListener(musicPlayerErrorEventName, onError);
    };
  }, []);

  useEffect(() => {
    const params = new URLSearchParams(location.search);
    if (params.get('music') !== 'open') return;
    params.delete('music');
    const search = params.toString();
    const frame = window.requestAnimationFrame(() => {
      setPlayerCollapsed(false);
      dispatchMusicPlayerOpen();
      history.replace({...location, search: search ? `?${search}` : ''});
    });
    return () => window.cancelAnimationFrame(frame);
  }, [location.search, history]);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Node) || panelRef.current?.contains(target) || triggerRef.current?.contains(target)) return;
      setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      if (panelRef.current?.querySelector('[role="dialog"]')) return;
      if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement) return;
      event.preventDefault();
      closePanel();
    };
    document.addEventListener('pointerdown', onPointerDown);
    window.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  return (
    <div className={styles.controls}>
      {error && <div className={styles.error} role="status">{error}</div>}
      {open && (
        <div ref={panelRef} id="global-music-panel" className={styles.panel} role="dialog" aria-label="音乐歌单">
          <div className={styles.header}>
            <strong>音乐</strong>
            <button type="button" className={styles.closeButton} aria-label="关闭音乐歌单" onClick={closePanel}>×</button>
          </div>
          <div className={styles.content}>
            <Suspense fallback={<p role="status">正在加载歌单…</p>}>
              <MusicLibrary />
              <SelectorReady />
            </Suspense>
          </div>
        </div>
      )}
      <div className={styles.actions}>
        <button
          ref={triggerRef}
          type="button"
          className={styles.trigger}
          aria-label="打开音乐播放器"
          aria-expanded={open}
          aria-controls="global-music-panel"
          aria-haspopup="dialog"
          title="音乐"
          onClick={() => {
            if (open) {
              closePanel();
              return;
            }
            setPlayerCollapsed(false);
            dispatchMusicPlayerOpen();
          }}>
          <MusicIcon size={20} disableHover />
          <span className={styles.triggerLabel}>选歌</span>
        </button>
        <button
          type="button"
          className={styles.collapse}
          aria-label="收起播放器并继续播放"
          title="收起播放器，继续播放"
          onClick={() => {
            setOpen(false);
            setError('');
            setPlayerCollapsed(true);
          }}>
          收起
        </button>
      </div>
    </div>
  );
}
