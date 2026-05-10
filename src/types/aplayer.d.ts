declare module 'aplayer' {
  export type LoopMode = 'all' | 'one' | 'none';
  export type OrderMode = 'list' | 'random';
  export type PreloadMode = 'none' | 'metadata' | 'auto';

  export interface Audio {
    name: string;
    artist: string;
    url: string;
    cover?: string;
    lrc?: string;
    theme?: string;
  }

  export interface Options {
    container: HTMLElement;
    audio: Audio | Audio[];
    autoplay?: boolean;
    fixed?: boolean;
    loop?: LoopMode;
    order?: OrderMode;
    preload?: PreloadMode;
    volume?: number;
    mutex?: boolean;
    listFolded?: boolean;
    listMaxHeight?: string;
    lrcType?: number;
    theme?: string;
  }

  export default class APlayer {
    constructor(options: Options);
    destroy(): void;
  }
}
