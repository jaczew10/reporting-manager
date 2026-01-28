from fastapi import FastAPI, HTTPException, Request
from fastapi.staticfiles import StaticFiles
from fastapi.responses import StreamingResponse, FileResponse
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
import shutil
import os
import json
import datetime
from typing import List

from modules.projects_manager import ProjectsManager
from modules.ftp_manager import FTPManager
from modules.image_analyzer import ImageAnalyzer

app = FastAPI()

# --- STARTUP CLEANUP ---
# Clean up all temporary files from previous sessions to prevent clutter
base_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
temp_root = os.path.join(base_dir, "temp_raw_download")
if os.path.exists(temp_root):
    try:
        shutil.rmtree(temp_root)
        os.makedirs(temp_root)
    except Exception as e:
        print(f"Startup cleanup error: {e}")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Serve Static
app.mount("/static", StaticFiles(directory="static"), name="static")

@app.get("/")
async def read_index():
    return FileResponse('static/index.html')

# --- MODELS ---
class StructurePath(BaseModel):
    code: str
    suffix: str

class FolderDef(BaseModel):
    id: str
    name: str = "" # User defined name
    paths: List[StructurePath]

class Project(BaseModel):
    id: str
    name: str
    manager: str
    cc: str
    structure: List[FolderDef] # This maps to 'structure_raw' in logic to keep editable
    has_photos: bool = True
    power_bi_links: List[str] = []
    excel_paths: List[str] = []
    email_template: str = ""

class ExecutionRequest(BaseModel):
    project_id: str
    date_from: str # YYYY-MM-DD
    date_to: str   # YYYY-MM-DD

class Settings(BaseModel):
    ftp_host: str
    ftp_user: str
    ftp_pass: str
    gemini_key: str
    aws_access_key: str = ""
    aws_secret_key: str = ""
    aws_bucket_name: str = ""
    aws_region: str = ""

# --- ENDPOINTS ---

@app.get("/projects")
def get_projects():
    return ProjectsManager.load_projects()

@app.post("/projects")
def save_project(project: Project):
    # Retrieve existing to preserve any fields if needed, but we overwrite mostly.
    # We need to generate the 'clean' structure for the backend logic (list of strings)
    # Project model follows structure_raw format (dicts).
    
    cleaned_structure = []
    raw_structure = []
    
    for f in project.structure:
        clean_paths = []
        raw_paths = []
        for p in f.paths:
            c = p.code.strip().strip('/')
            s = p.suffix.strip().strip('/')
            
            if c or s:
                raw_paths.append({"code": p.code, "suffix": p.suffix})
            
            if c and s:
                 clean_paths.append(f"/{{yyyy}}/{c}/{{yyyy-MM}}/{s}")
                 clean_paths.append(f"/{{yyyy}}/{{quarter}}/{c}/{{yyyy-MM}}/{s}")
        
        if clean_paths:
            cleaned_structure.append({"id": f.id, "name": f.name, "paths": clean_paths})
            raw_structure.append({"id": f.id, "name": f.name, "paths": raw_paths})
    
    # Construct complete dictionary for JSON
    proj_dict = {
        "id": project.id,
        "name": project.name,
        "manager": project.manager,
        "cc": project.cc,
        "structure": cleaned_structure,
        "structure_raw": raw_structure,
        "has_photos": project.has_photos,
        "power_bi_links": project.power_bi_links,
        "excel_paths": project.excel_paths,
        "email_template": project.email_template
    }
    ProjectsManager.save_project(proj_dict)
    return {"status": "ok", "project": proj_dict}

@app.delete("/projects/{id}")
def delete_project(id: str):
    ProjectsManager.delete_project(id)
    return {"status": "deleted"}

@app.get("/settings")
def get_settings():
    if os.path.exists("secrets.json"):
        try:
            with open("secrets.json", "r") as f:
                data = json.load(f)
                return {
                    "ftp_host": data.get("ftp_host", "webas67993.tld.pl"),
                    "ftp_user": data.get("ftp_user", "jjaczewski"),
                    "ftp_pass": data.get("ftp_pass", ""),
                    "gemini_key": data.get("gemini_key", ""),
                    "aws_access_key": data.get("aws_access_key", ""),
                    "aws_secret_key": data.get("aws_secret_key", ""),
                    "aws_bucket_name": data.get("aws_bucket_name", ""),
                    "aws_region": data.get("aws_region", "")
                }
        except:
            pass
    return {
        "ftp_host": "webas67993.tld.pl", 
        "ftp_user": "jjaczewski", 
        "ftp_pass": "", 
        "gemini_key": "",
        "aws_access_key": "",
        "aws_secret_key": "",
        "aws_bucket_name": "",
        "aws_region": ""
    }

