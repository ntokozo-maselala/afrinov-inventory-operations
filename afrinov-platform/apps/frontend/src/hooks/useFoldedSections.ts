// Menu sections a person has folded away, remembered in this browser. A
// convenience only: nothing is stored on the server, and an unreadable store
// just means every section starts open.
import { useCallback, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { isNavItemActive, type NavItem } from './useNavGroups';

const STORAGE_KEY = 'afrinov.nav.folded';

function readFolded(): Set<string> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const list: unknown = raw ? JSON.parse(raw) : [];
    return new Set(Array.isArray(list) ? list.filter((x): x is string => typeof x === 'string') : []);
  } catch {
    return new Set();
  }
}

function writeFolded(folded: Set<string>): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify([...folded]));
  } catch {
    // Private windows and blocked storage: it is only remembered for this visit.
  }
}

/** A section folds only when there is something to fold: a single entry, or none yet, stays put. */
export const isFoldable = (group: { items: unknown[] }): boolean => group.items.length > 1;

/**
 * Which sections are open, and a way to fold or open one. The section holding
 * the page being shown opens whenever the page changes, so its highlighted
 * entry is never hidden; it can still be folded by hand until the next page.
 */
export function useFoldedSections(groups: Array<{ title: string; items: Array<Pick<NavItem, 'to' | 'end' | 'exact' | 'excludes'>> }>) {
  const { pathname } = useLocation();
  const activeTitle = groups.find((g) => g.items.some((i) => isNavItemActive(i, pathname)))?.title;
  const [folded, setFolded] = useState<Set<string>>(() => {
    const stored = readFolded();
    if (activeTitle) stored.delete(activeTitle);
    return stored;
  });

  // On a new page, open its section if it was folded (React's "adjust state
  // while rendering" pattern, as elsewhere in the app).
  const [seenPath, setSeenPath] = useState(pathname);
  if (seenPath !== pathname) {
    setSeenPath(pathname);
    if (activeTitle && folded.has(activeTitle)) {
      const next = new Set(folded);
      next.delete(activeTitle);
      setFolded(next);
      writeFolded(next);
    }
  }

  const toggle = useCallback((title: string) => {
    setFolded((current) => {
      const next = new Set(current);
      if (next.has(title)) next.delete(title);
      else next.add(title);
      writeFolded(next);
      return next;
    });
  }, []);

  const isOpen = (group: { title: string; items: unknown[] }) => !isFoldable(group) || !folded.has(group.title);
  return { isOpen, toggle };
}
