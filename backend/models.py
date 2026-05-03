# backend/models.py
from sqlalchemy import Column, Integer, String, Float, DateTime, JSON, ForeignKey, Boolean
from sqlalchemy.ext.declarative import declarative_base
from sqlalchemy.orm import relationship
from datetime import datetime

Base = declarative_base()

class User(Base):
    __tablename__ = "users"
    
    id = Column(Integer, primary_key=True, index=True)
    username = Column(String(50), unique=True, index=True, nullable=False)
    email = Column(String(100), unique=True, index=True)
    hashed_password = Column(String(255))
    created_at = Column(DateTime, default=datetime.utcnow)
    is_active = Column(Boolean, default=True)
    
    cities = relationship("City", back_populates="owner")
    sessions = relationship("CollaborationSession", back_populates="owner")

class City(Base):
    __tablename__ = "cities"
    
    id = Column(Integer, primary_key=True, index=True)
    name = Column(String(100), nullable=False)
    description = Column(String(500))
    owner_id = Column(Integer, ForeignKey("users.id"))
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    is_public = Column(Boolean, default=True)
    thumbnail = Column(String(255))
    
    owner = relationship("User", back_populates="cities")
    buildings = relationship("Building", back_populates="city", cascade="all, delete-orphan")

class Building(Base):
    __tablename__ = "buildings"
    
    id = Column(Integer, primary_key=True, index=True)
    city_id = Column(Integer, ForeignKey("cities.id"))
    building_id = Column(String(50), nullable=False)  # Client-side UUID
    
    # Position
    pos_x = Column(Float, default=0.0)
    pos_y = Column(Float, default=0.0)
    pos_z = Column(Float, default=0.0)
    
    # Scale
    scale_x = Column(Float, default=1.0)
    scale_y = Column(Float, default=1.0)
    scale_z = Column(Float, default=1.0)
    
    # Rotation
    rot_y = Column(Float, default=0.0)
    
    # Appearance
    building_type = Column(String(50), default="skyscraper")
    color = Column(String(20), default="#4a90e2")
    floors = Column(Integer, default=10)
    
    # Metadata
    created_at = Column(DateTime, default=datetime.utcnow)
    extra_data = Column(JSON, default={})
    
    city = relationship("City", back_populates="buildings")

class CollaborationSession(Base):
    __tablename__ = "collaboration_sessions"
    
    id = Column(Integer, primary_key=True, index=True)
    session_id = Column(String(50), unique=True, nullable=False)
    city_id = Column(Integer, ForeignKey("cities.id"))
    owner_id = Column(Integer, ForeignKey("users.id"))
    created_at = Column(DateTime, default=datetime.utcnow)
    is_active = Column(Boolean, default=True)
    max_users = Column(Integer, default=10)
    
    owner = relationship("User", back_populates="sessions")

class GestureLog(Base):
    __tablename__ = "gesture_logs"
    
    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=True)
    session_id = Column(String(50))
    gesture_type = Column(String(50))
    confidence = Column(Float)
    timestamp = Column(DateTime, default=datetime.utcnow)
    action_taken = Column(String(100))
    extra_data = Column(JSON, default={})