@app.post("/settings")
def save_settings(settings: Settings):
    data = {
        "ftp_host": settings.ftp_host.strip() if settings.ftp_host else "",
        "ftp_user": settings.ftp_user.strip() if settings.ftp_user else "",
        "ftp_pass": settings.ftp_pass.strip() if settings.ftp_pass else "",
        "gemini_key": settings.gemini_key.strip() if settings.gemini_key else "",
        "aws_access_key": settings.aws_access_key.strip() if settings.aws_access_key else "",
        "aws_secret_key": settings.aws_secret_key.strip() if settings.aws_secret_key else "",
        "aws_bucket_name": settings.aws_bucket_name.strip() if settings.aws_bucket_name else "",
        "aws_region": settings.aws_region.strip() if settings.aws_region else ""
    }


    with open("secrets.json", "w") as f:
        json.dump(data, f)
    return {"status": "saved"}

# --- EXECUTION STREAMS ---
async def execution_generator(project_id: str, date_from: str, date_to: str):
    yield f"data: {json.dumps({'log': 'Rozpoczynanie zadania...'})}\n\n"
    
    try:
        # Load project
        projects = ProjectsManager.load_projects()
        proj = next((p for p in projects if p['id'] == project_id), None)
        if not proj:
            yield f"data: {json.dumps({'error': 'Projekt nie istnieje'})}\n\n"
            return

        # Load secrets
        secrets = {}
        if os.path.exists("secrets.json"):
             with open("secrets.json") as f: secrets = json.load(f)
        
        ftp_pass = secrets.get("ftp_pass")
        gemini_key = secrets.get("gemini_key")
        
        # AWS Credentials
        aws_access_key = secrets.get("aws_access_key")
        aws_secret_key = secrets.get("aws_secret_key")
        aws_bucket_name = secrets.get("aws_bucket_name")
        aws_region = secrets.get("aws_region")


        if not ftp_pass:
            yield f"data: {json.dumps({'error': 'Brak hasła FTP'})}\n\n"
            return
            
        # Parse dates
        d_from = datetime.datetime.strptime(date_from, "%Y-%m-%d").date()
        d_to = datetime.datetime.strptime(date_to, "%Y-%m-%d").date()
        
        # Connect FTP
        yield f"data: {json.dumps({'log': 'Łączenie z FTP...'})}\n\n"
        ftp = FTPManager("webas67993.tld.pl", "jjaczewski", ftp_pass)
        if not ftp.connect():
             yield f"data: {json.dumps({'error': 'Błąd połączenia FTP'})}\n\n"
             return

        # Prepare output
        final_report_lines = []
        # We need absolute path for output relative to Backend? Or Root? 
        # Cwd is backend/ when running main.py usually, or we fix path.
        # 1. Define Paths
        base_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
        
        # Final User Output Directory (For ZIPs only)
        user_docs = os.path.expanduser("~/Documents")
        zip_dest_folder = os.path.join(user_docs, "Sorted Photos")
        if not os.path.exists(zip_dest_folder): os.makedirs(zip_dest_folder)
        
        # TRASH PREVIEW (External to ZIP)
        trash_preview_root = os.path.join(zip_dest_folder, "Odrzucone")
        # Clear previous trash to ensure only current run is visible
        if os.path.exists(trash_preview_root):
            try: shutil.rmtree(trash_preview_root)
            except: pass
        os.makedirs(trash_preview_root)

        # Working Directories (Hidden)
        # Temp Download: Raw files
        temp_download = os.path.join(base_dir, "temp_raw_download", f"{project_id}_{date_from}_raw")
        if os.path.exists(temp_download): shutil.rmtree(temp_download)
        os.makedirs(temp_download)

        # Temp Sorted: Keepers (before zipping)
        # We process images here, then zip this folder
        temp_sorted = os.path.join(base_dir, "temp_raw_download", f"{project_id}_{date_from}_sorted")
        if os.path.exists(temp_sorted): shutil.rmtree(temp_sorted)
        os.makedirs(temp_sorted)

        yield f"data: {json.dumps({'log': f'Folder roboczy: {temp_download}'})}\n\n"
        
        # Loop structure
        structure_list = proj['structure']
        is_single_folder = (len(structure_list) == 1)

        s3_links = []
        final_report_lines = []

        # --- HELPER: Sequential Processing Generator ---
        def process_folder_sequence(f_def, is_single_mode, s3_list_acc):
             # 1. RESOLVE NAME
             f_name = f_def.get('name', '').strip()
             f_id = f_def['id']
             
             # Fallback name logic matches UI
             if not f_name: f_name = f"Folder_{f_id[:4]}"
             
             # Safe FS Name
             safe_f_name = "".join([c for c in f_name if c.isalpha() or c.isdigit() or c in (' ', '-', '_')]).strip()
             if not safe_f_name: safe_f_name = f"Folder_{f_id[:4]}"
             
             # 2. SETUP PATHS
             if is_single_mode:
                 # Single mode: Use roots directly to detect 'project' files at top level
                 curr_dl_target = temp_download
                 curr_sorted_target = temp_sorted
                 curr_trash_target = trash_preview_root
             else:
                 # Multi mode: Subfolders
                 curr_dl_target = os.path.join(temp_download, safe_f_name)
                 curr_sorted_target = os.path.join(temp_sorted, safe_f_name)
                 curr_trash_target = os.path.join(trash_preview_root, safe_f_name)

             # 3. DOWNLOAD
             yield f"data: {json.dumps({'log': f'Pobieranie plików: {f_name}...'})}\n\n"
             
             # Adapter for this specific folder paths
             f_adapter = { "Name": f_name, "RemoteSpecs": f_def['paths'] }
             
             # Time range
             dt_f = datetime.datetime.combine(d_from, datetime.time.min)
             dt_t = datetime.datetime.combine(d_to, datetime.time.max)
             
             d_dir, count = ftp.download_files_for_job(f_adapter, dt_f, dt_t, temp_download, explicit_target_dir=curr_dl_target)
             
             fin_kept = 0
             fin_total = count
             
             if d_dir and count > 0:
                 # Notify Frontend: Set Total
                 yield f"data: {json.dumps({'type': 'set_total', 'count': count, 'folder': f_name})}\n\n"
                 
                 # 4. ANALYZE
                 if gemini_key:
                     yield f"data: {json.dumps({'log': f'Analiza AI: {f_name}...'})}\n\n"
                     try:
                         analyzer = ImageAnalyzer(gemini_key)
                         
                         analyzed_count = 0
                         
                         for res in analyzer.analyze_and_sort_generator(d_dir, curr_sorted_target, rejected_dest_dir=curr_trash_target):
                             if res['decision'] == 'keep':
                                 fin_kept += 1
                             analyzed_count += 1
                             
                             event_data = {
                                 "type": "image_result",
                                 "file": res['file'],
                                 "decision": res['decision'],
                                 "path": res['path'],
                                 "current": res['current'],
                                 "total": res['total']
                             }
                             yield f"data: {json.dumps(event_data)}\n\n"
                         
                         msg_res = f"Folder {f_name}: Pobrani {count}, Wybrano {fin_kept}."
                         final_report_lines.append(msg_res)
                         yield f"data: {json.dumps({'log': f'Zakończono analizę {f_name}.'})}\n\n"
                         
                     except Exception as ae:
                         err_msg = f"Błąd AI ({f_name}): {str(ae)}"
                         yield f"data: {json.dumps({'log': err_msg})}\n\n"
                         final_report_lines.append(f"Folder {f_name}: {err_msg}")
                 else:
                     # No AI: Copy Loop
                     yield f"data: {json.dumps({'log': f'Kopiowanie (bez AI): {f_name}...'})}\n\n"
                     if not os.path.exists(curr_sorted_target): os.makedirs(curr_sorted_target)
                     import distutils.dir_util
                     distutils.dir_util.copy_tree(d_dir, curr_sorted_target)
                     fin_kept = count
                     final_report_lines.append(f"Folder {f_name}: {count} pobranych (Bez AI).")
             else:
                 yield f"data: {json.dumps({'log': f'Brak plików na FTP: {f_name}.'})}\n\n"
                 final_report_lines.append(f"Folder {f_name}: Brak plików.")
                 return

             # 5. ZIP & UPLOAD
             # Check if we have anything sorted
             if not os.path.exists(curr_sorted_target) or not os.listdir(curr_sorted_target):
                 return

             yield f"data: {json.dumps({'type': 'upload_start', 'folder': f_name})}\n\n"
             
             # Calculate Zip Name
             if is_single_mode:
                 zip_basename = proj['name']
             else:
                 zip_basename = f"{proj['name']} {safe_f_name}"
             
             zip_filename = f"{zip_basename} {date_from}_{date_to}.zip"
             zip_path = os.path.join(zip_dest_folder, zip_filename)
             
             yield f"data: {json.dumps({'log': f'Tworzenie ZIP: {zip_filename}...'})}\n\n"
             
             try:
                 import zipfile
                 allowed_ext = ('.jpg', '.jpeg', '.png', '.webp')
                 
                 with zipfile.ZipFile(zip_path, 'w', zipfile.ZIP_DEFLATED) as zipf:
                     for root, dirs, files in os.walk(curr_sorted_target):
                         for file in files:
                             if not file.lower().endswith(allowed_ext): continue
                             file_path = os.path.join(root, file)
                             arcname = os.path.relpath(file_path, curr_sorted_target)
                             zipf.write(file_path, arcname)
                 
                 # S3 Upload
                 if aws_access_key and aws_secret_key and aws_bucket_name:
                     yield f"data: {json.dumps({'log': f'Wysyłanie na S3...'})}\n\n"
                     from modules.s3_manager import S3Manager
                     s3_mgr = S3Manager(aws_access_key, aws_secret_key, aws_region, aws_bucket_name)
                     link = s3_mgr.upload_and_generate_link(zip_path, zip_filename)
                     
                     yield f"data: {json.dumps({'log': f'Gotowe! Link dla {f_name}.'})}\n\n"
                     yield f"data: {json.dumps({'type': 'link_result', 'link': link, 'folder': f_name})}\n\n"
                     
                     # Append to accumulator
                     s3_list_acc.append(link)
                     return
                 else:
                     yield f"data: {json.dumps({'log': 'Pominięto S3 (brak konfiguracji).'})}\n\n"
                     return
                     
             except Exception as ze:
                 yield f"data: {json.dumps({'log': f'Błąd ZIP/Upload: {ze}'})}\n\n"
                 return

        # --- EXECUTE LOOP ---
        for folder_def in structure_list:
            for msg in process_folder_sequence(folder_def, is_single_folder, s3_links):
                yield msg

        ftp.disconnect()
        
        # Cleanup
        try:
             shutil.rmtree(temp_download)
             # shutil.rmtree(temp_sorted) # Keep for UI
        except: pass

        yield f"data: {json.dumps({'log': 'Wszystkie zadania zakończone!', 'done': True, 'report': final_report_lines, 's3_links': s3_links, 's3_link': (s3_links[0] if s3_links else None)})}\n\n"

    except Exception as e:
        yield f"data: {json.dumps({'error': str(e)})}\n\n"


@app.get("/image")
async def get_image(path: str):
    # Security check: Ensure path exists and is a file
    if os.path.exists(path) and os.path.isfile(path):
        return FileResponse(path)
    return HTTPException(status_code=404, detail="Image not found")

@app.get("/download_zip")
async def download_zip(filename: str):
    user_docs = os.path.expanduser("~/Documents")
    zip_dest_folder = os.path.join(user_docs, "Sorted Photos")
    path = os.path.join(zip_dest_folder, filename)
    
    if os.path.exists(path) and os.path.isfile(path):
        return FileResponse(path, filename=filename)
    return HTTPException(status_code=404, detail="File not found")

@app.post("/execute")
async def execute_project(req: ExecutionRequest):
    return StreamingResponse(execution_generator(req.project_id, req.date_from, req.date_to), media_type="text/event-stream")

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
