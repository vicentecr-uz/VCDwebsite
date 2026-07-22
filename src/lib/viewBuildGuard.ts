import { isViewBuild } from './views';

/** Redirect legacy/static routes that should not exist on employer view builds. */
export function redirectIfViewBuildBlocked(): { redirect: string } | undefined {
  if (isViewBuild()) {
    return { redirect: '/404' };
  }
  return undefined;
}
