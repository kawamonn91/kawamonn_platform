import os
from dotenv import load_dotenv

# Load environment variables from .env file
load_dotenv(os.path.join(os.path.dirname(os.path.dirname(__file__)), '.env'))

class Config:
    SECRET_KEY = os.environ.get('SECRET_KEY', 'dev_key_please_change')
    SQLALCHEMY_DATABASE_URI = os.environ.get('SQLALCHEMY_DATABASE_URI', 'sqlite:////home/pi/hdd/ssh/kawamonn_platform/users.db')
    SQLALCHEMY_TRACK_MODIFICATIONS = False
    
    # Celery / Redis
    CELERY_BROKER_URL = os.environ.get('CELERY_BROKER_URL', 'redis://localhost:6379/0')
    CELERY_RESULT_BACKEND = os.environ.get('CELERY_RESULT_BACKEND', 'redis://localhost:6379/0')

    # Mailgun
    MAILGUN_API_KEY = os.environ.get('MAILGUN_API_KEY')
    MAILGUN_DOMAIN = os.environ.get('MAILGUN_DOMAIN')
    MAILGUN_API_URL = f"https://api.mailgun.net/v3/{MAILGUN_DOMAIN}"
    MAILGUN_FROM_EMAIL = f"Kawamonn Admin <admin@{MAILGUN_DOMAIN}>"

    # Cloudflare
    CLOUDFLARE_API_TOKEN = os.environ.get('CLOUDFLARE_API_TOKEN')
    CLOUDFLARE_ACCOUNT_ID = os.environ.get('CLOUDFLARE_ACCOUNT_ID')
    CLOUDFLARE_ZONE_ID = os.environ.get('CLOUDFLARE_ZONE_ID')
    CLOUDFLARE_ACCESS_TEAM_DOMAIN = os.environ.get('CLOUDFLARE_ACCESS_TEAM_DOMAIN')
    
    # Paths
    USER_DATA_DIR = '/home/pi/hdd/ssh/users'
    QUOTA_DEFAULT_BYTES = 20 * 1024 * 1024 * 1024  # 20 GB
    
    # Session
    SESSION_COOKIE_DOMAIN = '.kawamonn.com'
    SESSION_COOKIE_NAME = 'kawamonn_session'

    # Security
    BCRYPT_LOG_ROUNDS = 13
