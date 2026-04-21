import json
import os
from pydantic_settings import BaseSettings

OPTIONS_FILE = "/data/options.json"


def _load_options() -> dict:
    if os.path.exists(OPTIONS_FILE):
        with open(OPTIONS_FILE) as f:
            return json.load(f)
    return {}


class Settings(BaseSettings):
    ha_url: str = "http://supervisor/core"
    ha_token: str = ""
    log_level: str = "info"
    language: str = "pl"
    data_dir: str = "/data"
    static_dir: str = "/app/frontend/dist"
    database_url: str = ""

    model_config = {"env_file": ".env"}

    def model_post_init(self, __context):
        opts = _load_options()
        if "log_level" in opts:
            object.__setattr__(self, "log_level", opts["log_level"])
        if "language" in opts:
            object.__setattr__(self, "language", opts["language"])
        if not self.database_url:
            object.__setattr__(self, "database_url", f"sqlite:///{self.data_dir}/lpr.db")


_settings: Settings | None = None


def get_settings() -> Settings:
    global _settings
    if _settings is None:
        _settings = Settings()
    return _settings
