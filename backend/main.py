# backend/main.py
import asyncio
import base64
import cv2
import json
import numpy as np
import time
import uuid
from contextlib import asynccontextmanager
from typing import Optional

from fastapi import (
    FastAPI, WebSocket, WebSocketDisconnect,
    HTTPException, Depends, Query
)
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import HTMLResponse, FileResponse
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

import database as db_ops
from database import get_db, init_db
from gesture_recognition import GestureRecognizer
from websocket_server import manager
from config import settings

# ─── App Lifecycle ─────────────────────────────────────────────────────────────

@asynccontextmanager
async def lifespan(app: FastAPI):
    print("🚀 Starting Gesture 3D Builder Server...")
    await init_db()
    print("✅ Database initialized")
    yield
    print("👋 Server shutting down...")

app = FastAPI(
    title="Gesture 3D Builder API",
    description="Real-time AI-powered 3D environment builder with hand gesture control",
    version="2.0.0",
    lifespan=lifespan
)

# ─── CORS ──────────────────────────────────────────────────────────────────────

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ─── Static Files ──────────────────────────────────────────────────────────────

import os
if os.path.exists("../frontend"):
    app.mount("/static", StaticFiles(directory="../frontend"), name="static")

# ─── Gesture Recognizer (lazy init) ───────────────────────────────────────────

_gesture_recognizer: Optional[GestureRecognizer] = None

def get_gesture_recognizer() -> GestureRecognizer:
    global _gesture_recognizer
    if _gesture_recognizer is None:
        _gesture_recognizer = GestureRecognizer(
            min_detection_confidence=settings.MIN_DETECTION_CONFIDENCE,
            min_tracking_confidence=settings.MIN_TRACKING_CONFIDENCE
        )
    return _gesture_recognizer

# ─── Pydantic Models ───────────────────────────────────────────────────────────

class CityCreate(BaseModel):
    name: str
    description: str = ""
    owner_id: int = 1

class BuildingData(BaseModel):
    buildings: list

class FrameData(BaseModel):
    frame: str  # base64 encoded
    session_id: str = "default"
    user_id: str = ""

# ─── REST API Routes ───────────────────────────────────────────────────────────

@app.get("/")
async def root():
    """Serve the frontend"""
    frontend_path = "../frontend/index.html"
    if os.path.exists(frontend_path):
        return FileResponse(frontend_path)
    return {
        "message": "Gesture 3D Builder API",
        "version": "2.0.0",
        "docs": "/docs",
        "websocket": "ws://localhost:8000/ws/{session_id}"
    }

@app.get("/api/health")
async def health_check():
    """Health check endpoint"""
    return {
        "status": "healthy",
        "timestamp": time.time(),
        "server_stats": manager.get_stats()
    }

# ── Cities ────────────────────────────────────────────────────────────────────

@app.get("/api/cities")
async def get_cities(db: AsyncSession = Depends(get_db)):
    """Get all public cities"""
    cities = await db_ops.get_all_cities(db)
    return {"cities": cities, "count": len(cities)}

@app.get("/api/cities/{city_id}")
async def get_city(city_id: int, db: AsyncSession = Depends(get_db)):
    """Get a specific city with its buildings"""
    city = await db_ops.get_city(db, city_id)
    if not city:
        raise HTTPException(status_code=404, detail="City not found")
    return city

@app.post("/api/cities")
async def create_city(city_data: CityCreate, db: AsyncSession = Depends(get_db)):
    """Create a new city"""
    city = await db_ops.create_city(db, city_data.name, city_data.description, city_data.owner_id)
    return {"success": True, "city": city}

@app.delete("/api/cities/{city_id}")
async def delete_city(city_id: int, db: AsyncSession = Depends(get_db)):
    """Delete a city"""
    success = await db_ops.delete_city(db, city_id)
    if not success:
        raise HTTPException(status_code=404, detail="City not found")
    return {"success": True, "message": f"City {city_id} deleted"}

# ── Buildings ─────────────────────────────────────────────────────────────────

@app.get("/api/cities/{city_id}/buildings")
async def get_buildings(city_id: int, db: AsyncSession = Depends(get_db)):
    """Get all buildings in a city"""
    buildings = await db_ops.get_buildings(db, city_id)
    return {"buildings": buildings, "count": len(buildings)}

@app.post("/api/cities/{city_id}/buildings")
async def save_buildings(city_id: int, data: BuildingData, db: AsyncSession = Depends(get_db)):
    """Save all buildings for a city"""
    success = await db_ops.save_buildings(db, city_id, data.buildings)
    if not success:
        raise HTTPException(status_code=500, detail="Failed to save buildings")
    
    # Broadcast to WebSocket clients
    await manager.broadcast_to_session(str(city_id), {
        "type": "scene_saved",
        "city_id": city_id,
        "building_count": len(data.buildings)
    })
    
    return {
        "success": True,
        "message": f"Saved {len(data.buildings)} buildings",
        "city_id": city_id
    }

