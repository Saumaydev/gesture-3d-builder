# backend/websocket_server.py
import asyncio
import json
import uuid
import time
from typing import Dict, Set, Optional
from fastapi import WebSocket, WebSocketDisconnect
from collections import defaultdict

class ConnectionManager:
    """
    Manages WebSocket connections for real-time multiplayer collaboration
    """
    
    def __init__(self):
        # session_id -> {user_id -> WebSocket}
        self.sessions: Dict[str, Dict[str, WebSocket]] = defaultdict(dict)
        
        # user_id -> session_id
        self.user_sessions: Dict[str, str] = {}
        
        # user_id -> user metadata
        self.user_metadata: Dict[str, dict] = {}
        
        # user_id -> last active timestamp
        self.last_active: Dict[str, float] = {}
        
        # Total connection counter
        self.total_connections = 0
        
        print("✅ WebSocket Connection Manager initialized")
    
    async def connect(self, websocket: WebSocket, session_id: str, 
                     user_id: Optional[str] = None) -> str:
        """Accept a new WebSocket connection"""
        await websocket.accept()
        
        if not user_id:
            user_id = str(uuid.uuid4())[:8]
        
        # Add to session
        self.sessions[session_id][user_id] = websocket
        self.user_sessions[user_id] = session_id
        self.last_active[user_id] = time.time()
        self.total_connections += 1
        
        # Default metadata
        self.user_metadata[user_id] = {
            "user_id": user_id,
            "session_id": session_id,
            "color": self._assign_user_color(user_id),
            "username": f"User_{user_id[:4]}",
            "cursor": {"x": 0, "y": 0, "z": 0},
            "connected_at": time.time()
        }
        
        print(f"🔌 User {user_id} connected to session {session_id} "
              f"({len(self.sessions[session_id])} users)")
        
        # Notify others in session
        await self.broadcast_to_session(session_id, {
            "type": "user_joined",
            "user_id": user_id,
            "metadata": self.user_metadata[user_id],
            "session_users": list(self.sessions[session_id].keys())
        }, exclude=user_id)
        
        # Send session state to new user
        await self.send_to_user(user_id, {
            "type": "session_init",
            "user_id": user_id,
            "session_id": session_id,
            "metadata": self.user_metadata[user_id],
            "other_users": [
                self.user_metadata[uid] 
                for uid in self.sessions[session_id] 
                if uid != user_id
            ]
        })
        
        return user_id
    
    async def disconnect(self, user_id: str):
        """Handle user disconnection"""
        session_id = self.user_sessions.get(user_id)
        
        if session_id and session_id in self.sessions:
            # Remove from session
            self.sessions[session_id].pop(user_id, None)
            
            # Notify others
            await self.broadcast_to_session(session_id, {
                "type": "user_left",
                "user_id": user_id,
                "session_users": list(self.sessions[session_id].keys())
            })
            
            # Cleanup empty sessions
            if not self.sessions[session_id]:
                del self.sessions[session_id]
                print(f"🗑️ Session {session_id} removed (empty)")
        
        # Cleanup user data
        self.user_sessions.pop(user_id, None)
        self.user_metadata.pop(user_id, None)
        self.last_active.pop(user_id, None)
        
        print(f"❌ User {user_id} disconnected from session {session_id}")
    
    async def send_to_user(self, user_id: str, message: dict):
        """Send message to specific user"""
        session_id = self.user_sessions.get(user_id)
        if not session_id:
            return
        
        websocket = self.sessions.get(session_id, {}).get(user_id)
        if websocket:
            try:
                await websocket.send_text(json.dumps(message))
            except Exception as e:
                print(f"Error sending to {user_id}: {e}")
                await self.disconnect(user_id)
    
    async def broadcast_to_session(self, session_id: str, message: dict, 
                                   exclude: Optional[str] = None):
        """Broadcast message to all users in a session"""
        if session_id not in self.sessions:
            return
        
        message_str = json.dumps(message)
        disconnected = []
        
        for user_id, websocket in self.sessions[session_id].items():
            if user_id == exclude:
                continue
            try:
                await websocket.send_text(message_str)
            except Exception as e:
                print(f"Error broadcasting to {user_id}: {e}")
                disconnected.append(user_id)
        
        # Clean up disconnected users
        for user_id in disconnected:
            await self.disconnect(user_id)
    
    async def broadcast_building_update(self, session_id: str, action: str,
                                        building_data: dict, sender_id: str):
        """Broadcast building changes to all users in session"""
        message = {
            "type": "building_update",
            "action": action,
            "building": building_data,
            "sender_id": sender_id,
            "timestamp": time.time()
        }
        await self.broadcast_to_session(session_id, message, exclude=sender_id)
    
    async def broadcast_gesture(self, session_id: str, gesture_data: dict, 
                                sender_id: str):
        """Broadcast gesture data for cursor tracking"""
        message = {
            "type": "gesture_update",
            "user_id": sender_id,
            "gesture": gesture_data.get("gesture"),
            "position": gesture_data.get("action", {}).get("position", {}),
            "timestamp": time.time()
        }
        await self.broadcast_to_session(session_id, message, exclude=sender_id)
    
    async def update_cursor(self, user_id: str, position: dict):
        """Update and broadcast user cursor position"""
        if user_id in self.user_metadata:
            self.user_metadata[user_id]["cursor"] = position
        
        session_id = self.user_sessions.get(user_id)
        if session_id:
            await self.broadcast_to_session(session_id, {
                "type": "cursor_update",
                "user_id": user_id,
                "position": position
            }, exclude=user_id)
    
    async def handle_message(self, user_id: str, raw_message: str, db=None):
        """Process incoming WebSocket message"""
        try:
            message = json.loads(raw_message)
            msg_type = message.get("type", "")
            session_id = self.user_sessions.get(user_id)
            
            self.last_active[user_id] = time.time()
            
            # ── Building Operations ───────────────────────────────────────
            if msg_type == "add_building":
                await self.broadcast_building_update(
                    session_id, "add", message.get("building", {}), user_id
                )
            
            elif msg_type == "update_building":
                await self.broadcast_building_update(
                    session_id, "update", message.get("building", {}), user_id
                )
            
            elif msg_type == "delete_building":
                await self.broadcast_to_session(session_id, {
                    "type": "building_update",
                    "action": "delete",
                    "building_id": message.get("building_id"),
                    "sender_id": user_id
                }, exclude=user_id)
            
            elif msg_type == "clear_all":
                await self.broadcast_to_session(session_id, {
                    "type": "building_update",
                    "action": "clear_all",
                    "sender_id": user_id
                }, exclude=user_id)
            
            # ── Gesture Events ────────────────────────────────────────────
            elif msg_type == "gesture_event":
                gesture_data = message.get("gesture_data", {})
                await self.broadcast_gesture(session_id, gesture_data, user_id)
            
            # ── Cursor Tracking ───────────────────────────────────────────
            elif msg_type == "cursor_update":
                await self.update_cursor(user_id, message.get("position", {}))
            
            # ── Chat ──────────────────────────────────────────────────────
            elif msg_type == "chat":
                await self.broadcast_to_session(session_id, {
                    "type": "chat",
                    "user_id": user_id,
                    "username": self.user_metadata.get(user_id, {}).get("username", user_id),
                    "message": message.get("message", "")[:500],
                    "timestamp": time.time()
                })
            
            # ── Username Update ───────────────────────────────────────────
            elif msg_type == "set_username":
                new_name = message.get("username", "")[:30]
                if new_name and user_id in self.user_metadata:
                    self.user_metadata[user_id]["username"] = new_name
                    await self.broadcast_to_session(session_id, {
                        "type": "user_updated",
                        "user_id": user_id,
                        "username": new_name
                    })
            
            # ── Ping/Pong ─────────────────────────────────────────────────
            elif msg_type == "ping":
                await self.send_to_user(user_id, {
                    "type": "pong",
                    "timestamp": time.time()
                })
            
            else:
                print(f"Unknown message type: {msg_type}")
                
        except json.JSONDecodeError:
            print(f"Invalid JSON from {user_id}")
        except Exception as e:
            print(f"Error handling message from {user_id}: {e}")
    
    def _assign_user_color(self, user_id: str) -> str:
        """Assign a unique color to user"""
        colors = [
            "#FF6B6B", "#4ECDC4", "#45B7D1", "#96CEB4",
            "#FFEAA7", "#DDA0DD", "#98D8C8", "#F7DC6F",
            "#BB8FCE", "#85C1E9", "#82E0AA", "#F0B27A"
        ]
        idx = sum(ord(c) for c in user_id) % len(colors)
        return colors[idx]
    
    def get_session_info(self, session_id: str) -> dict:
        """Get information about a session"""
        users = list(self.sessions.get(session_id, {}).keys())
        return {
            "session_id": session_id,
            "user_count": len(users),
            "users": [self.user_metadata.get(u, {"user_id": u}) for u in users]
        }
    
    def get_stats(self) -> dict:
        """Get server statistics"""
        return {
            "total_sessions": len(self.sessions),
            "total_connected_users": sum(len(v) for v in self.sessions.values()),
            "total_connections_ever": self.total_connections
        }

# Global manager instance
manager = ConnectionManager()