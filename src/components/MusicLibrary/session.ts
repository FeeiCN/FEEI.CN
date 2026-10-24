export type LibrarySession = {
  groupId: string;
  artist: string;
  query: string;
  scrollTop: number;
};

const storageKey = 'feei-music-library-session-v1';
let session: LibrarySession | undefined;

export function readLibrarySession(defaultGroupId: string): LibrarySession {
  if (session) return session;
  const fallback = {groupId: defaultGroupId, artist: '', query: '', scrollTop: 0};
  try {
    const value = JSON.parse(window.sessionStorage.getItem(storageKey) ?? 'null');
    session = value && typeof value.groupId === 'string' && typeof value.artist === 'string'
      && typeof value.query === 'string' && Number.isFinite(value.scrollTop) && value.scrollTop >= 0
      ? value : fallback;
  } catch { session = fallback; }
  return session!;
}

export function saveLibrarySession(value: LibrarySession) {
  session = value;
  try { window.sessionStorage.setItem(storageKey, JSON.stringify(value)); } catch {}
}
