from sqlmodel import Field, SQLModel

SENSITIVE_KEYS = {"lpr_api_key"}


class AppSetting(SQLModel, table=True):
    key: str = Field(primary_key=True)
    value: str = ""
