import json
import os

PROJECTS_FILE = "projects.json"

class ProjectsManager:
    @staticmethod
    def load_projects():
        if os.path.exists(PROJECTS_FILE):
            try:
                with open(PROJECTS_FILE, "r", encoding='utf-8') as f:
                    return json.load(f)
            except:
                return []
        return []

    @staticmethod
    def save_project(project_data):
        projects = ProjectsManager.load_projects()
        # Check if update or new
        existing_idx = next((i for i, p in enumerate(projects) if p['id'] == project_data['id']), -1)
        
        if existing_idx >= 0:
            projects[existing_idx] = project_data
        else:
            projects.append(project_data)
            
        with open(PROJECTS_FILE, "w", encoding='utf-8') as f:
            json.dump(projects, f, indent=4, ensure_ascii=False)

    @staticmethod
    def delete_project(project_id):
        projects = ProjectsManager.load_projects()
        projects = [p for p in projects if p['id'] != project_id]
        with open(PROJECTS_FILE, "w", encoding='utf-8') as f:
            json.dump(projects, f, indent=4, ensure_ascii=False)
