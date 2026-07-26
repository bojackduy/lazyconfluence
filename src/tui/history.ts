import type { PageViewMode } from "../model"

export type NavigationLocation = {
  spaceKey: string
  pageViewMode: PageViewMode
  pageId: string
  expandedPageIds: string[]
  scrollLeft: number
  scrollTop: number
}

export function pushNavigationLocation(history: NavigationLocation[], location: NavigationLocation, limit = 100) {
  return [...history, location].slice(-limit)
}

export function popNavigationLocation(history: NavigationLocation[]) {
  if (!history.length) return { history, location: null }

  return { history: history.slice(0, -1), location: history.at(-1) ?? null }
}
