# bb-plugin-copy-image

Right-click an image in the bb desktop app → **Copy Image** (PNG to the
clipboard) or **Copy Image Address**.

bb's native context menu has no image items and plugins can't extend it, so a
frontend content script replaces it on `<img>` targets only. In a browser tab
the native browser menu is left alone.

```sh
npm install
bb plugin build
bb plugin install .
```
