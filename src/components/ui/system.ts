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
