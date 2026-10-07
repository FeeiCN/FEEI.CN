import {createSystem, defaultConfig} from '@chakra-ui/react';

export const feeiSystem = createSystem({...defaultConfig, globalCss: {}}, {
  preflight: false,
  theme: {
    tokens: {
      fonts: {
        body: {value: 'var(--ifm-font-family-base)'},
        heading: {value: 'var(--ifm-font-family-base)'},
      },
    },
    semanticTokens: {
      colors: {
        bg: {
          DEFAULT: {value: 'var(--ifm-background-color)'},
          panel: {value: 'var(--ifm-background-surface-color)'},
          muted: {value: 'var(--ifm-color-emphasis-100)'},
        },
        fg: {
          DEFAULT: {value: 'var(--ifm-font-color-base)'},
          muted: {value: 'var(--ifm-color-emphasis-700)'},
        },
        border: {DEFAULT: {value: 'var(--ifm-color-emphasis-300)'}},
      },
    },
  },
});

// 空 reset 层在 SSR 中会序列化成无效的 @layer reset，吞掉后续动画定义。
feeiSystem._global = feeiSystem._global.filter((styles) => {
  const reset = styles['@layer reset'];
  return !(reset && Object.keys(reset).length === 0 && Object.keys(styles).length === 1);
});
