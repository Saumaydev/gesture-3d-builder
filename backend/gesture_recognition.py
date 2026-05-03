# backend/gesture_recognition.py
import cv2
import mediapipe as mp
import numpy as np
from typing import Optional, Dict, List, Tuple
import math
import time

class GestureRecognizer:
    """
    Real-time hand gesture recognition using MediaPipe
    Recognizes gestures for 3D building manipulation
    """
    
    def __init__(self, 
                 min_detection_confidence: float = 0.7,
                 min_tracking_confidence: float = 0.5):
        
        self.mp_hands = mp.solutions.hands
        self.mp_drawing = mp.solutions.drawing_utils
        self.mp_drawing_styles = mp.solutions.drawing_styles
        
        self.hands = self.mp_hands.Hands(
            static_image_mode=False,
            max_num_hands=2,
            min_detection_confidence=min_detection_confidence,
            min_tracking_confidence=min_tracking_confidence
        )
        
        # Gesture state tracking
        self.gesture_history = []
        self.history_length = 10
        self.last_gesture_time = 0
        self.gesture_cooldown = 0.3  # seconds
        
        # Building interaction state
        self.pinch_start = None
        self.grab_start = None
        self.last_hand_position = None
        self.interaction_mode = "idle"
        
        # Finger landmark indices
        self.FINGER_TIPS = [4, 8, 12, 16, 20]
        self.FINGER_PIPS = [3, 7, 11, 15, 19]
        self.FINGER_MCPS = [2, 5, 9, 13, 17]
        
        print("✅ Gesture Recognizer initialized")
    
    def process_frame(self, frame: np.ndarray) -> Dict:
        """Process a video frame and return gesture data"""
        h, w, _ = frame.shape
        rgb_frame = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
        results = self.hands.process(rgb_frame)
        
        gesture_data = {
            "hands": [],
            "gesture": "none",
            "action": None,
            "confidence": 0.0,
            "hand_positions": [],
            "raw_landmarks": []
        }
        
        if not results.multi_hand_landmarks:
            self.interaction_mode = "idle"
            return gesture_data
        
        # Process each detected hand
        hands_info = []
        for idx, (hand_landmarks, handedness) in enumerate(
            zip(results.multi_hand_landmarks, results.multi_handedness)
        ):
            hand_info = self._extract_hand_info(
                hand_landmarks, handedness, w, h
            )
            hands_info.append(hand_info)
            
            # Draw landmarks on frame
            self.mp_drawing.draw_landmarks(
                frame,
                hand_landmarks,
                self.mp_hands.HAND_CONNECTIONS,
                self.mp_drawing_styles.get_default_hand_landmarks_style(),
                self.mp_drawing_styles.get_default_hand_connections_style()
            )
        
        gesture_data["hands"] = hands_info
        gesture_data["hand_positions"] = [h["wrist"] for h in hands_info]
        
        # Recognize gestures
        if len(hands_info) == 1:
            gesture, action, confidence = self._recognize_single_hand(
                hands_info[0], frame
            )
        elif len(hands_info) == 2:
            gesture, action, confidence = self._recognize_two_hands(
                hands_info[0], hands_info[1]
            )
        else:
            gesture, action, confidence = "none", None, 0.0
        
        gesture_data["gesture"] = gesture
        gesture_data["action"] = action
        gesture_data["confidence"] = confidence
        
        # Overlay gesture info on frame
        self._draw_gesture_info(frame, gesture, action, confidence, hands_info)
        
        return gesture_data
    
    def _extract_hand_info(self, landmarks, handedness, w: int, h: int) -> Dict:
        """Extract structured info from hand landmarks"""
        lm = landmarks.landmark
        
        # Normalize coordinates
        points = [(lm[i].x, lm[i].y, lm[i].z) for i in range(21)]
        
        # Key positions (normalized 0-1)
        wrist = {"x": lm[0].x, "y": lm[0].y, "z": lm[0].z}
        
        # Finger tips
        tips = {
            "thumb": {"x": lm[4].x, "y": lm[4].y, "z": lm[4].z},
            "index": {"x": lm[8].x, "y": lm[8].y, "z": lm[8].z},
            "middle": {"x": lm[12].x, "y": lm[12].y, "z": lm[12].z},
            "ring": {"x": lm[16].x, "y": lm[16].y, "z": lm[16].z},
            "pinky": {"x": lm[20].x, "y": lm[20].y, "z": lm[20].z},
        }
        
        # Finger states (extended or curled)
        fingers_extended = self._get_fingers_extended(lm)
        
        # Palm center
        palm_x = np.mean([lm[0].x, lm[5].x, lm[9].x, lm[13].x, lm[17].x])
        palm_y = np.mean([lm[0].y, lm[5].y, lm[9].y, lm[13].y, lm[17].y])
        
        # Pinch distance (thumb to index)
        pinch_dist = math.sqrt(
            (lm[4].x - lm[8].x)**2 + 
            (lm[4].y - lm[8].y)**2
        )
        
        return {
            "handedness": handedness.classification[0].label,
            "score": handedness.classification[0].score,
            "wrist": wrist,
            "tips": tips,
            "fingers_extended": fingers_extended,
            "palm": {"x": palm_x, "y": palm_y},
            "pinch_distance": pinch_dist,
            "landmarks": points
        }
    
    def _get_fingers_extended(self, lm) -> Dict[str, bool]:
        """Determine if each finger is extended"""
        # Thumb: compare x coordinates (left/right hand dependent)
        thumb_extended = abs(lm[4].x - lm[3].x) > 0.02
        
        # Other fingers: tip y < pip y (higher on screen = smaller y = extended)
        index_extended = lm[8].y < lm[6].y
        middle_extended = lm[12].y < lm[10].y
        ring_extended = lm[16].y < lm[14].y
        pinky_extended = lm[20].y < lm[18].y
        
        return {
            "thumb": thumb_extended,
            "index": index_extended,
            "middle": middle_extended,
            "ring": ring_extended,
            "pinky": pinky_extended
        }
    
    def _recognize_single_hand(self, hand: Dict, frame: np.ndarray) -> Tuple[str, Optional[Dict], float]:
        """Recognize gestures from a single hand"""
        fe = hand["fingers_extended"]
        pinch_dist = hand["pinch_distance"]
        palm = hand["palm"]
        tips = hand["tips"]
        
        extended_count = sum(fe.values())
        
        current_time = time.time()
        cooldown_ok = (current_time - self.last_gesture_time) > self.gesture_cooldown
        
        # ── OPEN PALM: Place/Select Building ──────────────────────────────
        if all(fe.values()) and extended_count == 5:
            action = {
                "type": "place_building",
                "position": {
                    "x": (palm["x"] - 0.5) * 40,
                    "y": 0,
                    "z": (palm["y"] - 0.5) * 40
                },
                "building_type": "skyscraper"
            }
            return "open_palm", action, 0.92
        
        # ── PINCH: Grab and Move Building ────────────────────────────────
        if pinch_dist < 0.05 and fe["index"] and not fe["middle"]:
            dx = (palm["x"] - 0.5) * 40
            dz = (palm["y"] - 0.5) * 40
            
            action = {
                "type": "grab_move",
                "position": {"x": dx, "y": 0, "z": dz},
                "delta": self._calc_delta(palm)
            }
            if cooldown_ok:
                self.last_gesture_time = current_time
            return "pinch", action, 0.88
        
        # ── POINTING: Select/Highlight ────────────────────────────────────
        if fe["index"] and not fe["middle"] and not fe["ring"] and not fe["pinky"]:
            action = {
                "type": "select",
                "position": {
                    "x": (tips["index"]["x"] - 0.5) * 40,
                    "y": 0,
                    "z": (tips["index"]["y"] - 0.5) * 40
                },
                "ray_direction": {
                    "x": tips["index"]["x"] - tips["middle"]["x"],
                    "y": 0,
                    "z": tips["index"]["z"] - tips["middle"]["z"]
                }
            }
            return "pointing", action, 0.85
        
        # ── FIST: Delete Building ─────────────────────────────────────────
        if not any(fe.values()) or extended_count <= 1:
            action = {
                "type": "delete",
                "position": {
                    "x": (palm["x"] - 0.5) * 40,
                    "y": 0,
                    "z": (palm["y"] - 0.5) * 40
                }
            }
            if cooldown_ok:
                self.last_gesture_time = current_time
            return "fist", action, 0.90
        
        # ── PEACE/V SIGN: Change Building Type ───────────────────────────
        if fe["index"] and fe["middle"] and not fe["ring"] and not fe["pinky"]:
            action = {
                "type": "change_type",
                "next_type": True
            }
            if cooldown_ok:
                self.last_gesture_time = current_time
            return "peace", action, 0.82
        
        # ── THUMBS UP: Save Scene ─────────────────────────────────────────
        if fe["thumb"] and not fe["index"] and not fe["middle"] and not fe["ring"] and not fe["pinky"]:
            action = {"type": "save_scene"}
            if cooldown_ok:
                self.last_gesture_time = current_time
            return "thumbs_up", action, 0.87
        
        # ── THREE FINGERS: Rotate ────────────────────────────────────────
        if fe["index"] and fe["middle"] and fe["ring"] and not fe["pinky"] and not fe["thumb"]:
            angle = math.atan2(
                tips["middle"]["x"] - palm["x"],
                tips["middle"]["y"] - palm["y"]
            )
            action = {
                "type": "rotate",
                "angle": math.degrees(angle)
            }
            return "three_fingers", action, 0.80
        
        # ── FOUR FINGERS: Undo ───────────────────────────────────────────
        if fe["index"] and fe["middle"] and fe["ring"] and fe["pinky"] and not fe["thumb"]:
            action = {"type": "undo"}
            if cooldown_ok:
                self.last_gesture_time = current_time
            return "four_fingers", action, 0.85
        
        return "unknown", None, 0.0
    
    def _recognize_two_hands(self, hand1: Dict, hand2: Dict) -> Tuple[str, Optional[Dict], float]:
        """Recognize gestures using both hands"""
        # Distance between palms
        dx = hand1["palm"]["x"] - hand2["palm"]["x"]
        dy = hand1["palm"]["y"] - hand2["palm"]["y"]
        palm_distance = math.sqrt(dx**2 + dy**2)
        
        fe1 = hand1["fingers_extended"]
        fe2 = hand2["fingers_extended"]
        
        # ── TWO HAND SPREAD: Scale Up ─────────────────────────────────────
        if all(fe1.values()) and all(fe2.values()):
            scale_factor = palm_distance * 3.0  # Normalize
            action = {
                "type": "scale",
                "scale_factor": max(0.1, min(5.0, scale_factor)),
                "scale_uniform": True
            }
            return "two_hand_spread", action, 0.91
        
        # ── TWO HAND PINCH: Scale Down ────────────────────────────────────
        if hand1["pinch_distance"] < 0.06 and hand2["pinch_distance"] < 0.06:
            action = {
                "type": "scale",
                "scale_factor": max(0.1, palm_distance * 2),
                "scale_uniform": True
            }
            return "two_hand_pinch", action, 0.88
        
        # ── CLAP (hands close): Undo ──────────────────────────────────────
        if palm_distance < 0.15:
            action = {"type": "clear_selection"}
            return "clap", action, 0.78
        
        # ── TWO POINT: Camera Rotate ──────────────────────────────────────
        if fe1["index"] and fe2["index"] and not fe1["middle"] and not fe2["middle"]:
            mid_x = (hand1["tips"]["index"]["x"] + hand2["tips"]["index"]["x"]) / 2
            mid_y = (hand1["tips"]["index"]["y"] + hand2["tips"]["index"]["y"]) / 2
            action = {
                "type": "camera_rotate",
                "pivot": {"x": (mid_x - 0.5) * 40, "y": 0, "z": (mid_y - 0.5) * 40}
            }
            return "two_point", action, 0.83
        
        return "two_hands_unknown", None, 0.0
    
    def _calc_delta(self, palm: Dict) -> Dict:
        """Calculate movement delta from previous position"""
        current = palm
        if self.last_hand_position is None:
            self.last_hand_position = current
            return {"x": 0, "y": 0, "z": 0}
        
        delta = {
            "x": (current["x"] - self.last_hand_position["x"]) * 40,
            "y": 0,
            "z": (current["y"] - self.last_hand_position["y"]) * 40
        }
        self.last_hand_position = current
        return delta
    
    def _draw_gesture_info(self, frame: np.ndarray, gesture: str, 
                           action: Optional[Dict], confidence: float,
                           hands_info: List[Dict]):
        """Draw gesture information on the frame"""
        h, w = frame.shape[:2]
        
        # Background for text
        overlay = frame.copy()
        cv2.rectangle(overlay, (0, 0), (350, 140), (0, 0, 0), -1)
        cv2.addWeighted(overlay, 0.5, frame, 0.5, 0, frame)
        
        # Gesture name
        gesture_colors = {
            "open_palm": (0, 255, 0),
            "pinch": (255, 165, 0),
            "pointing": (0, 165, 255),
            "fist": (0, 0, 255),
            "peace": (255, 0, 255),
            "thumbs_up": (0, 255, 255),
            "two_hand_spread": (255, 255, 0),
            "two_hand_pinch": (255, 128, 0),
        }
        color = gesture_colors.get(gesture, (255, 255, 255))
        
        cv2.putText(frame, f"Gesture: {gesture.upper()}", 
                    (10, 30), cv2.FONT_HERSHEY_SIMPLEX, 0.8, color, 2)
        cv2.putText(frame, f"Confidence: {confidence:.0%}", 
                    (10, 60), cv2.FONT_HERSHEY_SIMPLEX, 0.6, (200, 200, 200), 1)
        
        if action:
            action_str = action.get("type", "").replace("_", " ").title()
            cv2.putText(frame, f"Action: {action_str}", 
                        (10, 90), cv2.FONT_HERSHEY_SIMPLEX, 0.6, (100, 255, 100), 1)
        
        cv2.putText(frame, f"Hands: {len(hands_info)}", 
                    (10, 120), cv2.FONT_HERSHEY_SIMPLEX, 0.6, (200, 200, 200), 1)
        
        # Gesture guide
        guide_y = h - 10
        guides = [
            ("Open Palm=Place", (0, 255, 0)),
            ("Fist=Delete", (0, 0, 255)),
            ("Pinch=Move", (255, 165, 0)),
            ("Peace=Type", (255, 0, 255)),
            ("Spread=Scale", (255, 255, 0)),
        ]
        
        for i, (text, col) in enumerate(guides):
            x = 10 + i * 145
            cv2.putText(frame, text, (x, guide_y), 
                        cv2.FONT_HERSHEY_SIMPLEX, 0.38, col, 1)
    
    def get_frame_annotations(self, frame: np.ndarray) -> np.ndarray:
        """Return annotated frame as JPEG bytes"""
        _, buffer = cv2.imencode('.jpg', frame, [cv2.IMWRITE_JPEG_QUALITY, 80])
        return buffer.tobytes()
    
    def release(self):
        """Release resources"""
        self.hands.close()
        print("Gesture recognizer released")