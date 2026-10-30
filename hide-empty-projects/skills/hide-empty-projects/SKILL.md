---
name: hide-empty-projects
description: Explains why a project disappeared from the bb sidebar or moved into More (Hide Empty Projects plugin) and how to bring it back.
---

# Hide Empty Projects

The Hide Empty Projects plugin hides sidebar project groups that have no
active (unarchived) threads by adding `project:<projectId>` to the Thread
list's `hiddenGroups` preference, so they sit under More. When a thread is
created or unarchived in such a project, the plugin removes the key again.
Projects are never deleted and stay in the new-thread project picker.

- See what is hidden: `bb thread-list prefs get hiddenGroups --json`.
- Show one project: its menu under More → Show in list. The plugin leaves an
  empty project shown by hand alone until it gets a thread.
- Show everything: `bb thread-list prefs reset hiddenGroups`. The plugin hides
  empty projects again on its next sync (within 5 minutes); disable the
  plugin (`bb plugin disable hide-empty-projects`) to stop it.
- Projects hidden by hand while they have threads are never unhidden.
