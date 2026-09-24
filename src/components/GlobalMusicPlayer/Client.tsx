import {useEffect, useRef, useState} from 'react';
import type APlayerInstance from 'aplayer';
import type {Audio, Options} from 'aplayer';
import {buildAllDerivedGroups, playlistGroupFromManifest, siteMusicGroups} from './playlist';
import type {PlaylistGroup, PlaylistManifestGroup} from './playlist';
import Controls from './Controls';
import styles from './styles.module.css';
import {
  dispatchMusicPlayerState,
  musicPlayerCloseEventName,
  musicPlayerCommandEventName,
  musicPlayerErrorEventName,
  musicPlayerOpenEventName,
  musicPlayerPlayEventName,
  musicPlayerStateRequestEventName,
} from './playerEvents';
import type {MusicPlayerCommand, MusicPlayerPlayDetail} from './playerEvents';

type Engine = APlayerInstance & {
  audio: HTMLAudioElement;
  list: {index: number; audios: Audio[]; switch: (index: number) => void; add: (audio: Audio) => void; remove: (index: number) => void};
  lrc: {current: Array<[number, string]>; update: () => void};
  options: {loop: 'all' | 'one' | 'none'; order: 'list' | 'random'};
  on: (event: string, callback: () => void) => void;
  pause: () => void;
  play: () => void;
  seek: (time: number) => void;
  volume: (volume: number) => void;
  skipBack: () => void;
  skipForward: () => void;
  nextIndex: () => number;
  randomOrder: number[];
  setAudio: (audio: Audio) => void;
  setUIPaused: () => void;
};
type Preferences = {loop: 'all' | 'one' | 'none'; order: 'list' | 'random'; volume: number};
type StoredState = {activeGroupId?: string; settings?: Preferences; groups?: Record<string, {trackUrl: string; currentTime: number}>};
const storageKey = 'feei-global-music-player-state-v1';
const initialGroups = [...siteMusicGroups, ...buildAllDerivedGroups(siteMusicGroups)];

// A single audio engine survives document layout remounts and route changes.
let engine: Engine | null = null;
let mount: HTMLDivElement | null = null;
let activeGroup: PlaylistGroup | null = null;
let loading = false;
let generation = 0;
let preferences: Preferences = {loop: 'all', order: 'list', volume: 0.45};

function readStoredState(): StoredState {
  try {
    const value = JSON.parse(window.localStorage.getItem(storageKey) ?? '{}');
    return value && typeof value === 'object' && !Array.isArray(value) ? value as StoredState : {};
  } catch { return {}; }
}

function persist() {
  if (!engine || !activeGroup) return;
  const track = engine.list.audios[engine.list.index];
  if (!track) return;
  try {
    const state = readStoredState();
    window.localStorage.setItem(storageKey, JSON.stringify({
      ...state, activeGroupId: activeGroup.id, settings: preferences,
      groups: {...state.groups, [activeGroup.id]: {trackUrl: track.url, currentTime: Math.floor(engine.audio.currentTime || 0)}},
    }));
  } catch {}
}

function reportError(message: string) {
  window.dispatchEvent(new CustomEvent(musicPlayerErrorEventName, {detail: message}));
}

function reportState() {
  if (!engine || !activeGroup) return;
  const track = engine.list.audios[engine.list.index];
  const lyrics = engine.lrc?.current ?? [];
  dispatchMusicPlayerState({
    groupId: activeGroup.id, trackIndex: engine.list.index,
    title: track?.name ?? '', trackUrl: track?.url, artist: track?.artist ?? '', cover: track?.cover,
    paused: engine.audio.paused, currentTime: engine.audio.currentTime || 0,
    duration: Number.isFinite(engine.audio.duration) ? engine.audio.duration : 0,
    volume: engine.audio.volume, loop: preferences.loop, order: preferences.order,
    loading, lyrics: lyrics.filter(([time]) => typeof time === 'number'),
    tracks: activeGroup.tracks,
  });
}

function play(player: Engine) {
  reportError('');
  void player.audio.play().catch((error: unknown) => {
    if (engine !== player || (error instanceof DOMException && error.name === 'AbortError')) return;
    player.setUIPaused();
    loading = false;
    reportError(player.audio.error ? '音频暂不可用，请重试或选择另一首。' : '暂时无法播放，请点击重试。');
    reportState();
  });
}

