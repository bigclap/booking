# Контракт подключения фронтенда

Состояние на 12.11.2026: HTTP-брони, версии планов, импорт и SSE подключены
в локальном dev через Nginx. Фронтенд находится в `apps/frontend`.
Браузерный архив сохраняется отдельно от серверных данных.

## Вход в dev

На чистой Users-БД администратор автоматически не создаётся.
Команда явного bootstrap:

```bash
BOOTSTRAP_ADMIN_LOGIN=admin BOOTSTRAP_ADMIN_PASSWORD='выбранный-вами-пароль' make bootstrap
```

Также можно задать эти значения в игнорируемом `.env`; затем `make bootstrap`.
Пустой `BOOTSTRAP_ADMIN_PASSWORD` не создаёт запись. Повтор bootstrap не меняет
существующую учётную запись и её пароль. Старый браузерный демо-пароль не является
серверной учётной записью. Весь трафик идёт через `http://localhost:5178`.

## Брони — согласуемый контракт подключения

- `GET /api/offices/{officeId}/bookings` возвращает **все даты** этого офиса.
  Фильтры: `date=YYYY-MM-DD` либо `dateFrom=...&dateTo=...`, границы включены.
- `POST` туда же: `{floorId,resourceId,date,start,end,participants?,ownerId?}`.
  Обязателен `Idempotency-Key` — UUID одной осознанной отправки. Сохранить ключ
  при сетевой неопределённости и повторе; изменённые параметры с тем же ключом — 409.
- `PATCH /api/offices/{officeId}/bookings/{id}`: изменяемые поля плюс `revision`.
  Если `ownerId` отсутствует, владелец сохраняется. Назначать другого владельца
  может администратор. `ownerName`, `status` и `id` в команды не передаются.
- `POST .../{id}/cancel`: `{revision}`.
- В качестве альтернативы body `revision` принимается `If-Match: "N"`;
  при наличии обоих значения обязаны совпасть.

Ответ — `ClientBooking` в camelCase плюс `revision:number`, `needsReview:boolean`.
Также возвращаются `reviewReasons:string[]`, `resourceSnapshot` (снимок Booking),
`cancellationReason?`, `warnings` — причина пересмотра, исторические параметры
ресурса и предупреждение превышения вместимости. Ключи внутри resourceSnapshot
сохраняют служебный snake_case снимка; публичное имя поля — camelCase.
Сотрудник создаёт для себя, изменяет/отменяет свои записи; администратор — чужие.
Имя владельца собирает Gateway по Users. На создание переговорной нужен participants.
У обычных записей start/end — целые минуты. Только историческое окончание
досрочно завершённой текущей брони может быть дробным: ресурс освобождается
точно сейчас, без округления к следующему шагу.

Конфликт — 409 `booking_conflict`; устаревшая версия — 409
`booking_revision_conflict` с `currentRevision`; отсутствующая версия — 428.
Одна устаревшая запись не перезаписывает новую автоматически: загрузить актуальную
и предложить пользователю повторное действие. Обычные ошибки имеют
`code/message/fields?/requestId`.

## Офисы, импорт и версии

Серверные `OfficeConfig` получают `revision:number`. PATCH `/settings` и PUT `/plan`
принимают body `revision` либо `If-Match: "N"`. Ответ содержит новую версию и ETag.
Нет версии — 428, устарела — 409 `office_revision_conflict` с `currentRevision`.

`POST /api/offices/import`: `{document: OfficeConfig}` и `Idempotency-Key`.
Только администратор; импорт сохраняет office/floor/item IDs и полную геометрию.
Повтор ключа не создаёт дубль и не перезаписывает последующие правки офиса.
Существующий офис с отличающимся документом — 409 `office_import_conflict`.
Пользователи и брони браузерного архива автоматически не импортируются и
не переназначаются серверному администратору.

## SSE

`GET /api/events`, авторизация той же HttpOnly cookie. Сначала `event: ready`,
`data: {"snapshotRequired":true}`: подписка уже активна, после этого загрузить
HTTP-снимки. Last-Event-ID не воспроизводит историю.

- `booking.changed`: `{officeId,bookingId,revision,operation}`.
- `office.changed`: `{officeId,revision?}`.
- `chat.changed`: `{sessionId,archivedSessionId?,revision?}`, только текущий пользователь.
  При архивировании после брони `sessionId:null`, `archivedSessionId` задан:
  перечитать current и архив, новый диалог автоматически не создаётся.
- `resync`: `{snapshotRequired:true}` — перечитать снимки.
- `auth.expired`: `{refreshRequired:true}` — закрыть EventSource, вызвать refresh,
  затем подключиться заново. Сам поток закрывается при истечении JWT.

