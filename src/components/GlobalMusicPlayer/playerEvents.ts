export const musicPlayerPlayEventName = 'feei:music-player-play';
export const musicPlayerStateEventName = 'feei:music-player-state';

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
  window.dispatchEvent(new CustomEvent<MusicPlayerPlayDetail>(musicPlayerPlayEventName, {detail}));
};

export const dispatchMusicPlayerState = (detail: MusicPlayerStateDetail) => {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent<MusicPlayerStateDetail>(musicPlayerStateEventName, {detail}));
};
