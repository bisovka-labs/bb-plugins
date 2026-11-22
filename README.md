# Bisovka bb plugins

Every [bb](https://getbb.app) plugin and improvement by Eugene Bisovka, in one
repository that is also a bb marketplace.

## Set up bb the way I use it

[`SETUP.md`](SETUP.md) is a step-by-step guide for an agent (in Russian): my plugins, the
third-party plugins I use daily, Russian voice input, and private phone access to bb over
Tailscale that keeps working under a VPN. Give your agent this link:
`https://raw.githubusercontent.com/bisovka-labs/bb-plugins/main/SETUP.md`.
Scripts it uses live in [`setup/`](setup/).

## Install

Add the marketplace once; the plugins then show up in bb's plugin store:

```sh
bb marketplace add git:https://github.com/bisovka-labs/bb-plugins.git@main
```

Or install everything from a checkout (bb asks to confirm each plugin):

```sh
git clone https://github.com/bisovka-labs/bb-plugins.git && cd bb-plugins
scripts/install.sh            # all plugins
scripts/install.sh todo openui  # only these
```

`bb plugin update --all` pulls new releases later.

## Plugins

| Plugin | What it does |
| --- | --- |
| `agent-stats` | Shareable story cards with your agent sessions and tokens. |
| `blur-titles` | Sidebar button that blurs thread titles for screenshots. |
| `context-folder` | Attach an extra folder or bb project to a message as context. |
| `copy-code` | Tap inline code in a chat message to copy it. |
| `copy-file` | Copy file button in the file viewer (macOS clipboard). |
| `copy-image` | Right-click an image in the desktop app to copy it. |
| `dictation-pause` | Pauses Mac music while you dictate in bb. |
| `duo-layout` | Wide touch screens (unfolded phone, iPad): finger-sized controls. |
| `handoff` | Move a session between agents and machines (fork of [vburojevic's Handoff](https://github.com/vburojevic/bb-plugin-handoff)). |
| `hide-empty-projects` | Projects without active threads hide from the thread list. |
| `image-zoom` | Zoom and pan in bb's image viewer. |
| `openui` | Renders OpenUI generative UI inline in assistant messages. |
| `phone-dictation` | iPhone Action button starts a bb thread from speech. |
| `recent-threads` | Sidebar view of threads you wrote in during the last hours. |
| `resume-interrupted` | Sends «продолжи» to threads a bb restart interrupted. |
| `safari` | Agents drive your real Safari: tabs, reading, clicks, forms, screenshots. |
| `sidebar-button` | Phone: sidebar button and swipes on thread rows. |
| `sidebar-swipe` | Phone: edge swipe opens the thread list. |
| `tap-to-dictate` | Phone: one tap on the mic starts dictation. |
| `todo` | Personal todo list in the sidebar that agents can add to. |

Each plugin's own `README.md` covers its settings and requirements.

## bb.app patches

`app-patches/` holds macOS patches to the bb.app bundle for things the plugin
API cannot do yet. They are fragile by nature: each one checks that the bundle
still has the shape it expects and stops otherwise.

```sh
app-patches/install.sh
```

copies them to `~/.bb/patches` and installs a LaunchAgent that re-applies them
after every bb update.

`attachment-limit.py` raises the attachment limit from 35 MB to 2 GiB so videos
attach. `install.sh` also registers `video-cleanup/video-cleanup.py`, which
every six hours deletes attached videos older than 7 days (both bb's copy and
the agent's copy; voice recordings are kept). Put another number of days in
`~/.bb/patches/video-cleanup/video-cleanup.days`; `--dry-run` lists without
deleting.

## License

MIT, see `LICENSE`. `handoff/` keeps its own MIT license.
