import boto3
import os
from botocore.exceptions import ClientError
from botocore.client import Config

class S3Manager:
    def __init__(self, access_key, secret_key, region='eu-north-1', bucket='zdjecia-reporting-manager'):
        self.access_key = access_key.strip() if access_key else ""
        self.secret_key = secret_key.strip() if secret_key else ""
        self.region = region.strip() if region else "eu-north-1"
        self.bucket = bucket.strip() if bucket else ""
        self.client = None
        
        if self.access_key and self.secret_key:
            self._init_client()

    def _init_client(self):
        try:
            endpoint_url = f"https://s3.{self.region}.amazonaws.com"
            self.client = boto3.client(
                's3',
                aws_access_key_id=self.access_key,
                aws_secret_access_key=self.secret_key,
                region_name=self.region,
                endpoint_url=endpoint_url,
                config=Config(signature_version='s3v4')
            )
        except Exception as e:
            print(f"S3 Init Error: {e}")

    def upload_and_generate_link(self, file_path, object_name=None):
        if not self.client:
            raise Exception("Brak konfiguracji AWS S3")

        if not os.path.exists(file_path):
            raise Exception("Plik nie istnieje")

        # 1. Prepare Object Name
        if not object_name:
            raw_filename = os.path.basename(file_path)
            object_name = raw_filename.replace(" ", "_")
        else:
             object_name = object_name.replace(" ", "_")

        # 2. Upload
        print(f"S3 Uploading: {object_name}")
        self.client.upload_file(file_path, self.bucket, object_name)

        # 3. Generate Link
        url = self.client.generate_presigned_url(
            'get_object',
            Params={'Bucket': self.bucket, 'Key': object_name},
            ExpiresIn=604800 # 7 days
        )
        return url
