# Agent Inbox for bb

Native bb plugin inspired by the inbox workflow in [Agentbox](https://github.com/savannahfeder/agentbox). Independently implemented with the public bb SDK; no Agentbox source or assets are included.

Open **Agent Inbox** in sidebar navigation (or More) or the **Входящие от агентов** widget on the new-thread screen.

- Ready replies, pending questions/approvals and failed queued sends form the inbox. Running threads have a separate view.
- Filter by project or title. Select a thread to use bb's actual `ThreadChat`, including its composer and interactions.
- **Разобрано** marks the thread read and dismisses this attention event. It neither archives nor merges anything. Pending interactions and failed queued sends must be resolved first.
- **Позже · 1 ч** snoozes the current event for an hour. New attention cancels the snooze.
- Review/snooze state is local to this browser and synced across its tabs. Opening the chat does not dismiss the inbox item. Archived, deleted and hidden threads are removed.
- Only unread replies observed while this plugin is mounted are captured; it does not reconstruct already-read history. Status/attention comes from bb, not an AI summary.

No new agent runtime, polling server, account, or external service. Existing threads retain their providers, permissions, environments and worktrees.

```sh
npm install --include=dev
npm run typecheck
npm test
bb plugin build
bb plugin install . --yes
```

MIT. Agentbox is a separate GPL-3.0 project; this plugin borrows the workflow idea only.
