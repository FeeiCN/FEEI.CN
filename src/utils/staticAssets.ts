export const STATIC_ASSET_ORIGIN = 'https://feei.cn';

export function staticAssetUrl(value: string): string;
export function staticAssetUrl(value: string | undefined): string | undefined;
export function staticAssetUrl(value: string | undefined): string | undefined {
  if (!value || /^(?:[a-z][a-z\d+.-]*:|\/\/|#)/i.test(value)) return value;
  const path = value.replace(/^(?:\.\.?\/)+/, '').replace(/^\/?static\//, '/');
  return /^\/?(?:media|music|img|data)\//.test(path)
    ? `${STATIC_ASSET_ORIGIN}/${path.replace(/^\//, '')}`
    : value;
}

export function staticAssetSrcSet(value: string | undefined): string | undefined {
  return value?.replace(/(^\s*|,\s*)(\/?(?:static\/)?(?:media|music|img|data)\/[^\s,]+)/g,
    (_match, separator: string, url: string) => `${separator}${staticAssetUrl(url)}`);
}
