import google.generativeai as genai
import PIL.Image
import os
import shutil
import json
import time
import cv2
import numpy as np
import io
import re
from concurrent.futures import ThreadPoolExecutor, as_completed

class ImageAnalyzer:
    def __init__(self, api_key):
        genai.configure(api_key=api_key)
        self.model_name = self._get_best_model() # Dynamic Selection
        self.model = genai.GenerativeModel(self.model_name)
    
    def _get_best_model(self):
        try:
            print("\n🔍 Checking available Gemini models...")
            available_models = []
            for m in genai.list_models():
                if 'generateContent' in m.supported_generation_methods:
                    available_models.append(m.name)
            
            # Priority list
            priorities = [
                'models/gemini-1.5-flash-001', # Stable
                'models/gemini-1.5-flash',
                'models/gemini-1.5-flash-latest',
                'models/gemini-1.5-pro',
                'models/gemini-pro-vision'
            ]
            
            for p in priorities:
                if p in available_models:
                    print(f"✅ Selected Model: {p}")
                    return p
            
            # Fallbacks
            for m in available_models:
                if 'flash' in m: return m
            
            if available_models: return available_models[0]
            
        except Exception as e:
            print(f"⚠️ Error listing models: {e}. Defaulting to 'gemini-1.5-flash-001'")
            return 'gemini-1.5-flash-001'
        
        return 'gemini-1.5-flash-001'

    def _prepare_image_for_api(self, file_path, size=480, fmt="WEBP"):
        """Optimizes image for API (Micro-Proxy Strategy) - Speed & Cost"""
        try:
            with PIL.Image.open(file_path) as img:
                if img.mode != 'RGB': img = img.convert('RGB')
                if max(img.size) > size: img.thumbnail((size, size))
                buf = io.BytesIO()
                img.save(buf, format=fmt, quality=50) # Low quality enough for detection
                return buf.getvalue()
        except:
             with open(file_path, "rb") as f: return f.read()

    def _process_single_image(self, file_info):
        """
        Robust Processor: Math Gatekeeper -> AI Micro-Proxy -> Fail-Open.
        """
        file, source_folder, final_dest_dir, rejected_dir, prompt_unused = file_info
        
        full_path = os.path.join(source_folder, file)
        filename = file
        
        decision = "keep" # Default Bias
        reason = "Init"
        final_path = full_path

        try:
            # --- PHASE 1: LOCAL GATEKEEPER (Math) ---
            try:
                # Use CV2 for fast pixel analysis
                pil_img = PIL.Image.open(full_path)
                if pil_img.mode != 'RGB': pil_img = pil_img.convert('RGB')
                img_np = np.array(pil_img) 
                
                # Solid Color Check (Wall, Lens Cap, Floor Close-up)
                if img_np.std() < 15.0: # Threshold for "Flatness"
                    print(f"File: {file} -> Trash (Math: Solid Color)")
                    return self._finalize(file, "trash", "Solid Color (Math)", full_path, rejected_dir)
                
                # Blur Check (Laplacian)
                gray = cv2.cvtColor(img_np, cv2.COLOR_RGB2GRAY)
                blur_score = cv2.Laplacian(gray, cv2.CV_64F).var()
                if blur_score < 30.0: # Very blurry
                    print(f"File: {file} -> Trash (Math: Blurry {blur_score:.1f})")
                    return self._finalize(file, "trash", f"Blurry ({blur_score:.1f})", full_path, rejected_dir)

            except Exception as e:
                print(f"Math Check Error: {e}")
                # Continue to AI if Math fails

            # --- PHASE 2: AI MICRO-PROXY ---
            proxy_bytes = self._prepare_image_for_api(full_path)
            
            # KEEP-BIASED Prompt (Merchandising Auditor)
            ai_prompt = """Role: Merchandising Auditor.
Task: Filter GARBAGE vs CONTENT.

RULES:
1. KEEP (Pass):
   - Retail Shelves (Full or Empty).
   - Products (Bottles, Boxes, Jars).
   - Pallets, Cardboard Displays, Coolers.
   - Receipts, Documents, Screens.
   - Store Interior (Floor + Shelves).
   **IF UNCERTAIN/BLURRY BUT SHOWS SHELF -> KEEP.**

2. TRASH (Reject):
   - Solid Black/White/Red Screen.
   - Floor TILES ONLY (No products).
   - Ceiling ONLY.
   - Building Exterior / Street.
   - Accidental shots (Inside pocket, Shoes only).

Return JSON: {"decision": "keep" or "trash", "reason": "short explanation"}"""

            retries = 3
            for attempt in range(retries):
                try:
                    response = self.model.generate_content(
                        [ai_prompt, {'mime_type': 'image/webp', 'data': proxy_bytes}],
                        request_options={'timeout': 25}
                    )
                    text = response.text
                    clean = text.replace("```json", "").replace("```", "").strip()
                    
                    try:
                        res_json = json.loads(clean)
                    except:
                        match = re.search(r'\{.*\}', clean, re.DOTALL)
                        if match: 
                            res_json = json.loads(match.group(0))
                        else:
                            # Parse manually or default
                            if "trash" in clean.lower() and "keep" not in clean.lower():
                                res_json = {"decision": "trash", "reason": "AI Text says trash"}
                            else:
                                res_json = {"decision": "keep", "reason": "AI Parse Error (Default Keep)"}

                    decision = res_json.get("decision", "keep").lower()
                    if decision not in ["keep", "trash"]: decision = "keep"
                    
                    reason = "AI: " + res_json.get("reason", "Decision")
                    print(f"File: {file} -> {decision.upper()} | {reason}")
                    
                    if decision == "keep":
                         return self._finalize(file, "keep", reason, full_path, final_dest_dir)
                    else:
                         return self._finalize(file, "trash", reason, full_path, rejected_dir)

                except Exception as e:
                    print(f"AI Attempt {attempt+1} Error: {e}")
                    if attempt == retries - 1:
                        # Fail Open on last error
                        return self._finalize(file, "keep", f"AI Error (Safe Keep): {str(e)}", full_path, final_dest_dir)
                    time.sleep(1)

        except Exception as e:
            # Global Fail Open
            return self._finalize(file, "keep", f"Sys Error: {str(e)}", full_path, final_dest_dir)

    def _finalize(self, file, decision, reason, src_path, dest_dir):
        """Moves file and returns dict"""
        try:
            dest_path = os.path.join(dest_dir, file)
            # Use copy instead of move if you want safety, but original code moved.
            # Using Move to clear source is standard for sorting.
            if os.path.abspath(src_path) != os.path.abspath(dest_path):
                shutil.copy2(src_path, dest_path) # Changed to Copy for safety during testing? User wanted Sort.
                # Let's stick to copy2 for safety and "Auto report maker" usually copies to temp_sorted.
                # Actually, `main.py` expects files in `current_sorted_target`.
            
            return {
                "file": file,
                "decision": decision,
                "reason": reason,
                "path": dest_path
            }
        except Exception as e:
            return {
                "file": file,
                "decision": "keep",
                "reason": f"Move Error: {e}",
                "path": src_path
            }

    def analyze_and_sort_generator(self, source_folder, final_dest_dir, rejected_dest_dir=None):
        """
        Yields analysis results for each image using ThreadPoolExecutor for speed.
        (Maintains interface for main.py)
        """
        if rejected_dest_dir:
             rejected_dir = rejected_dest_dir
        else:
             rejected_dir = os.path.join(source_folder, "Rejected")

        if not os.path.exists(rejected_dir): os.makedirs(rejected_dir)
        if not os.path.exists(final_dest_dir): os.makedirs(final_dest_dir)

        files = [f for f in os.listdir(source_folder) if f.lower().endswith(('.png', '.jpg', '.jpeg', '.webp'))]
        total = len(files)
        
        # Max Workers from inspiration = Async Semaphore 40. 
        # Here we use Threads. 40 might be too high for Python threads + Networking without AsyncIO.
        # But `process_single_image` does mostly blocking I/O (Math/Net).
        # Let's bump to 10 for speed.
        max_workers = 10
        
        with ThreadPoolExecutor(max_workers=max_workers) as executor:
            future_to_file = {}
            for file in files:
                full_path_src = os.path.join(source_folder, file)
                # Pass None for prompt implies inside logic handles it
                file_info = (file, source_folder, final_dest_dir, rejected_dir, None)
                future = executor.submit(self._process_single_image, file_info)
                future_to_file[future] = (file, full_path_src, final_dest_dir)

            finished_count = 0
            
            for future in as_completed(future_to_file):
                file_name, src_path, dest_dir_keep = future_to_file[future]
                try:
                    res = future.result(timeout=45) # Longer timeout for 10 threads
                    finished_count += 1
                    yield {
                        "current": finished_count,
                        "total": total,
                        "file": res['file'],
                        "decision": res['decision'],
                        "reason": res.get('reason', 'N/A'),
                        "path": res['path']
                    }
                except TimeoutError:
                    finished_count += 1
                    # FAIL OPEN
                    final_dest_path = os.path.join(dest_dir_keep, file_name)
                    try: shutil.copy2(src_path, final_dest_path)
                    except: pass
                    yield {
                        "current": finished_count, "total": total, "file": file_name,
                        "decision": "keep", "reason": "Timeout (Safe Keep)", "path": final_dest_path
                    }
                except Exception as e:
                    finished_count += 1
                    final_dest_path = os.path.join(dest_dir_keep, file_name)
                    try: shutil.copy2(src_path, final_dest_path)
                    except: pass
                    yield {
                        "current": finished_count, "total": total, "file": file_name,
                        "decision": "keep", "reason": f"Sys Error {str(e)}", "path": final_dest_path
                    }