# ── Collaboration Sessions ────────────────────────────────────────────────────

@app.post("/api/sessions")
async def create_session(city_id: int = Query(1), db: AsyncSession = Depends(get_db)):
    """Create a new collaboration session"""
    session_id = await db_ops.create_session(db, city_id)
    return {
        "session_id": session_id,
        "city_id": city_id,
        "ws_url": f"ws://localhost:{settings.PORT}/ws/{session_id}",
        "join_url": f"http://localhost:{settings.PORT}?session={session_id}"
    }

@app.get("/api/sessions/{session_id}")
async def get_session(session_id: str, db: AsyncSession = Depends(get_db)):
    """Get session info"""
    session = await db_ops.get_session(db, session_id)
    ws_info = manager.get_session_info(session_id)
    
    return {
        "session": session,
        "active_users": ws_info["user_count"],
        "users": ws_info["users"]
    }

@app.get("/api/sessions/{session_id}/users")
async def get_session_users(session_id: str):
    """Get active users in a session"""
    info = manager.get_session_info(session_id)
    return info

# ── Gesture Processing ────────────────────────────────────────────────────────

@app.post("/api/gesture/process")
async def process_gesture_frame(data: FrameData, db: AsyncSession = Depends(get_db)):
    """Process a video frame for gesture recognition"""
    try:
        # Decode base64 frame
        frame_bytes = base64.b64decode(data.frame.split(",")[-1])
        nparr = np.frombuffer(frame_bytes, np.uint8)
        frame = cv2.imdecode(nparr, cv2.IMREAD_COLOR)
        
        if frame is None:
            raise ValueError("Failed to decode frame")
        
        # Process with gesture recognizer
        recognizer = get_gesture_recognizer()
        gesture_data = recognizer.process_frame(frame)
        
        # Encode annotated frame back to base64
        _, buffer = cv2.imencode('.jpg', frame, [cv2.IMWRITE_JPEG_QUALITY, 75])
        annotated_b64 = "data:image/jpeg;base64," + base64.b64encode(buffer).decode()
        
        # Log significant gestures
        if gesture_data["gesture"] not in ["none", "unknown"] and gesture_data["confidence"] > 0.7:
            await db_ops.log_gesture(
                db,
                gesture_data["gesture"],
                gesture_data["confidence"],
                gesture_data.get("action", {}).get("type", "none") if gesture_data.get("action") else "none",
                data.session_id
            )
            
            # Broadcast gesture to WebSocket clients
            if data.session_id and data.user_id:
                await manager.broadcast_gesture(
                    data.session_id, gesture_data, data.user_id
                )
        
        return {
            "gesture": gesture_data["gesture"],
            "action": gesture_data["action"],
            "confidence": gesture_data["confidence"],
            "hand_count": len(gesture_data["hands"]),
            "annotated_frame": annotated_b64,
            "timestamp": time.time()
        }
        
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Frame processing error: {str(e)}")

@app.get("/api/stats")
async def get_stats():
    """Get server and connection statistics"""
    return {
        "server": manager.get_stats(),
        "timestamp": time.time()
    }

# ─── WebSocket Endpoint ─────────────────────────────────────────────────────────

@app.websocket("/ws/{session_id}")
async def websocket_endpoint(
    websocket: WebSocket,
    session_id: str,
    user_id: Optional[str] = Query(None)
):
    """Main WebSocket endpoint for real-time collaboration"""
    actual_user_id = await manager.connect(websocket, session_id, user_id)
    
    try:
        while True:
            # Receive message with timeout
            try:
                raw_message = await asyncio.wait_for(
                    websocket.receive_text(),
                    timeout=60.0
                )
                await manager.handle_message(actual_user_id, raw_message)
                
            except asyncio.TimeoutError:
                # Send heartbeat
                try:
                    await websocket.send_text(json.dumps({
                        "type": "heartbeat",
                        "timestamp": time.time()
                    }))
                except:
                    break
                    
    except WebSocketDisconnect:
        pass
    except Exception as e:
        print(f"WebSocket error for {actual_user_id}: {e}")
    finally:
        await manager.disconnect(actual_user_id)

# ─── Run ───────────────────────────────────────────────────────────────────────

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(
        "main:app",
        host=settings.HOST,
        port=settings.PORT,
        reload=settings.DEBUG,
        log_level="info"
    )