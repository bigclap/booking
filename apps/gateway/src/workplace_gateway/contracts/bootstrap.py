from pydantic import BaseModel

from workplace_gateway.contracts.booking import BookingPolicy
from workplace_gateway.contracts.offices import OfficeDocument
from workplace_gateway.contracts.users import AuthSnapshot


class BootstrapSnapshot(BaseModel):
    auth: AuthSnapshot
    offices: list[OfficeDocument]
    policy: BookingPolicy
