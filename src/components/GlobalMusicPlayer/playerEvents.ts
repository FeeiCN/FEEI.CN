export const musicPlayerPlayEventName = 'feei:music-player-play';
export const musicPlayerStateEventName = 'feei:music-player-state';
export const musicPlayerOpenEventName = 'feei:music-player-open';
export const musicPlayerCloseEventName = 'feei:music-player-close';
export const musicPlayerStateRequestEventName = 'feei:music-player-state-request';
export const musicPlayerErrorEventName = 'feei:music-player-error';

export type MusicPlayerPlayDetail = {
  groupId: string;
  trackIndex?: number;
  showList?: boolean;
};

export type MusicPlayerStateDetail = {
  groupId: string;
  trackIndex: number;
};

export const dispatchMusicPlayerPlay = (detail: MusicPlayerPlayDetail) => {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent<MusicPlayerPlayDetail>(musicPlayerPlayEventName, {detail}));
};

export const dispatchMusicPlayerState = (detail: MusicPlayerStateDetail) => {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent<MusicPlayerStateDetail>(musicPlayerStateEventName, {detail}));
};

export const dispatchMusicPlayerOpen = () => {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent(musicPlayerOpenEventName));
};

export const dispatchMusicPlayerClose = () => {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent(musicPlayerCloseEventName));
};
