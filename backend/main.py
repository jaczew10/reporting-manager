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
    paths: List[StructurePath]

class Project(BaseModel):
    id: str
    name: str
    manager: str
    cc: str
    structure: List[FolderDef] # This maps to 'structure_raw' in logic to keep editable
    has_photos: bool = True

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
            cleaned_structure.append({"id": f.id, "paths": clean_paths})
            raw_structure.append({"id": f.id, "paths": raw_paths})
    
    # Construct complete dictionary for JSON
    proj_dict = {
        "id": project.id,
        "name": project.name,
        "manager": project.manager,
        "cc": project.cc,
        "structure": cleaned_structure,
        "structure_raw": raw_structure,
        "has_photos": project.has_photos
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
    
    # DEBUG: Print masked keys to console
    ak = data["aws_access_key"]
    sk = data["aws_secret_key"]
    reg = data["aws_region"]
    print(f"DEBUG SAVE: AccessKey len={len(ak)} val={ak[:4]}...{ak[-4:] if len(ak)>4 else ''}")
    print(f"DEBUG SAVE: SecretKey len={len(sk)} val={sk[:4]}...{sk[-4:] if len(sk)>4 else ''}")
    print(f"DEBUG SAVE: Region='{reg}'")

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

        # DEBUG EXECUTION
        print(f"DEBUG EXEC: AccessKey len={len(aws_access_key) if aws_access_key else 0}")
        print(f"DEBUG EXEC: SecretKey len={len(aws_secret_key) if aws_secret_key else 0}")
        print(f"DEBUG EXEC: Region='{aws_region}'")
        print(f"DEBUG EXEC: Bucket='{aws_bucket_name}'")
        
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

        for folder_def in structure_list:
             # Find nice name
             folder_name = f"Folder_{folder_def['id'][:4]}"
             raw_def = next((r for r in proj['structure_raw'] if r['id'] == folder_def['id']), None)
             if raw_def and raw_def['paths'] and raw_def['paths'][0]['code']:
                 folder_name = raw_def['paths'][0]['code']

             yield f"data: {json.dumps({'log': f'Pobieranie plików dla: {folder_name}...'})}\n\n"
             
             dt_from = datetime.datetime.combine(d_from, datetime.time.min)
             dt_to = datetime.datetime.combine(d_to, datetime.time.max)
             
             ftp_adapter = { "Name": folder_name, "RemoteSpecs": folder_def['paths'] }
             
             # TEMP TARGETS
             if is_single_folder:
                 current_download_target = temp_download
                 current_sorted_target = temp_sorted
                 current_rejected_target = trash_preview_root
             else:
                 current_download_target = os.path.join(temp_download, folder_name)
                 current_sorted_target = os.path.join(temp_sorted, folder_name)
                 current_rejected_target = os.path.join(trash_preview_root, folder_name)

             # Download to TEMP RAW
             downloaded_dir, count = ftp.download_files_for_job(ftp_adapter, dt_from, dt_to, temp_download, explicit_target_dir=current_download_target)
             
             if downloaded_dir and count > 0:
                 yield f"data: {json.dumps({'type': 'set_total', 'count': count})}\n\n"
                 if gemini_key:
                     yield f"data: {json.dumps({'log': f'Pobrano {count}. Rozpoczynanie analizy AI...'})}\n\n"
                     try:
                         analyzer = ImageAnalyzer(gemini_key)
                         
                         # Streaming Analysis to TEMP SORTED
                         kept_paths = []
                         # Trash goes to external folder now -> Not in ZIP

                         for res in analyzer.analyze_and_sort_generator(downloaded_dir, current_sorted_target, rejected_dest_dir=current_rejected_target):
                             # Accumulate Keeps
                             if res['decision'] == 'keep':
                                 kept_paths.append(res['path'])
                                 
                             # Stream Result to Frontend
                             event_data = {
                                 "type": "image_result",
                                 "file": res['file'],
                                 "decision": res['decision'],
                                 "path": res['path'], # Path is in temp_sorted, secure served via /image
                                 "current": res['current'],
                                 "total": res['total']
                             }
                             yield f"data: {json.dumps(event_data)}\n\n"
                         
                         kept_count = len(kept_paths)
                         rejected_count = count - kept_count
                         
                         final_report_lines.append(f"Folder {folder_name}: Pobrani {count}, Wybrano {kept_count}, Odrzucono {rejected_count}.")
                         
                         yield f"data: {json.dumps({'log': f'Zakończono analizę folderu. Wybrano {kept_count} zdjęć.'})}\n\n"
                             
                     except Exception as e:
                         yield f"data: {json.dumps({'log': f'Błąd AI: {str(e)}'})}\n\n"
                         final_report_lines.append(f"Folder {folder_name}: Błąd analizy AI: {str(e)}")
                 else:
                     # No AI - Copy everything manually
                     yield f"data: {json.dumps({'log': 'Brak klucza AI. Kopiowanie wszystkich plików...'})}\n\n"
                     if not os.path.exists(current_sorted_target): os.makedirs(current_sorted_target)
                     import distutils.dir_util
                     distutils.dir_util.copy_tree(downloaded_dir, current_sorted_target)
                     final_report_lines.append(f"Folder {folder_name}: {count} pobranych (Brak klucza AI - zachowano wszystkie).")
             else:
                 final_report_lines.append(f"Folder {folder_name}: Brak plików na FTP.")
        
        ftp.disconnect()
        
        # Save Report (In sorted temp, to handle later if needed, but user wants ZIP only images)
        # We will write report to temp_sorted so we have it, BUT we will EXCLUDE it from zip as per previous request.
        report_path = os.path.join(temp_sorted, "report.txt")
        with open(report_path, "w", encoding='utf-8') as f:
            f.write("\n".join(final_report_lines))
            
        # Zip Final Folder (Images ONLY) -> To User Documents
        yield f"data: {json.dumps({'log': 'Pakowanie zdjęć do ZIP (bez raportu)...'})}\n\n"
        
        try:
            import zipfile
            
            # CLEANUP: Remove old zips for this project to keep only one
            try:
                for f in os.listdir(zip_dest_folder):
                    if f.startswith(proj['name']) and f.endswith(".zip"):
                        old_zip_path = os.path.join(zip_dest_folder, f)
                        try:
                            os.remove(old_zip_path)
                            yield f"data: {json.dumps({'log': f'Usunięto stary plik: {f}'})}\n\n"
                        except Exception as e:
                            print(f"Error removing {f}: {e}")
            except Exception as cleanup_error:
                print(f"Cleanup directory scan error: {cleanup_error}")

            zip_name = f"{proj['name']} {date_from}_{date_to}.zip"
            zip_path = os.path.join(zip_dest_folder, zip_name)
            
            allowed_ext = ('.jpg', '.jpeg', '.png', '.webp')
            
            with zipfile.ZipFile(zip_path, 'w', zipfile.ZIP_DEFLATED) as zipf:
                 for root, dirs, files in os.walk(temp_sorted):
                     for file in files:
                         if not file.lower().endswith(allowed_ext):
                             continue
                             
                         file_path = os.path.join(root, file)
                         arcname = os.path.relpath(file_path, temp_sorted)
                         zipf.write(file_path, arcname)
            
            yield f"data: {json.dumps({'log': f'Utworzono ZIP: {zip_name}'})}\n\n"
            
            # S3 UPLOAD
            s3_link = None
            if aws_access_key and aws_secret_key and aws_bucket_name:
                yield f"data: {json.dumps({'log': 'Wysyłanie na serwer S3...'})}\n\n"
                try:
                    from modules.s3_manager import S3Manager
                    s3_mgr = S3Manager(aws_access_key, aws_secret_key, aws_region, aws_bucket_name)
                    s3_link = s3_mgr.upload_and_generate_link(zip_path, zip_name)
                    yield f"data: {json.dumps({'log': 'Wysłano na S3!'})}\n\n"
                except Exception as s3_err:
                     yield f"data: {json.dumps({'log': f'Błąd S3: {s3_err}'})}\n\n"
            
        except Exception as ze:
             yield f"data: {json.dumps({'log': f'Błąd pakowania: {ze}'})}\n\n"

        # Cleanup Temp (Raw only - keep sorted for UI display)
        yield f"data: {json.dumps({'log': 'Sprzątanie plików tymczasowych (RAW)...'})}\n\n"
        try:
            shutil.rmtree(temp_download)
            # shutil.rmtree(temp_sorted) # Keep for UI
        except:
            pass
            
        yield f"data: {json.dumps({'log': 'Zakończono pomyślnie!', 'done': True, 'report': final_report_lines, 's3_link': s3_link})}\n\n"

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
