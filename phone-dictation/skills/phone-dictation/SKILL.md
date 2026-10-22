---
name: phone-dictation
description: "How the iPhone Action button starts a bb thread by voice through the phone-dictation plugin: the HTTP route, its token, settings, and the Shortcut."
---

# Phone Dictation

The iPhone Shortcut «BB голосом» records audio and POSTs it to
`http://<mac-tailnet-ip>:18080/api/v1/plugins/phone-dictation/http/new?token=<token>`.
Port 18080 on the tailnet is `tailscale serve` forwarding to the bb server on
127.0.0.1:38886, so the phone needs Tailscale connected.

- Audio body (any non-`text/*` content type): transcribed with bb's current
  voice service (`bb settings ai-services`), then used as the prompt.
- `text/plain` body: used as the prompt as is.
- `?project=<proj_id>` overrides the project; otherwise the `project` setting,
  otherwise Personal.
- Reply: `text/plain` URL of the new thread on `appUrl`
  (e.g. `https://<name>.getbb.app`; when unset, just the thread path). 400 empty body, 422 empty transcript.

Token: `bb plugin token phone-dictation`; `--rotate` invalidates the old one,
after which the Shortcut's URL must be updated.
Settings: `bb plugin config phone-dictation [set project <proj_id> | set appUrl <url>]`.
