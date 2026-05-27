import sys
import os
from celery import Celery
from celery.schedules import crontab

# Add project root to path
sys.path.append(os.path.abspath(os.path.join(os.path.dirname(__file__), '../../')))

from common.config import Config

def make_celery():
    celery = Celery(
        'kawamonn_platform',
        broker=Config.CELERY_BROKER_URL,
        backend=Config.CELERY_RESULT_BACKEND,
        include=['worker.tasks']
    )
    celery.config_from_object(Config)
    
    # Beat Schedule
    celery.conf.beat_schedule = {
        'check-reminders-daily': {
            'task': 'worker.tasks.check_reminders',
            'schedule': crontab(hour=9, minute=0), # Run daily at 9 AM
        },
        'check-cleanup-daily': {
            'task': 'worker.tasks.check_cleanup',
            'schedule': crontab(hour=10, minute=0), # Run daily at 10 AM
        },
    }
    celery.conf.timezone = 'Asia/Tokyo'
    return celery

celery_app = make_celery()