async function prepare(group: PlaylistGroup, requestedIndex?: number, autoplay = false) {
  const request = ++generation;
  if (!engine) {
    const saved = readStoredState().settings;
    if (saved && ['all', 'one', 'none'].includes(saved.loop) && ['list', 'random'].includes(saved.order)
      && Number.isFinite(saved.volume) && saved.volume >= 0 && saved.volume <= 1) preferences = {...saved};
  }
  persist();
  if (!mount) {
    mount = document.createElement('div');
    mount.className = styles.engine;
    mount.setAttribute('aria-hidden', 'true');
    mount.inert = true;
    document.body.appendChild(mount);
  }
  if (!engine || activeGroup?.id !== group.id) {
    const {default: APlayer} = await import('aplayer') as unknown as {default: new (options: Options) => Engine};
    if (request !== generation) return;
    engine?.destroy();
    mount.replaceChildren();
    activeGroup = group;
    loading = false;
    const player = new APlayer({container: mount, audio: group.tracks.map((track) => ({...track})),
      autoplay: false, loop: preferences.loop, order: preferences.order, volume: preferences.volume,
      preload: 'metadata', mutex: false, lrcType: 3, listFolded: true});
    engine = player;
    // APlayer's setAudio auto-plays without handling rejection; pause first.
    const setAudio = player.setAudio.bind(player);
    player.setAudio = (track) => {
      const resume = !player.audio.paused;
      player.pause();
      setAudio(track);
      if (resume) play(player);
    };
    player.play = () => play(player);
    // Keep the proven LRC parser, but render and position lyrics in React.
    if (player.lrc) player.lrc.update = () => window.requestAnimationFrame(() => { if (engine === player) reportState(); });
    player.audio.addEventListener('error', (event) => {
      event.stopImmediatePropagation();
      if (engine !== player) return;
      player.pause();
      loading = false;
      reportError('音频暂不可用，请重试或选择另一首。');
      reportState();
    }, {capture: true});
    for (const name of ['play', 'pause', 'seeked', 'ended', 'volumechange', 'durationchange', 'loadedmetadata']) {
      player.on(name, () => { if (engine === player) { persist(); reportState(); } });
    }
    for (const name of ['waiting', 'loadstart']) player.on(name, () => { if (engine === player) { loading = true; reportState(); } });
    for (const name of ['canplay', 'playing']) player.on(name, () => { if (engine === player) { loading = false; reportState(); } });
    player.on('listswitch', () => {
      if (engine !== player) return;
      reportError('');
      window.requestAnimationFrame(() => { if (engine === player) { persist(); reportState(); } });
    });
    let lastSavedSecond = -1;
    player.on('timeupdate', () => {
      if (engine !== player) return;
      reportState();
      const second = Math.floor(player.audio.currentTime);
      if (second !== lastSavedSecond && second % 5 === 0) { lastSavedSecond = second; persist(); }
    });
    const saved = readStoredState().groups?.[group.id];
    const savedIndex = saved ? group.tracks.findIndex((track) => track.url === saved.trackUrl) : -1;
    if (requestedIndex === undefined && saved && savedIndex >= 0) {
      player.list.switch(savedIndex);
      const savedTime = Number.isFinite(saved.currentTime) ? Math.max(0, saved.currentTime) : 0;
      let restored = false;
      const restore = () => {
        if (engine !== player || restored || !Number.isFinite(player.audio.duration) || player.audio.duration <= 0) return;
        restored = true;
        player.seek(Math.min(savedTime, Math.max(0, player.audio.duration - 1)));
        reportState();
      };
      player.on('loadedmetadata', restore);
      restore();
    }
  }
  if (request !== generation || !engine) return;
  if (requestedIndex !== undefined) {
    const index = Number.isInteger(requestedIndex) && requestedIndex >= 0 && requestedIndex < group.tracks.length ? requestedIndex : 0;
    engine.list.switch(index);
  }
  if (autoplay) play(engine);
  reportState();
}

