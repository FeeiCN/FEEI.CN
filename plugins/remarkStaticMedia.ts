import {staticAssetSrcSet, staticAssetUrl} from '../src/utils/staticAssets';

type Node = {
  type: string;
  name?: string;
  url?: string;
  value?: string;
  attributes?: Array<{name?: string; value?: unknown}>;
  children?: Node[];
};

const mediaElements = new Set(['img', 'video', 'audio', 'source', 'track']);

export default function remarkStaticMedia() {
  return (tree: Node) => {
    const visit = (node: Node) => {
      if (['image', 'imageReference', 'definition', 'link'].includes(node.type) && node.url) {
        node.url = staticAssetUrl(node.url);
      }
      if (mediaElements.has(node.name ?? '')) {
        for (const attribute of node.attributes ?? []) {
          if (typeof attribute.value !== 'string') continue;
          if (attribute.name === 'src' || attribute.name === 'poster') {
            attribute.value = staticAssetUrl(attribute.value);
          } else if (attribute.name?.toLowerCase() === 'srcset') {
            attribute.value = staticAssetSrcSet(attribute.value);
          }
        }
      }
      if (node.type === 'html' && node.value) {
        node.value = node.value.replace(/<(?:img|video|audio|source|track)\b[^>]*>/gi, (tag) => (
          tag.replace(/\b(src|poster|srcset)=(['"])([\s\S]*?)\2/gi, (_match, name: string, quote: string, url: string) => (
            `${name}=${quote}${name.toLowerCase() === 'srcset' ? staticAssetSrcSet(url) : staticAssetUrl(url)}${quote}`
          ))
        ));
      }
      node.children?.forEach(visit);
    };
    visit(tree);
  };
}
