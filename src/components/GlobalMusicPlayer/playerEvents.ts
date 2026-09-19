export const musicPlayerPlayEventName = 'feei:music-player-play';
export const musicPlayerStateEventName = 'feei:music-player-state';
export const musicPlayerOpenEventName = 'feei:music-player-open';
export const musicPlayerCloseEventName = 'feei:music-player-close';
export const musicPlayerStateRequestEventName = 'feei:music-player-state-request';
export const musicPlayerErrorEventName = 'feei:music-player-error';
export const musicPlayerCommandEventName = 'feei:music-player-command';

export type MusicPlayerCommand =
  | {action: 'toggle' | 'retry' | 'previous' | 'next'}
  | {action: 'seek'; value: number}
  | {action: 'queue-next' | 'queue-add'; track: Audio}
  | {action: 'queue-play' | 'queue-remove' | 'track'; value: number}
  | {action: 'volume'; value: number}
  | {action: 'loop'; value: 'all' | 'one' | 'none'}
  | {action: 'order'; value: 'list' | 'random'};

export const dispatchMusicPlayerCommand = (detail: MusicPlayerCommand) => {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent(musicPlayerCommandEventName, {detail}));
};

export type MusicPlayerPlayDetail = {
  groupId: string;
  trackIndex?: number;
  showList?: boolean;
};

export type MusicPlayerStateDetail = {
  groupId: string;
  trackIndex: number;
  paused?: boolean;
  title?: string;
  trackUrl?: string;
  artist?: string;
  cover?: string;
  currentTime?: number;
  duration?: number;
  loading?: boolean;
  lyrics?: Array<[number, string]>;
  queue?: Audio[];
  tracks?: Audio[];
  volume?: number;
  loop?: 'all' | 'one' | 'none';
  order?: 'list' | 'random';
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
import type {Audio} from 'aplayer';
