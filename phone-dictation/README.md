# bb-plugin-phone-dictation

Кнопка Action на iPhone → запись голоса → новая сессия bb с расшифровкой в качестве промпта.

Шорткат «BB голосом» (3 действия):

1. **Записать аудио**: начало «Сразу», конец «По нажатию».
2. **Получить содержимое URL**: POST,
   `http://<tailnet-IP Mac>:18080/api/v1/plugins/phone-dictation/http/new?token=<bb plugin token phone-dictation>`,
   тело запроса «Файл» = записанное аудио.
3. **Открыть URL**: содержимое URL (плагин отвечает ссылкой на сессию по адресу из настройки `appUrl`, например `https://<имя>.getbb.app`).

`<tailnet-IP Mac>:18080` — tailnet-IP Mac с bb, а `tailscale serve` пробрасывает его на сервер bb (127.0.0.1:38886).
Имя `<mac>.*.ts.net` bb отвергает (`forbidden_host`), а IP-адреса пропускает. На телефоне должен быть включён Tailscale.

Расшифровка идёт через голосовой сервис, выбранный в bb (`bb settings ai-services`).
Проект задаёт настройка `project` (по умолчанию Personal), разово его можно переопределить через `&project=<proj_id>` в URL.
Тело `text/plain` уходит как готовый текст, без расшифровки.

Сборка: `npm install && bb plugin build && bb plugin install . --yes`; после правок `bb plugin reload phone-dictation`.
