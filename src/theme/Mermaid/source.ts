export type BeautifulDiagram = {
  source: string;
  kind: 'flowchart' | 'state' | 'sequence' | 'class' | 'er' | 'xychart';
  title?: string;
  description?: string;
};

export function getBeautifulDiagram(value: string): BeautifulDiagram | null {
  if (/^[ \t]*%% renderer: mermaid\s*$/m.test(value) || /%%\{/.test(value)) return null;

  let source = value.trim().replace(/\r\n/g, '\n');
  const frontMatter = source.match(/^---\n([\s\S]*?)\n---(?:\n|$)/);
  if (frontMatter) {
    const layoutKeys = /^(?:config|flowchart|sequence|useMaxWidth|nodeSpacing|rankSpacing|padding|actorMargin|width|wrap):/;
    if (frontMatter[1].split('\n').some(line => {
      const setting = line.trim();
      return setting && !setting.startsWith('#') && !layoutKeys.test(setting);
    })) return null;
    source = source.slice(frontMatter[0].length);
  }

  source = source.replace(/^[ \t]*%%[^\n]*(?:\n|$)/gm, '').trim();
  const header = source.split('\n')[0].trim();
  let kind: BeautifulDiagram['kind'];
  if (/^(?:flowchart|graph)\s+(?:TD|TB|LR|BT|RL)$/i.test(header)) kind = 'flowchart';
  else if (/^stateDiagram(?:-v2)?$/i.test(header)) kind = 'state';
  else if (/^sequenceDiagram$/i.test(header)) kind = 'sequence';
  else if (/^classDiagram$/i.test(header)) kind = 'class';
  else if (/^erDiagram$/i.test(header)) kind = 'er';
  else if (/^xychart(?:-beta)?(?:\s+horizontal)?$/i.test(header)) kind = 'xychart';
  else return null;

  if (/^[ \t]*(?:click|box|autonumber|activate|deactivate|create|destroy|links?)\b/m.test(source)
    || source.includes(';')
    || /@\{|<(?:a|img)\b/i.test(source)) return null;

  const title = source.match(/^[ \t]*accTitle:\s*([^\n]*)/m)?.[1];
  const description = source.match(/^[ \t]*accDescr:\s*([^\n]*)/m)?.[1]
    ?? source.match(/^[ \t]*accDescr\s*\{([\s\S]*?)^[ \t]*\}/m)?.[1].trim();
  source = source
    .replace(/^[ \t]*accDescr\s*\{[\s\S]*?^[ \t]*\}\s*$/gm, '')
    .replace(/^[ \t]*acc(?:Title|Descr):[^\n]*$/gm, '')
    .replace(/^([ \t]*subgraph\s+[\w-]+\s*\[)"(.*)"(\][ \t]*)$/gm, '$1$2$3')
    .trim();

  return {source, kind, title, description};
}
