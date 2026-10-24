import React from 'react';
import MDXComponents from '@theme-original/MDXComponents';
import ResponsiveTable from '@site/src/components/ResponsiveTable';
import {StaticAudio, StaticSource, StaticVideo} from '@site/src/components/StaticMedia';

const components = {
  ...MDXComponents,
  table: ResponsiveTable,
  video: StaticVideo,
  audio: StaticAudio,
  source: StaticSource,
};

export default components;
