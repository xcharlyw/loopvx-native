import { useEffect, type MutableRefObject } from 'react';

/** What the arrow keys work on: the visible rows of the open list, in order, and what Enter / → / ← do with them. */
export interface NavList {
  ids: string[];
  activate: (id: string) => void;
  /** What a tap on the row does (select, and audition when the preview is on); default: select only. */
  pick?: (id: string) => void;
  /** → : open a folder or a device's presets; true when it did something. */
  open?: (id: string) => boolean;
  /** ← : back to the parent folder, or fold the device; true when it did something. */
  back?: (id: string | null) => boolean;
}

/** Hands the list's rows to the browser's keys (after every render, so they are always the visible ones). */
export function useNav(nav: MutableRefObject<NavList | null>, list: NavList) {
  useEffect(() => {
    nav.current = list;
  });
}
