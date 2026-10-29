# Agent Inbox

A widget and navigation panel inside bb for Eugene to review existing agent replies one at a time. Inspired by Agentbox, implemented independently with the public bb SDK.

Assumptions from the request: use existing bb threads and live attention state; preserve bb styling, permissions, providers and environments. Keep running work separate from ready replies, pending input and queued-send errors. Review and snooze state belongs to the current browser. No separate runtime or automatic merging.

Success: select a live item, inspect and reply with host-owned ThreadChat, explicitly dismiss a completed reply, or postpone one hour. A newer attention event returns the item. Mobile switches between queue and chat with Back.

Surface mode: Operate. Incumbent authority: bb theme tokens and scaffolded bb controls. Local extension of bb, no new visual identity.