Это уведомления об изменении, не замена HTTP-снимков. События скрытых офисов
не отдаются. Heartbeat — комментарий раз в 15 секунд. Для переподключения всегда
повторить цикл ready → загрузка снимков, не использовать long polling.

## Чат и MCP

Контракт подключён. Локальный production smoke от 12.11.2026 прошёл
через Nginx, включая настоящий OAuth PKCE → MCP и обновление/отзыв токенов:

- `POST /api/chats/{id}/messages`, body `{message,context:{officeId,floorId?,date?}}`,
  обязательный `Idempotency-Key`. Ответ 202: `{request,session,messages}`.
- `GET /api/generations/{id}` возвращает тот же снимок. Поля `request` и `session`
  сохраняют существующий snake_case формат Assistant, `request.result` содержит
  `{message,proposal?}`. Proposal: `{officeId,floorId,resourceId,date?,start?,end?,participants?,url?}`.
- Proposal сохраняется также в сообщении ассистента и возвращается `GET /api/chats/{id}`,
  поэтому восстанавливается после reload и в архиве. SSE служит сигналом перечитать снимок.
- Подтверждающая ссылка точно: `/booking?officeId=…&floorId=…&resourceId=…&date=YYYY-MM-DD&start=…&end=…&participants=…`.
  start/end — целые минуты; необязательные поля пропускаются. Только открытие нашей
  формы, никакого автоматического создания. Прошедшую дату очищаем, время сохраняем.

Без модели или ключа capabilities возвращает `generationAvailable=false`,
отправка — 503 `assistant_unconfigured`; это проверено в изолированном prod smoke.
Живой OpenRouter проверен отдельно в [локальном прогоне](live-assistant.md).
Prod smoke не вызывает платную модель и не меняет dev окружение.

Административный режим HTTP подключён: Gateway после проверки роли передаёт
Booking `administrative:true`; MCP этот режим не получает, включая admin login.
Шаг, расписание и конфликты действуют в обоих случаях.

## Граница сервисов

Gateway отвечает за HTTP BFF, employee facade, MCP SDK и OAuth proxy.
Users/Booking/Assistant владеют своими данными, инвариантами и обработчиками
NATS. `mcp_auth*.py`, `mcp_models.py`, `generation_*.py` и runtime образуют
одну реализацию без второго OAuth/LLM стека. Users подключает официальный
OAuth provider.

Параметры: `PUBLIC_BASE_URL` — канонический origin, issuer `${PUBLIC_BASE_URL}/oauth`,
resource `${PUBLIC_BASE_URL}/mcp`; отдельный `MCP_ENCRYPTION_KEY`, access 600 секунд,
refresh 30 дней (независимо от бессрочного веб-входа). Внутренние delegate/introspect
используют Core NATS; внешний OAuth/MCP сохраняет стандартный HTTP протокол.

Итог интеграции сервисов:

- Booking принимает в JSON create/update/cancel доверенный `administrative: boolean`
  (строго bool, по умолчанию false). Режим по D-042 позволяет исправить прошлые
  даты/даты за горизонтом и начало/ресурс начавшейся брони; шаг, расписание,
  корректность ресурса и конфликты обязательны. Отмена прошлой записи не растягивает
  её интервал до текущего времени. Gateway назначает `true` только после проверки
  роли HTTP; MCP всегда передаёт false и допускает только собственные записи.
  Пользовательское тело запроса не может назначить этот внутренний флаг.
  Контракт и 72 проверки Booking: [booking-service](booking-service.md).
- Runtime принимает абсолютную ссылку prepare_booking только с origin
  `PUBLIC_BASE_URL` (внешнему клиенту нужна открываемая ссылка) либо относительную
  `/booking?...`; предложение может быть частичным по D-118/D-119.
  Изменение реализовано и проверено в сервисном чате.
- Delegate в generation_worker использует ServiceTransport/Core NATS по D-124;
  MCPToolset по-прежнему обращается к HTTP Gateway.
- assistant-generations и users-booking-events включены в оба Compose
  и devcontainer. Для них используются те же настройки и образы, что и для
  соответствующих API; dev-БД хранится в собственных volumes.

Gateway также публикует только для администратора `GET /api/access-operations`
и `GET /api/access-operations/{id}` (snake_case Users snapshot). PATCH пользователя
сохраняет `X-Access-Operation-ID` из Users; фоновая отмена до receipt остаётся pending.
Публичный OAuth-прокси пропускает только фиксированные SDK-маршруты, а CORS
OAuth/metadata обрабатывает SDK. Доверенные заголовки клиента отбрасываются.
