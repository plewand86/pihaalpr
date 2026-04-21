from datetime import datetime
from typing import Optional
from sqlmodel import Field, SQLModel


class Camera(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    name: str
    snapshot_url: str
    username: str = ""
    password: str = ""
    enabled: bool = True
    auto_capture: bool = False
    capture_interval: int = 30
    rtsp_url: str = ""
    rtsp_auto_start: bool = True
    rtsp_use_snapshot: bool = False
    motion_threshold: int = 10
    created_at: datetime = Field(default_factory=datetime.utcnow)


class CameraCreate(SQLModel):
    name: str
    snapshot_url: str
    username: str = ""
    password: str = ""
    enabled: bool = True
    auto_capture: bool = False
    capture_interval: int = 30
    rtsp_url: str = ""
    rtsp_auto_start: bool = True
    rtsp_use_snapshot: bool = False
    motion_threshold: int = 10


class CameraUpdate(SQLModel):
    name: Optional[str] = None
    snapshot_url: Optional[str] = None
    username: Optional[str] = None
    password: Optional[str] = None
    enabled: Optional[bool] = None
    auto_capture: Optional[bool] = None
    capture_interval: Optional[int] = None
    rtsp_url: Optional[str] = None
    rtsp_auto_start: Optional[bool] = None
    rtsp_use_snapshot: Optional[bool] = None
    motion_threshold: Optional[int] = None


class CameraRead(SQLModel):
    id: int
    name: str
    snapshot_url: str
    username: str
    enabled: bool
    auto_capture: bool
    capture_interval: int
    rtsp_url: str
    rtsp_auto_start: bool
    rtsp_use_snapshot: bool
    motion_threshold: int
    created_at: datetime
