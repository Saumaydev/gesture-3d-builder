# backend/config.py

from pydantic_settings import BaseSettings
from typing import List
import os

class Settings(BaseSettings):
    # ─── Server ─────────────────────────────────────────────
    HOST: str = "0.0.0.0"
    PORT: int = 8000
    DEBUG: bool = True

    # ─── Database (FORCED SAFE DEFAULT) ─────────────────────
    DATABASE_URL: str = os.getenv(
        "DATABASE_URL",
        "sqlite+aiosqlite:///./data/gesture_builder.db"
    )

    # ─── WebSocket ──────────────────────────────────────────
    WS_HEARTBEAT_INTERVAL: int = 30
    MAX_CONNECTIONS: int = 50

    # ─── Gesture Recognition ────────────────────────────────
    GESTURE_CONFIDENCE: float = 0.7
    MIN_DETECTION_CONFIDENCE: float = 0.7
    MIN_TRACKING_CONFIDENCE: float = 0.5

    # ─── CORS ───────────────────────────────────────────────
    ALLOWED_ORIGINS: List[str] = ["*"]

    # ─── Security ───────────────────────────────────────────
    SECRET_KEY: str = "gesture-3d-builder-secret-key-2024"

    class Config:
        # 🔥 FIX: Always point to correct env file
        env_file = "backend/.env"
        env_file_encoding = "utf-8"


# Create settings instance
settings = Settings()


# ─── DEBUG PRINT (REMOVE LATER) ─────────────────────────────
print("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━")
print("🚀 CONFIG LOADED")
print("DATABASE_URL:", settings.DATABASE_URL)
print("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━")