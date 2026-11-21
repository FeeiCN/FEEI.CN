import {mkdir, writeFile} from 'node:fs/promises';
import {dirname, join} from 'node:path';
import type {Plugin} from '@docusaurus/types';
import {siteShareImagePath} from '../src/utils/staticAssets';

// 1200 × 630 PNG based on the F mark in static/img/feei-icon.svg.
const shareImage = Buffer.from([
  'iVBORw0KGgoAAAANSUhEUgAABLAAAAJ2AQMAAAB1jukfAAAABlBMVEURERH/',
  '///YdsArAAAA9UlEQVR42u3ZIRUAIBAFwd8/FZFoABaBPME7ZhKs3wQAAAAA',
  'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAB6WxeyZMmSJUuWLFmyZMmS',
  'JUuWLFmyZMmSJUuWLFmyZJVljTxGlixZsmTJkiVLlixZsmTJkiVLlixZsmTJ',
  'apx1mLJkyZIlS5YsWbJkyZIlS5YsWbJkyZIlS5YsWbJkFWYZd7JkyZIlS5Ys',
  'WbJkyZIlS5YsWbJkyZIlS5YsWbJkyZIlS5YsWbJkyZIlS5YsWbJkyZIlq1cW',
  'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA/GgDv3HMZ22QApkAAAAASUVO',
  'RK5CYII=',
].join(''), 'base64');

export default function siteShareImagePlugin(): Plugin {
  return {
    name: 'site-share-image',
    async postBuild({outDir}) {
      const outputPath = join(outDir, siteShareImagePath);
      await mkdir(dirname(outputPath), {recursive: true});
      await writeFile(outputPath, shareImage);
    },
  };
}
