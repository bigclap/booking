from fastapi import FastAPI, HTTPException, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse

MESSAGES = {
    "rpc_payload_too_large": "Данные слишком большие для сервиса. Уменьшите размер подложек плана.",
    "assistant_unconfigured": "Помощник пока не настроен. Обратитесь к администратору.",
    "assistant_busy": "Дождитесь ответа на предыдущее сообщение.",
    "chat_archived": "Этот диалог в архиве. Начните новый.",
    "chat_not_found": "Диалог не найден.",
    "generation_not_found": "Запрос помощника не найден.",
    "assistant_message_too_long": "Сократите сообщение.",
    "floor_not_found": "Этаж не найден.",
    "resource_not_found": "Ресурс не найден.",
    "authentication_required": "Войдите в систему.",
    "validation_error": "Проверьте заполненные поля.",
    "session_invalid": "Сессия завершена. Войдите снова.",
    "access_expired": "Нужно обновить сессию.",
    "access_invalid": "Сессия недействительна. Войдите снова.",
    "invalid_credentials": "Неверный логин или пароль.",
    "administrator_required": "Это действие доступно только администратору.",
    "building_not_found": "Офис не найден или недоступен.",
    "user_not_found": "Пользователь не найден.",
    "login_already_exists": "Такой логин уже существует.",
    "current_password_incorrect": "Текущий пароль неверен.",
    "upstream_unavailable": "Сервис временно недоступен. Попробуйте ещё раз.",
    "upstream_contract_invalid": "Сервис вернул данные в неподдерживаемом формате.",
    "office_document_unavailable": "Для этого офиса ещё не сохранён полный план.",
    "invalid_office_document": "Проверьте план офиса: размеры, идентификаторы и связи помещений.",
    "office_identifier_conflict": "Идентификатор плана уже используется другим офисом.",
    "origin_not_allowed": "Запрос пришёл с недопустимого адреса.",
    "origin_required": "Не удалось подтвердить источник запроса.",
    "revision_required": "Загрузите актуальную запись и передайте её версию.",
    "invalid_revision": "Укажите корректную версию записи.",
    "revision_mismatch": "Версии в If-Match и теле запроса отличаются.",
    "office_revision_conflict": "Офис уже изменён. Загрузите актуальный план перед повтором.",
    "booking_revision_conflict": "Бронь уже изменена. Загрузите её актуальную версию.",
    "office_import_conflict": "В этом офисе уже другой план. Импорт не перезаписывает его.",
    "idempotency_key_required": "Для подтверждения нужен ключ идемпотентности.",
    "idempotency_key_reused": "Этот ключ подтверждения уже использован с другими параметрами.",
    "idempotency_key_conflict": "Этот ключ импорта уже использован с другими параметрами.",
    "booking_owner_required": "Изменять чужие брони может только администратор.",
    "booking_owner_unavailable": "Нельзя создать бронь для отключённого сотрудника.",
    "booking_owner_office_required": "У выбранного сотрудника нет доступа к этому офису.",
    "booking_not_found": "Бронь не найдена.",
    "booking_conflict": "Этот ресурс уже занят на выбранное время.",
    "resource_unavailable": "Этот ресурс сейчас недоступен для бронирования.",
    "outside_working_hours": "Интервал должен находиться в рабочих часах офиса.",
    "outside_booking_horizon": "Дата находится вне доступного периода бронирования.",
    "invalid_booking_interval": "Укажите корректный интервал с действующим шагом времени.",
    "booking_start_in_past": "Начало не может быть раньше ближайшего доступного шага времени.",
    "booking_end_in_past": "Окончание должно быть в будущем.",
    "participants_required": "Укажите число участников переговорной.",
    "participants_not_applicable": "Число участников указывается только для переговорной.",
    "current_booking_end_only": "У начавшейся брони можно менять только окончание.",
    "booking_cancelled": "Эта бронь уже отменена.",
    "booking_completed": "Эта бронь уже завершилась.",
    "events_unavailable": "Обновления временно недоступны. Переподключитесь и загрузите состояние.",
}
FIELD_NAMES = {
    "first_name": "firstName",
    "last_name": "lastName",
    "building_ids": "buildingIds",
    "current_password": "current",
}


def install_error_handlers(app: FastAPI) -> None:
    @app.exception_handler(HTTPException)
    async def http_error(request: Request, exc: HTTPException) -> JSONResponse:
        detail: dict[str, object] = exc.detail if isinstance(exc.detail, dict) else {}
        code = detail.get("code", "request_failed")
        if not isinstance(code, str):
            code = "request_failed"
        extra: dict[str, object] = {}
        if isinstance(detail.get("current_revision"), int):
            extra["currentRevision"] = detail["current_revision"]
        field_map = {
            "booking_conflict": ["start", "end"],
            "outside_working_hours": ["start", "end"],
            "invalid_booking_interval": ["start", "end"],
            "booking_start_in_past": ["start"],
            "booking_end_in_past": ["end"],
            "outside_booking_horizon": ["date"],
            "participants_required": ["participants"],
            "participants_not_applicable": ["participants"],
            "resource_unavailable": ["resourceId"],
        }
        if code in field_map:
            extra["fields"] = [
                {"field": field, "message": MESSAGES[code]} for field in field_map[code]
            ]
        return JSONResponse(
            {
                "code": code,
                "message": MESSAGES.get(code, "Не удалось выполнить запрос."),
                "requestId": getattr(request.state, "request_id", None),
                **extra,
            },
            status_code=exc.status_code,
            headers={"Cache-Control": "no-store"},
        )

    @app.exception_handler(RequestValidationError)
    async def invalid_request(request: Request, exc: RequestValidationError) -> JSONResponse:
        return JSONResponse(
            {
                "code": "validation_error",
                "message": "Проверьте заполненные поля.",
                "fields": [
                    {
                        "field": ".".join(str(part) for part in error["loc"][1:]),
                        "message": error["msg"],
                    }
                    for error in exc.errors()
                ],
                "requestId": getattr(request.state, "request_id", None),
            },
            status_code=422,
            headers={"Cache-Control": "no-store"},
        )
