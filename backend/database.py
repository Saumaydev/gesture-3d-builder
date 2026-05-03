# backend/database.py
from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession
from sqlalchemy.orm import sessionmaker
from sqlalchemy.future import select
from typing import AsyncGenerator, List, Optional, Dict
import json
import uuid
from datetime import datetime

from models import Base, City, Building, CollaborationSession, User, GestureLog
from config import settings

# Create async engine
engine = create_async_engine(
    settings.DATABASE_URL,
    echo=settings.DEBUG,
    connect_args={"check_same_thread": False}
)

AsyncSessionLocal = sessionmaker(
    engine, 
    class_=AsyncSession, 
    expire_on_commit=False
)

async def get_db() -> AsyncGenerator[AsyncSession, None]:
    async with AsyncSessionLocal() as session:
        try:
            yield session
            await session.commit()
        except Exception:
            await session.rollback()
            raise
        finally:
            await session.close()

async def init_db():
    """Initialize database tables"""
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    
    # Create default user and city for demo
    async with AsyncSessionLocal() as session:
        result = await session.execute(select(User).where(User.username == "demo"))
        user = result.scalar_one_or_none()
        
        if not user:
            demo_user = User(
                username="demo",
                email="demo@gesturebuilder.com",
                hashed_password="demo_hash",
                is_active=True
            )
            session.add(demo_user)
            await session.flush()
            
            demo_city = City(
                name="Demo City",
                description="A demo city to get started",
                owner_id=demo_user.id,
                is_public=True
            )
            session.add(demo_city)
            await session.commit()
            print("✅ Demo user and city created")

# ─── City Operations ──────────────────────────────────────────────────────────

async def get_all_cities(db: AsyncSession) -> List[dict]:
    result = await db.execute(select(City).where(City.is_public == True))
    cities = result.scalars().all()
    return [
        {
            "id": c.id,
            "name": c.name,
            "description": c.description,
            "owner_id": c.owner_id,
            "created_at": c.created_at.isoformat(),
            "updated_at": c.updated_at.isoformat() if c.updated_at else None,
            "is_public": c.is_public,
            "building_count": 0
        }
        for c in cities
    ]

async def get_city(db: AsyncSession, city_id: int) -> Optional[dict]:
    result = await db.execute(select(City).where(City.id == city_id))
    city = result.scalar_one_or_none()
    if not city:
        return None
    
    buildings_result = await db.execute(
        select(Building).where(Building.city_id == city_id)
    )
    buildings = buildings_result.scalars().all()
    
    return {
        "id": city.id,
        "name": city.name,
        "description": city.description,
        "owner_id": city.owner_id,
        "created_at": city.created_at.isoformat(),
        "buildings": [building_to_dict(b) for b in buildings]
    }

async def create_city(db: AsyncSession, name: str, description: str = "", owner_id: int = 1) -> dict:
    city = City(
        name=name,
        description=description,
        owner_id=owner_id,
        is_public=True
    )
    db.add(city)
    await db.commit()
    await db.refresh(city)
    return {"id": city.id, "name": city.name, "description": city.description}

async def delete_city(db: AsyncSession, city_id: int) -> bool:
    result = await db.execute(select(City).where(City.id == city_id))
    city = result.scalar_one_or_none()
    if city:
        await db.delete(city)
        await db.commit()
        return True
    return False

# ─── Building Operations ──────────────────────────────────────────────────────

def building_to_dict(b: Building) -> dict:
    return {
        "id": b.id,
        "building_id": b.building_id,
        "position": {"x": b.pos_x, "y": b.pos_y, "z": b.pos_z},
        "scale": {"x": b.scale_x, "y": b.scale_y, "z": b.scale_z},
        "rotation": {"y": b.rot_y},
        "type": b.building_type,
        "color": b.color,
        "floors": b.floors,
        "extra_data": b.extra_data or {}
    }

async def save_buildings(db: AsyncSession, city_id: int, buildings_data: List[dict]) -> bool:
    try:
        # Delete existing buildings
        existing = await db.execute(select(Building).where(Building.city_id == city_id))
        for b in existing.scalars().all():
            await db.delete(b)
        
        # Insert new buildings
        for bd in buildings_data:
            pos = bd.get("position", {})
            scale = bd.get("scale", {})
            rot = bd.get("rotation", {})
            
            building = Building(
                city_id=city_id,
                building_id=bd.get("id", str(uuid.uuid4())),
                pos_x=pos.get("x", 0),
                pos_y=pos.get("y", 0),
                pos_z=pos.get("z", 0),
                scale_x=scale.get("x", 1),
                scale_y=scale.get("y", 1),
                scale_z=scale.get("z", 1),
                rot_y=rot.get("y", 0),
                building_type=bd.get("type", "skyscraper"),
                color=bd.get("color", "#4a90e2"),
                floors=bd.get("floors", 10),
                extra_data=bd.get("extra_data", {})
            )
            db.add(building)
        
        await db.commit()
        return True
    except Exception as e:
        await db.rollback()
        print(f"Error saving buildings: {e}")
        return False

async def get_buildings(db: AsyncSession, city_id: int) -> List[dict]:
    result = await db.execute(select(Building).where(Building.city_id == city_id))
    buildings = result.scalars().all()
    return [building_to_dict(b) for b in buildings]

# ─── Session Operations ───────────────────────────────────────────────────────

async def create_session(db: AsyncSession, city_id: int, owner_id: int = 1) -> str:
    session_id = str(uuid.uuid4())[:8].upper()
    session = CollaborationSession(
        session_id=session_id,
        city_id=city_id,
        owner_id=owner_id,
        is_active=True
    )
    db.add(session)
    await db.commit()
    return session_id

async def get_session(db: AsyncSession, session_id: str) -> Optional[dict]:
    result = await db.execute(
        select(CollaborationSession).where(
            CollaborationSession.session_id == session_id,
            CollaborationSession.is_active == True
        )
    )
    session = result.scalar_one_or_none()
    if not session:
        return None
    return {
        "session_id": session.session_id,
        "city_id": session.city_id,
        "owner_id": session.owner_id,
        "created_at": session.created_at.isoformat()
    }

async def log_gesture(db: AsyncSession, gesture_type: str, confidence: float, 
                      action: str, session_id: str = "", user_id: int = None):
    log = GestureLog(
        user_id=user_id,
        session_id=session_id,
        gesture_type=gesture_type,
        confidence=confidence,
        action_taken=action
    )
    db.add(log)
    await db.commit()