export function sidebarLabel(label: string): {name: string; number?: string} {
  const standard = label.match(/^((?:GB(?:\/[TZ])?|G[MA]\/T)\s+\d+(?:\.\d+)*[-—–]\d{4})\s+(.+)$/);
  if (!standard) return {name: label};
  const name = standard[2].replace(/^信息安全技术\s*/, '').trim();
  return {name: name || standard[2], number: standard[1]};
}
