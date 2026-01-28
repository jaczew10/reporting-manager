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

# Rate limiting for Gemini Free Tier: 15 requests/minute = 1 request every 4 seconds
BATCH_SIZE = 9  # Number of images to analyze per API call
REQUEST_DELAY_SECONDS = 4  # Delay between API requests to stay within free tier limits

class ImageAnalyzer:
    def __init__(self, api_key):
        genai.configure(api_key=api_key)
        self.model_name = self._get_best_model()
        self.model = genai.GenerativeModel(self.model_name)
        self.last_request_time = 0
    
    def _get_best_model(self):
        try:
            print("\n🔍 Checking available Gemini models...")
            available_models = []
            for m in genai.list_models():
                if 'generateContent' in m.supported_generation_methods:
                    available_models.append(m.name)
            
            # Priority list - prefer flash models for speed and cost
            priorities = [
                'models/gemini-1.5-flash-001',
                'models/gemini-1.5-flash',
                'models/gemini-1.5-flash-latest',
                'models/gemini-1.5-pro',
                'models/gemini-pro-vision'
            ]
            
            for p in priorities:
                if p in available_models:
                    print(f"✅ Selected Model: {p}")
                    return p
            
            for m in available_models:
                if 'flash' in m: return m
            
            if available_models: return available_models[0]
            
        except Exception as e:
            print(f"⚠️ Error listing models: {e}. Defaulting to 'gemini-1.5-flash-001'")
            return 'gemini-1.5-flash-001'
        
        return 'gemini-1.5-flash-001'

    def _prepare_image_for_api(self, file_path, size=400, fmt="WEBP"):
        """Optimizes image for API - smaller size for batch processing"""
        try:
            with PIL.Image.open(file_path) as img:
                if img.mode != 'RGB': img = img.convert('RGB')
                if max(img.size) > size: img.thumbnail((size, size))
                buf = io.BytesIO()
                img.save(buf, format=fmt, quality=40)  # Lower quality for batch
                return buf.getvalue()
        except:
            with open(file_path, "rb") as f: return f.read()

    def _wait_for_rate_limit(self):
        """Ensures we wait at least REQUEST_DELAY_SECONDS between API calls"""
        elapsed = time.time() - self.last_request_time
        if elapsed < REQUEST_DELAY_SECONDS:
            wait_time = REQUEST_DELAY_SECONDS - elapsed
            print(f"⏳ Rate limit: waiting {wait_time:.1f}s...")
            time.sleep(wait_time)
        self.last_request_time = time.time()

    def _local_math_check(self, file_path, file_name):
        """
        Local gatekeeper using math - filters obvious garbage without API calls.
        Returns (should_skip, decision, reason) - if should_skip is True, skip API.
        """
        try:
            pil_img = PIL.Image.open(file_path)
            if pil_img.mode != 'RGB': pil_img = pil_img.convert('RGB')
            img_np = np.array(pil_img)
            
            # Solid Color Check
            if img_np.std() < 15.0:
                print(f"📐 {file_name} -> Trash (Math: Solid Color)")
                return (True, "trash", "Solid Color (Math)")
            
            # Blur Check (Laplacian)
            gray = cv2.cvtColor(img_np, cv2.COLOR_RGB2GRAY)
            blur_score = cv2.Laplacian(gray, cv2.CV_64F).var()
            if blur_score < 30.0:
                print(f"📐 {file_name} -> Trash (Math: Blurry {blur_score:.1f})")
                return (True, "trash", f"Blurry ({blur_score:.1f})")
            
            return (False, None, None)
            
        except Exception as e:
            print(f"Math Check Error for {file_name}: {e}")
            return (False, None, None)

    def _process_batch_with_ai(self, batch_files, source_folder):
        """
        Process a batch of images with a single API call.
        Returns dict mapping filename -> (decision, reason)
        """
        if not batch_files:
            return {}
        
        results = {}
        
        # Prepare all images for the batch
        image_parts = []
        file_names = []
        
        for file_name in batch_files:
            full_path = os.path.join(source_folder, file_name)
            try:
                proxy_bytes = self._prepare_image_for_api(full_path)
                image_parts.append({'mime_type': 'image/webp', 'data': proxy_bytes})
                file_names.append(file_name)
            except Exception as e:
                print(f"Error preparing {file_name}: {e}")
                results[file_name] = ("keep", f"Prep Error: {str(e)}")
        
        if not file_names:
            return results
        
        # Build batch prompt
        batch_prompt = f"""Role: Merchandising Auditor.
Task: Analyze {len(file_names)} images and filter GARBAGE vs CONTENT.

RULES:
1. KEEP (Pass):
   - Retail Shelves (Full or Empty)
   - Products (Bottles, Boxes, Jars)
   - Pallets, Cardboard Displays, Coolers
   - Receipts, Documents, Screens
   - Store Interior (Floor + Shelves)
   **IF UNCERTAIN/BLURRY BUT SHOWS SHELF -> KEEP**

2. TRASH (Reject):
   - Solid Black/White/Red Screen
   - Floor TILES ONLY (No products)
   - Ceiling ONLY
   - Building Exterior / Street
   - Accidental shots (Inside pocket, Shoes only)

IMAGE LIST (in order):
{chr(10).join([f'{i+1}. {name}' for i, name in enumerate(file_names)])}

Return JSON array with decisions for each image IN ORDER:
[
  {{"file": "filename1.jpg", "decision": "keep", "reason": "short explanation"}},
  {{"file": "filename2.jpg", "decision": "trash", "reason": "short explanation"}}
]"""

        # Wait for rate limit
        self._wait_for_rate_limit()
        
        retries = 3
        for attempt in range(retries):
            try:
                # Build content list: prompt first, then all images
                content = [batch_prompt] + image_parts
                
                print(f"🤖 Sending batch of {len(file_names)} images to Gemini...")
                response = self.model.generate_content(
                    content,
                    request_options={'timeout': 60}  # Longer timeout for batch
                )
                
                text = response.text
                clean = text.replace("```json", "").replace("```", "").strip()
                
                try:
                    res_array = json.loads(clean)
                except:
                    # Try to extract JSON array
                    match = re.search(r'\[.*\]', clean, re.DOTALL)
                    if match:
                        res_array = json.loads(match.group(0))
                    else:
                        # Fallback - try to parse individual objects
                        res_array = []
                        for m in re.finditer(r'\{[^}]+\}', clean):
                            try:
                                res_array.append(json.loads(m.group(0)))
                            except:
                                pass
                
                # Map results back to filenames
                for item in res_array:
                    file_key = item.get("file", "")
                    decision = item.get("decision", "keep").lower()
                    reason = item.get("reason", "AI Decision")
                    
                    if decision not in ["keep", "trash"]:
                        decision = "keep"
                    
                    # Try exact match first
                    if file_key in file_names:
                        results[file_key] = (decision, f"AI: {reason}")
                        print(f"✅ {file_key} -> {decision.upper()} | {reason}")
                    else:
                        # Try partial match
                        for fn in file_names:
                            if fn not in results and (file_key in fn or fn in file_key):
                                results[fn] = (decision, f"AI: {reason}")
                                print(f"✅ {fn} -> {decision.upper()} | {reason}")
                                break
                
                # Handle any files not in results (default to keep)
                for fn in file_names:
                    if fn not in results:
                        results[fn] = ("keep", "AI: No explicit decision (Safe Keep)")
                        print(f"⚠️ {fn} -> KEEP (No AI response)")
                
                return results
                
            except Exception as e:
                print(f"❌ Batch AI Attempt {attempt+1} Error: {e}")
                if attempt == retries - 1:
                    # Fail open - keep all images
                    for fn in file_names:
                        if fn not in results:
                            results[fn] = ("keep", f"AI Error (Safe Keep): {str(e)}")
                    return results
                time.sleep(2)
        
        return results

    def _finalize(self, file, decision, reason, src_path, dest_dir):
        """Moves file and returns dict"""
        try:
            dest_path = os.path.join(dest_dir, file)
            if os.path.abspath(src_path) != os.path.abspath(dest_path):
                shutil.copy2(src_path, dest_path)
            
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
        Yields analysis results for each image using BATCH processing.
        Optimized for Gemini Free Tier: 15 requests/minute.
        Processes 9-10 images per API call with 4s delay between calls.
        """
        if rejected_dest_dir:
            rejected_dir = rejected_dest_dir
        else:
            rejected_dir = os.path.join(source_folder, "Rejected")

        if not os.path.exists(rejected_dir): os.makedirs(rejected_dir)
        if not os.path.exists(final_dest_dir): os.makedirs(final_dest_dir)

        files = [f for f in os.listdir(source_folder) if f.lower().endswith(('.png', '.jpg', '.jpeg', '.webp'))]
        total = len(files)
        
        if total == 0:
            return
        
        print(f"\n📊 Processing {total} images in batches of {BATCH_SIZE}")
        print(f"⏱️ Rate limit: {REQUEST_DELAY_SECONDS}s between API calls (Free Tier)")
        
        finished_count = 0
        
        # First pass: Local math checks (no API calls)
        files_for_ai = []
        math_results = {}
        
        print("\n📐 Phase 1: Local math filtering...")
        for file in files:
            full_path = os.path.join(source_folder, file)
            should_skip, decision, reason = self._local_math_check(full_path, file)
            
            if should_skip:
                math_results[file] = (decision, reason, full_path)
            else:
                files_for_ai.append(file)
        
        print(f"📐 Math filtered: {len(math_results)} images rejected locally")
        print(f"🤖 Sending {len(files_for_ai)} images to AI in batches...")
        
        # Yield math-filtered results first
        for file, (decision, reason, full_path) in math_results.items():
            finished_count += 1
            dest_dir = rejected_dir if decision == "trash" else final_dest_dir
            result = self._finalize(file, decision, reason, full_path, dest_dir)
            yield {
                "current": finished_count,
                "total": total,
                "file": result['file'],
                "decision": result['decision'],
                "reason": result['reason'],
                "path": result['path']
            }
        
        # Second pass: AI batch processing
        for i in range(0, len(files_for_ai), BATCH_SIZE):
            batch = files_for_ai[i:i + BATCH_SIZE]
            batch_num = (i // BATCH_SIZE) + 1
            total_batches = (len(files_for_ai) + BATCH_SIZE - 1) // BATCH_SIZE
            
            print(f"\n🔄 Processing batch {batch_num}/{total_batches} ({len(batch)} images)...")
            
            # Process batch with AI
            ai_results = self._process_batch_with_ai(batch, source_folder)
            
            # Yield results for this batch
            for file in batch:
                finished_count += 1
                full_path = os.path.join(source_folder, file)
                
                if file in ai_results:
                    decision, reason = ai_results[file]
                else:
                    decision, reason = "keep", "No AI response (Safe Keep)"
                
                dest_dir = rejected_dir if decision == "trash" else final_dest_dir
                result = self._finalize(file, decision, reason, full_path, dest_dir)
                
                yield {
                    "current": finished_count,
                    "total": total,
                    "file": result['file'],
                    "decision": result['decision'],
                    "reason": result['reason'],
                    "path": result['path']
                }
        
        print(f"\n✅ Completed processing {total} images")
