'use client';

/**
 * There is no theme toggle. The application is light, and the one dark screen
 * (the admin live board) is dark by design rather than by preference: it opts
 * in with <ThemeScope theme="dark">. Kept as a component so the import sites
 * that still reference it keep compiling.
 */
export function ThemeToggle() {
  return null;
}
