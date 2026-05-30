declare module 'justified-layout' {
  interface Dimensions {
    width: number;
    height: number;
  }

  interface Box {
    aspectRatio: number;
    top: number;
    left: number;
    width: number;
    height: number;
    forcedAspectRatio?: boolean;
  }

  interface Options {
    containerWidth?: number;
    containerPadding?: number | { top: number; right: number; bottom: number; left: number };
    boxSpacing?: number | { horizontal: number; vertical: number };
    targetRowHeight?: number;
    targetRowHeightTolerance?: number;
    maxNumRows?: number;
    forceAspectRatio?: boolean | number;
    showWidows?: boolean;
    fullWidthBreakoutRowCadence?: boolean | number;
    widowLayoutStyle?: 'left' | 'justify' | 'center';
  }

  interface Result {
    containerHeight: number;
    widowCount: number;
    boxes: Box[];
  }

  function justifiedLayout(input: Dimensions[] | number[], options?: Options): Result;
  export = justifiedLayout;
}
