import type {MusicPlayerStateDetail} from './playerEvents';

export function playbackStatus(state: MusicPlayerStateDetail | null, error = '') {
  if (error || state?.error) return {kind: 'error', label: '加载失败'};
  if (!state) return {kind: 'idle', label: '尚未播放'};
  if (state.loading && !state.paused) return {kind: 'loading', label: '加载中'};
  if (state.paused) return {kind: 'paused', label: '已暂停'};
  return {kind: 'playing', label: '播放中'};
}