export default function GlobalMusicPlayerClient() {
  const [groups, setGroups] = useState(initialGroups);
  const [resolved, setResolved] = useState(false);
  const pendingPlay = useRef<MusicPlayerPlayDetail | null>(null);
  const pendingOpen = useRef(false);
  const manifestLoad = useRef<Promise<void> | null>(null);

  const loadManifest = () => {
    if (manifestLoad.current) return manifestLoad.current;
    manifestLoad.current = fetch('/music/baby-music/manifest.json')
      .then(async (response) => {
        if (!response.ok) return;
        const manifest = await response.json() as PlaylistManifestGroup[];
        if (!Array.isArray(manifest)) return;
        const base = [...siteMusicGroups, ...manifest.map(playlistGroupFromManifest)];
        setGroups([...base, ...buildAllDerivedGroups(base)]);
      })
      .catch(() => {})
      .finally(() => setResolved(true));
    return manifestLoad.current;
  };

  useEffect(() => {
    const onPlay = (event: Event) => {
      const detail = (event as CustomEvent<MusicPlayerPlayDetail>).detail;
      if (!resolved) {
        pendingPlay.current = detail;
        void loadManifest();
        return;
      }
      const group = groups.find((item) => item.id === detail?.groupId);
      if (!group) { reportError('未找到这个歌单，请重试。'); return; }
      void prepare(group, detail.trackIndex ?? 0, true).catch(() => reportError('播放器加载失败，请重试。'));
    };
    const onOpen = () => {
      if (engine) { reportState(); return; }
      if (!resolved) {
        pendingOpen.current = true;
        void loadManifest();
        return;
      }
      const savedId = readStoredState().activeGroupId;
      const savedGroup = groups.find((item) => item.id === savedId);
      const group = savedGroup ?? groups[0];
      if (group) void prepare(group).catch(() => reportError('播放器加载失败，请重试。'));
    };
    const onClose = () => { generation++; pendingPlay.current = null; pendingOpen.current = false; engine?.pause(); persist(); };
    const onCommand = (event: Event) => {
      if (!engine) return;
      const command = (event as CustomEvent<MusicPlayerCommand>).detail;
      if (command.action === 'toggle') { if (engine.audio.paused) play(engine); else engine.pause(); }
      else if (command.action === 'retry') { engine.audio.load(); play(engine); }
      else if (command.action === 'previous') engine.skipBack();
      else if (command.action === 'next') engine.skipForward();
      else if (command.action === 'seek') {
        const duration = engine.audio.duration;
        if (Number.isFinite(duration)) engine.seek(Math.max(0, Math.min(duration, command.value)));
      } else if (command.action === 'volume') { preferences.volume = command.value; engine.volume(command.value); }
      else if (command.action === 'loop' || command.action === 'order') {
        Object.assign(preferences, {[command.action]: command.value});
        Object.assign(engine.options, {[command.action]: command.value});
      }
      else if (command.action === 'track' && command.value >= 0 && command.value < engine.list.audios.length) {
        engine.list.switch(command.value); play(engine);
      }
      persist(); reportState();
    };
    window.addEventListener(musicPlayerPlayEventName, onPlay);
    window.addEventListener(musicPlayerOpenEventName, onOpen);
    window.addEventListener(musicPlayerCloseEventName, onClose);
    window.addEventListener(musicPlayerCommandEventName, onCommand);
    window.addEventListener(musicPlayerStateRequestEventName, reportState);
    window.addEventListener('pagehide', persist);
    if (resolved && pendingPlay.current) {
      const detail = pendingPlay.current;
      pendingPlay.current = null; pendingOpen.current = false;
      onPlay(new CustomEvent(musicPlayerPlayEventName, {detail}));
    } else if (resolved && pendingOpen.current) { pendingOpen.current = false; onOpen(); }
    reportState();
    return () => {
      window.removeEventListener(musicPlayerPlayEventName, onPlay);
      window.removeEventListener(musicPlayerOpenEventName, onOpen);
      window.removeEventListener(musicPlayerCloseEventName, onClose);
      window.removeEventListener(musicPlayerCommandEventName, onCommand);
      window.removeEventListener(musicPlayerStateRequestEventName, reportState);
      window.removeEventListener('pagehide', persist);
    };
  }, [groups, resolved]);
  return <Controls />;
}
