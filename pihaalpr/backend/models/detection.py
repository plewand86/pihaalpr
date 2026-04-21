from datetime import datetime
from typing import Optional
from sqlmodel import Field, SQLModel


class Detection(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    plate: str = Field(index=True)
    confidence: float
    camera_name: str = ""
    detected_at: datetime = Field(default_factory=datetime.utcnow)


class DetectionRead(SQLModel):
    id: int
    plate: str
    confidence: float
    camera_name: str
    detected_at: datetime
