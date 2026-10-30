// Pure part of Hide Empty Projects: given the projects, which of them have
// active threads, the sidebar's hiddenGroups and what this plugin remembers,
// decide the next hiddenGroups.

export interface State {
  /** Projects this plugin hid; only these does it ever show again. */
  autoHidden: string[];
  /** Empty projects the user brought back by hand; left alone until they get a thread. */
  keepVisible: string[];
}

export interface Plan {
  hiddenGroups: string[];
  state: State;
  changed: boolean;
}

export const groupKey = (projectId: string) => `project:${projectId}`;

export function plan(
  projectIds: readonly string[],
  busy: ReadonlySet<string>,
  hiddenGroups: readonly string[],
  prev: State | null,
): Plan {
  const hidden = new Set(hiddenGroups);
  // First run: projects already hidden while empty count as ours, so they
  // come back on their own once they get a thread.
  const auto = new Set(prev ? prev.autoHidden : projectIds.filter((id) => !busy.has(id) && hidden.has(groupKey(id))));
  const keep = new Set(prev?.keepVisible ?? []);

  for (const id of projectIds) {
    const key = groupKey(id);
    if (busy.has(id)) {
      keep.delete(id);
      if (auto.delete(id)) hidden.delete(key);
      continue;
    }
    if (auto.has(id) && !hidden.has(key)) {
      // The user chose "Show in list" for an empty project we had hidden.
      auto.delete(id);
      keep.add(id);
    }
    if (keep.has(id) || hidden.has(key)) continue;
    hidden.add(key);
    auto.add(id);
  }

  // Forget projects that no longer exist.
  const known = new Set(projectIds);
  for (const id of auto) if (!known.has(id)) auto.delete(id);
  for (const id of keep) if (!known.has(id)) keep.delete(id);

  const next = [...hidden];
  return {
    hiddenGroups: next,
    state: { autoHidden: [...auto].sort(), keepVisible: [...keep].sort() },
    changed: next.length !== hiddenGroups.length || next.some((key, i) => key !== hiddenGroups[i]),
  };
}
