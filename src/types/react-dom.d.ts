declare module 'react-dom' {
  import type {ReactNode, ReactPortal} from 'react';

  export function createPortal(
    children: ReactNode,
    container: Element | DocumentFragment,
    key?: string | null,
  ): ReactPortal;
}

declare module 'react-dom/client' {
  import type {ReactNode} from 'react';

  export interface Root {
    render(children: ReactNode): void;
    unmount(): void;
  }

  export function createRoot(container: Element | DocumentFragment): Root;
}
