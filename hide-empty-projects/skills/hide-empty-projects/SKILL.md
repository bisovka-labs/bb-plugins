---
name: hide-empty-projects
description: Explains why a project disappeared from the bb sidebar or moved into More (Hide Empty Projects plugin) and how to bring it back.
---

# Hide Empty Projects

The Hide Empty Projects plugin hides sidebar project groups that have no
active (unarchived) threads by adding `project:<projectId>` to the Thread
list's `hiddenGroups` preference and also hides them inside More. Empty means
no unpinned, unarchived root thread in the project: children show under their
parent's project, pinned threads in Pinned. When a thread is
created or unarchived in such a project, the plugin removes the key again.
Projects are never deleted and stay in the new-thread project picker.

- In the UI: the last row of More, «Показать пустые проекты (N)», lists the
  hidden empty projects until the menu closes.
- See what is hidden: `bb thread-list prefs get hiddenGroups --json`.
- Show one empty project: `bb thread-list prefs set hiddenGroups` without its
  `project:<id>` key (it is not listed in More). The plugin leaves an empty
  project shown by hand alone until it gets a thread.
- Show everything: `bb thread-list prefs reset hiddenGroups`. The plugin hides
  empty projects again on its next sync (within 5 minutes); disable the
  plugin (`bb plugin disable hide-empty-projects`) to stop it.
- Projects hidden by hand while they have threads are never unhidden.
