import type {Plugin} from '@docusaurus/types';

export default function developmentMemoryPlugin(): Plugin {
  return {
    name: 'development-memory-plugin',
    configureWebpack(config, isServer, {currentBundler}) {
      if (isServer || config.mode !== 'development' || currentBundler.name !== 'rspack') return;

      // The dev server already serves static/ from disk; copying it also keeps
      // large media files in Rspack and the in-memory output filesystem.
      const {CopyRspackPlugin} = currentBundler.instance as unknown as typeof import('@rspack/core');
      config.plugins = config.plugins?.filter((plugin) => !(plugin instanceof CopyRspackPlugin));

      return {
        devtool: process.env.DOCUSAURUS_DEV_SOURCE_MAPS === 'true' ? config.devtool : false,
      };
    },
  };
}
