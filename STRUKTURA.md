# 📁 Reporting Manager - Specyfikacja Struktury

## Drzewo Projektu

```
Auto report maker/
│
├── start_app.bat              # Skrypt startowy
├── .gitignore                 # Ignorowane pliki Git
│
└── backend/                   # Aplikacja serwerowa
    ├── main.py                # Główny serwer API
    ├── requirements.txt       # Zależności Python
    ├── projects.json          # Baza projektów
    ├── secrets.json           # Klucze API (poza Git)
    │
    ├── modules/               # Moduły logiki
    │   ├── __init__.py
    │   ├── ftp_manager.py     # Obsługa FTP
    │   ├── image_analyzer.py  # Analiza AI
    │   ├── projects_manager.py# CRUD projektów
    │   └── s3_manager.py      # Upload S3
    │
    └── static/                # Frontend
        ├── index.html         # Strona HTML
        ├── app.js             # Logika JS
        └── style.css          # Style CSS
```

---

## 📄 Szczegółowy Opis Plików

### 🚀 start_app.bat
**Typ:** Skrypt Batch (Windows)  
**Rozmiar:** ~1 KB  
**Odpowiedzialność:**
- Aktywacja środowiska wirtualnego `.venv`
- Instalacja zależności z `backend/requirements.txt`
- Uruchomienie serwera uvicorn na `127.0.0.1:8000`

**Użycie:**
```batch
.\start_app.bat
```

---

### 🔒 .gitignore
**Typ:** Konfiguracja Git  
**Odpowiedzialność:**
- Ignoruje: `.venv/`, `__pycache__/`, `secrets.json`, `*.zip`, `temp_raw_download/`

---

## 📂 backend/

### 🔹 main.py
**Typ:** Python (FastAPI)  
**Rozmiar:** ~18 KB, ~450 linii  
**Odpowiedzialność:** Główny serwer REST API

| Endpoint | Metoda | Opis |
|----------|--------|------|
| `/` | GET | Serwuje `index.html` |
| `/projects` | GET | Lista wszystkich projektów |
| `/projects` | POST | Tworzy/aktualizuje projekt |
| `/projects/{id}` | DELETE | Usuwa projekt |
| `/settings` | GET | Pobiera konfigurację |
| `/settings` | POST | Zapisuje konfigurację |
| `/execute` | POST | Uruchamia procesowanie (SSE stream) |
| `/image` | GET | Zwraca zdjęcie do podglądu |
| `/download_zip` | GET | Pobiera wygenerowany ZIP |

**Kluczowe funkcje:**
- `execution_generator()` - generator SSE dla real-time aktualizacji UI

---

### 📦 requirements.txt
**Typ:** Lista zależności Python  
**Zawartość:**
```
fastapi          # Framework API
uvicorn          # Serwer ASGI
python-multipart # Upload plików
boto3            # AWS SDK
google-generativeai  # Gemini AI
pillow           # Obsługa obrazów
python-dateutil  # Parsowanie dat
aiofiles         # Async pliki
opencv-python    # Analiza obrazu
numpy            # Obliczenia numeryczne
```

---

### 💾 projects.json
**Typ:** Baza danych JSON  
**Struktura pojedynczego projektu:**
```json
{
  "id": "uuid",
  "name": "Nazwa Projektu",
  "manager": "email@example.com",
  "cc": "cc1@example.com, cc2@example.com",
  "structure": [
    {
      "id": "uuid",
      "name": "Folder Name",
      "paths": ["/{yyyy}/code/{yyyy-MM}/suffix"]
    }
  ],
  "structure_raw": [...],
  "has_photos": true,
  "power_bi_links": ["https://..."],
  "excel_paths": [],
  "email_template": "Treść maila..."
}
```

---

### 🔐 secrets.json
**Typ:** Konfiguracja poufna (**NIE W REPOZYTORIUM**)  
**Struktura:**
```json
{
  "ftp_host": "webas67993.tld.pl",
  "ftp_user": "jjaczewski",
  "ftp_pass": "********",
  "gemini_key": "AIza...",
  "aws_access_key": "AKIA...",
  "aws_secret_key": "********",
  "aws_bucket_name": "bucket-name",
  "aws_region": "eu-north-1"
}
```

---

## 📂 backend/modules/

### 📡 ftp_manager.py
**Typ:** Python  
**Rozmiar:** ~6 KB, 161 linii  
**Klasa:** `FTPManager`

| Metoda | Opis |
|--------|------|
| `connect()` | Nawiązuje połączenie FTP |
| `disconnect()` | Zamyka połączenie |
| `get_months_between(start, end)` | Lista miesięcy w zakresie |
| `expand_remote_paths(months, specs)` | Rozszerza szablony: `{yyyy}`, `{yyyy-MM}`, `{quarter}` |
| `download_files_for_job(job, date_from, date_to, local_root)` | Pobiera pliki wg daty |

**Filtrowanie plików:**
- Po nazwie (regex: `YYYY-MM-DD`)
- Po dacie modyfikacji (MDTM command)

---

### 🤖 image_analyzer.py
**Typ:** Python  
**Rozmiar:** ~11 KB, 262 linie  
**Klasa:** `ImageAnalyzer`

