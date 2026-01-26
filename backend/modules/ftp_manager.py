import ftplib
import os
import datetime
import calendar
from dateutil import parser

class FTPManager:
    def __init__(self, host, user, password):
        self.host = host
        self.user = user
        self.password = password
        self.ftp = None

    def connect(self):
        try:
            self.ftp = ftplib.FTP()
            self.ftp.connect(self.host, 21)
            self.ftp.login(self.user, self.password)
            # UTF-8 support if available
            try:
                self.ftp.encoding = "utf-8"
            except:
                pass
            return True
        except Exception as e:
            print(f"FTP Connection Error: {e}")
            return False

    def disconnect(self):
        if self.ftp:
            try:
                self.ftp.quit()
            except:
                self.ftp.close()

    def get_month_range(self, date_obj):
        first_day = date_obj.replace(day=1)
        _, last_day_num = calendar.monthrange(date_obj.year, date_obj.month)
        last_day = date_obj.replace(day=last_day_num)
        return first_day, last_day

    def is_first_monday(self, date_obj):
        first_day = date_obj.replace(day=1)
        days_ahead = 0 - first_day.weekday()
        if days_ahead < 0:
            days_ahead += 7
        first_monday = first_day + datetime.timedelta(days=days_ahead)
        return date_obj.date() == first_monday.date()

    def get_months_between(self, start_date, end_date):
        months = []
        cur = start_date.replace(day=1)
        end = end_date.replace(day=1)
        while cur <= end:
            months.append(cur.strftime("%Y-%m"))
            month = cur.month
            year = cur.year + month // 12
            month = month % 12 + 1
            cur = cur.replace(year=year, month=month, day=1)
        return months

    def expand_remote_paths(self, months, specs):
        paths = set()
        for m in months:
            # m is "YYYY-MM"
            parts = m.split('-')
            year = parts[0]
            month_int = int(parts[1])
            
            # Calculate quarter (q1, q2...)
            q_num = (month_int - 1) // 3 + 1
            quarter = f"q{q_num}"
            
            for s in specs:
                p = s.replace("{yyyy}", year).replace("{yyyy-MM}", m).replace("{quarter}", quarter)
                paths.add(p)
        return list(paths)

    def download_files_for_job(self, job, date_from, date_to, local_root, explicit_target_dir=None):
        if explicit_target_dir:
            target_dir = explicit_target_dir
        else:
            folder_name = f"{job['Name']} {date_from.strftime('%d-%m')} - {date_to.strftime('%d-%m-%Y')}"
            target_dir = os.path.join(local_root, folder_name)
        
        months = self.get_months_between(date_from, date_to)
        remote_paths = self.expand_remote_paths(months, job["RemoteSpecs"])
        
        files_downloaded = []
        
        if not os.path.exists(target_dir):
            os.makedirs(target_dir)

        # Helper to parse filename date
        def get_date_from_filename(fname):
            import re
            # Match 2024-01-01, 2024.01.01, 20240101, etc.
            match = re.search(r'(?P<y>\d{4})[-_.]?(?P<m>\d{2})[-_.]?(?P<d>\d{2})', fname)
            if match:
                try:
                    d = datetime.datetime(
                        int(match.group('y')), 
                        int(match.group('m')), 
                        int(match.group('d'))
                    )
                    return d
                except:
                    pass
            return None

        for rp in remote_paths:
            try:
                try:
                    self.ftp.cwd(rp)
                except ftplib.error_perm:
                    continue # Directory likely doesn't exist

                # Get file list
                try:
                    filenames = self.ftp.nlst()
                except ftplib.error_perm:
                     # Empty directory or permissions
                    filenames = []

                for fname in filenames:
                    # Skip . and ..
                    if fname in ['.', '..']:
                        continue
                        
                    f_date = get_date_from_filename(fname)
                    
                    if not f_date:
                        # Try MDTM
                        try:
                            mdtm_resp = self.ftp.voidcmd(f"MDTM {fname}")
                            # Response format: 213 YYYYMMDDHHMMSS
                            time_str = mdtm_resp[4:].strip()
                            f_date = datetime.datetime.strptime(time_str, "%Y%m%d%H%M%S")
                        except:
                            # If MDTM fails, skip filtering or assume today? 
                            # Safe to skip if we can't verify date.
                            continue

                    if date_from <= f_date <= date_to:
                        local_path = os.path.join(target_dir, fname)
                        with open(local_path, 'wb') as f:
                            self.ftp.retrbinary(f"RETR {fname}", f.write)
                        files_downloaded.append(local_path)
            except Exception as e:
                print(f"Error processing {rp}: {e}")

        # Cleanup if empty
        if not files_downloaded:
            try:
                os.rmdir(target_dir)
            except:
                pass
            return None, 0
        
        return target_dir, len(files_downloaded)
