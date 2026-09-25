import React from 'react';
import MDXComponents from '@theme-original/MDXComponents';
import ResponsiveTable from '@site/src/components/ResponsiveTable';

const components = {
  ...MDXComponents,
  table: ResponsiveTable,
};

export default components;