| Metoda | Opis |
|--------|------|
| `_get_best_model()` | Automatycznie wybiera model Gemini |
| `_prepare_image_for_api(path)` | Kompresja do 480px WEBP |
| `_process_single_image(file_info)` | Główna analiza (Math + AI) |
| `_finalize(file, decision, reason, src, dest)` | Przenosi plik do docelowego folderu |
| `analyze_and_sort_generator(source, dest)` | Generator wyników (10 wątków) |

**Dwuetapowe filtrowanie:**
1. **Math Gatekeeper:**
   - `std < 15` → jednolity kolor → TRASH
   - `blur < 30` (Laplacian variance) → rozmazane → TRASH

2. **AI Micro-Proxy (Gemini):**
   - KEEP: półki, produkty, ekspozycje, paragony
   - TRASH: sufit, podłoga, zewnątrz, kieszeń

---

### 📋 projects_manager.py
**Typ:** Python  
**Rozmiar:** ~1 KB, 37 linii  
**Klasa:** `ProjectsManager` (static methods)

| Metoda | Opis |
|--------|------|
| `load_projects()` | Wczytuje `projects.json` |
| `save_project(data)` | Zapisuje/aktualizuje projekt |
| `delete_project(id)` | Usuwa projekt po ID |

---

### ☁️ s3_manager.py
**Typ:** Python  
**Rozmiar:** ~2 KB, 56 linii  
**Klasa:** `S3Manager`

| Metoda | Opis |
|--------|------|
| `__init__(access_key, secret_key, region, bucket)` | Inicjalizacja klienta boto3 |
| `upload_and_generate_link(file_path, object_name)` | Upload + presigned URL (7 dni) |

---

## 📂 backend/static/

### 🌐 index.html
**Typ:** HTML5  
**Rozmiar:** ~16 KB, 316 linii  
**Zawartość:**

| Sekcja | ID | Opis |
|--------|-----|------|
| Sidebar | `.sidebar` | Nawigacja + ustawienia |
| Projekty | `#tab-projects` | Lista projektów |
| Kreator | `#tab-create` | Formularz tworzenia projektu |
| Procesowanie | `#tab-process` | Dashboard wykonania |
| ZIP Popup | `#zipPopup` | Powiadomienie o gotowym ZIP |
| Lightbox | `#lightbox` | Podgląd zdjęcia na pełnym ekranie |

---

### ⚙️ app.js
**Typ:** JavaScript (ES6)  
**Rozmiar:** ~53 KB, 1279 linii  
**Główne funkcje:**

| Funkcja | Linie | Opis |
|---------|-------|------|
| `fetchProjects()` | 61-70 | Pobiera listę projektów |
| `renderProjects()` | 75-129 | Renderuje karty projektów |
| `initCreator()` | 169-193 | Inicjuje formularz nowego projektu |
| `editProject(id)` | 195-240 | Wypełnia formularz do edycji |
| `saveProject()` | 452-509 | Zapisuje projekt przez API |
| `initExecution(id)` | 597-673 | Przygotowuje dashboard |
| `runTask(id, from, to)` | 684-967 | Główne procesowanie (SSE) |
| `changePage(type, delta)` | 517-534 | Paginacja zdjęć |
| `openMailClient()` | ~1200 | Otwiera klienta e-mail |

**Stan globalny:**
- `projects[]` - lista projektów
- `folders[]` - foldery w kreatorze
- `allKeep[]`, `allTrash[]` - zdjęcia w bucketach
- `currentProcessingProject` - aktualnie przetwarzany projekt

---

### 🎨 style.css
**Typ:** CSS3  
**Rozmiar:** ~14 KB, 808 linii  
**Sekcje:**

| Sekcja | Linie | Opis |
|--------|-------|------|
| Variables | 1-10 | Kolory: `--bg`, `--surface`, `--primary`, `--accent` |
| Scrollbars | 16-33 | Custom scrollbary webkit |
| Sidebar | 49-138 | Nawigacja boczna |
| Content | 175-215 | Główna zawartość |
| Projects Grid | 216-280 | Karty projektów |
| Process View | 327-478 | Dashboard procesowania |
| Buckets | 470-555 | Kontenery KEEP/TRASH |
| Lightbox | 590-624 | Modal ze zdjęciem |
| Forms | 656-756 | Kreator projektów |

**Theme:** Dark mode z gradientami (purple/blue)

---

## 🔄 Flow Danych

```
┌─────────────┐     ┌─────────────┐     ┌─────────────┐
│   Frontend  │────▶│   FastAPI   │────▶│     FTP     │
│  (app.js)   │◀────│  (main.py)  │◀────│   Server    │
└─────────────┘     └─────────────┘     └─────────────┘
      │                    │
      │ SSE                │
      ▼                    ▼
┌─────────────┐     ┌─────────────┐     ┌─────────────┐
│   UI Live   │     │  Gemini AI  │────▶│   AWS S3    │
│   Updates   │     │  (analyze)  │     │  (upload)   │
└─────────────┘     └─────────────┘     └─────────────┘
```

---

## 📝 Uwagi

- Wszystkie ścieżki FTP używają szablonów: `{yyyy}`, `{yyyy-MM}`, `{quarter}`
- ZIPy są zapisywane w `~/Documents/Sorted Photos/`
- Odrzucone zdjęcia trafiają do `~/Documents/Sorted Photos/Odrzucone/`
- Presigned URL z S3 jest ważny 7 dni
