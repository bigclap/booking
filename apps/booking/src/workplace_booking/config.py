from pydantic import Field
from workplace_platform.config import ServiceSettings


class BookingSettings(ServiceSettings):
    step_minutes: int = Field(default=5, ge=1, le=1440, validation_alias="BOOKING_STEP_MINUTES")
    horizon_days: int = Field(default=7, ge=1, validation_alias="BOOKING_HORIZON_DAYS")
