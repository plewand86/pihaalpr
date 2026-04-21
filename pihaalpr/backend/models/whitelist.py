from datetime import datetime
from sqlmodel import Field, SQLModel


class WhitelistEntry(SQLModel, table=True):
    id: int | None = Field(default=None, primary_key=True)
    plate: str = Field(index=True)
    description: str = ""
    ha_domain: str = ""
    ha_service: str = ""
    entity_id: str = ""
    service_data: str = ""
    enabled: bool = True
    created_at: datetime = Field(default_factory=datetime.utcnow)


class WhitelistEntryCreate(SQLModel):
    plate: str
    description: str = ""
    ha_domain: str = ""
    ha_service: str = ""
    entity_id: str = ""
    service_data: str = ""
    enabled: bool = True


class WhitelistEntryUpdate(SQLModel):
    plate: str | None = None
    description: str | None = None
    ha_domain: str | None = None
    ha_service: str | None = None
    entity_id: str | None = None
    service_data: str | None = None
    enabled: bool | None = None


class WhitelistEntryRead(SQLModel):
    id: int
    plate: str
    description: str
    ha_domain: str
    ha_service: str
    entity_id: str
    service_data: str
    enabled: bool
    created_at: datetime
