# Users: реализация и граница интеграции

Users хранит учётные записи, веб-сессии и надёжные операции отзыва доступа
в своей PostgreSQL БД. Проверки публичных прав выполняет Gateway;
служебные HTTP-маршруты закрыты ключом и переиспользуются обработчиком Core NATS.

## Операции отзыва доступа

Отключение пользователя или отзыв здания сохраняет одной транзакцией профиль,
`access_operations` со статусом `pending` и событие outbox. Существующие
`workplace.users.user_disabled` и `workplace.users.building_access_revoked`
содержат дополнительные поля:

- `operation_id`: UUID операции;
- `reason`: `user_disabled` или `building_access_revoked`;
- `correlation_id`: ID запроса;
- `user_id` и прежняя область `building_ids` либо `except_building_ids`.

Ответ PATCH пользователя возвращает заголовок `X-Access-Operation-ID`.
Gateway может получить состояние через `GET /internal/access-operations/{id}`
или список `GET /internal/access-operations?user_id=...&limit=50`.
Эти маршруты предназначены для административного BFF; права проверяет Gateway.
Статус `pending` не выдаётся за завершённую отмену броней. В ответе также доступны
состояние публикации outbox, число попыток и безопасный тип ошибки.

Booking после локального commit публикует через свой outbox событие
`workplace.booking.access_revocation_completed` с полями `operation_id`,
`user_id`, `cancelled_count`, `terminated_count`. Workers Users запускается
командой `python -m workplace_users.booking_events`. Он сохраняет receipt
и результат одной транзакцией, затем подтверждает JetStream; сбой даёт повтор.
Повтор receipt или новый event ID для уже завершённой операции не меняет результат.
Неизвестный ID/пользователь отклоняется без receipt и без ложного завершения.

## Веб-учётные записи

Логины нормализуются и уникальны в БД; удаление сохраняет `active=false`.
Пароли хешируются Argon2id. Refresh хранится как SHA-256 случайного токена,
не имеет календарного истечения; JWT живёт 120 секунд. Смена/сброс пароля
сохраняют причину отзыва. Вход и refresh сериализуются с изменением пароля
и отключением по строке пользователя. Ошибки валидации не отражают исходный
ввод, который может содержать пароль или токен.

## OAuth/MCP

Используется стандартный MCP SDK provider из интеграционной задачи
(`mcp_auth.py`, `mcp_auth_provider.py`, `mcp_models.py`), вторая система OAuth
не добавляется. При настроенном `MCP_ENCRYPTION_KEY` приложение Users монтирует
`/oauth` в lifespan и предоставляет OAuth-маршруты для проксирования Gateway.
Браузерная форма и обычные Users-операции доступны и без настройки MCP.
Для встроенного Assistant служебный вход —
`POST /internal/mcp/delegate` с проверенным Gateway `X-User-ID`, `X-Session-ID`;
проверка MCP — `POST /internal/mcp/introspect` с `token`, `resource`.

OAuth-коды и непрозрачные MCP-токены связаны с Users-сессией. Поэтому отзыв
сессий при отключении/смене/сбросе пароля немедленно делает их непригодными
для MCP introspection, refresh и обмена кода. Публичный Gateway применяет
этот контракт; короткий веб-JWT сохраняет ранее принятое окно действия.

`0004_access_operations` следует за интеграционной `0003_mcp_oauth`.
Миграции не расходятся на несколько heads. Профиль хранит `updated_at`,
веб-/OAuth-сессии — причину отзыва. Секреты не включаются в диагностические ответы.

## Проверки

12.11.2026, отдельный Docker test-стенд:

```sh
docker compose -f compose.test.yaml run --rm --no-deps tests pytest -q \
  apps/users/tests/test_auth.py apps/users/tests/test_security.py \
  apps/users/tests/test_operations.py
```

**28 passed**: обычная авторизация, сессии без календарного предела,
двухминутный JWT, разные виды отзыва, конкурентные нормализованные логины,
конкуренция старого пароля со сбросом, сохранение остальных сессий при выходе,
безопасная валидация и устойчивые административные результаты с повторами,
а также подключение SDK OAuth/delegation/introspection к настоящему Users app.

Отдельно:

```sh
docker compose -f compose.test.yaml run --rm --no-deps tests pytest -q \
  apps/users/tests/test_mcp_oauth_integration.py
```

**14 passed**: официальный OAuth/PKCE через loopback HTTP и реальную БД,
клиентские credentials, повтор/конкуренция кода, refresh и отзыв семейства,
делегирование, отзыв сессий и проверки resource/redirect/CSRF.
Ruff check и format check для `apps/users` прошли 12.11.2026.

Эта заметка не подтверждает готовность публичного OAuth/MCP или внешнего клиента.
Проверка MCP SDK ведётся отдельно с реальными PostgreSQL и loopback HTTP;
публичный HTTPS и сторонний внешний клиент требуют проверки после деплоя.
