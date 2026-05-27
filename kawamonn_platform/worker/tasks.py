import sys
import os
import subprocess
from datetime import datetime, timedelta
from worker.celery_app import celery_app
from common.database import db
from common.models import User, UserStatus, MailSendLog
from common.utils import send_email
from common.config import Config
from flask import Flask

# Flask app context for DB access
app = Flask(__name__)
app.config.from_object(Config)
db.init_app(app)

@celery_app.task(bind=True, max_retries=3)
def send_reminder_email(self, user_id, template_type, days_left):
    with app.app_context():
        user = User.query.get(user_id)
        if not user:
            return "User not found"

        subject = f"Kawamonn Account Expiry Reminder: {days_left} days left"
        body = f"""Hello {user.username},
        
This is a reminder that your account (@u-aizu.ac.jp) will expire on {user.expiry_at.strftime('%Y-%m-%d')}.
You have {days_left} days remaining.

Please download your files before expiry.
After expiry, your account and data will be deleted.

Management Console: https://account.kawamonn.com
"""
        if template_type == 'final':
            subject = "FINAL NOTICE: Account Deletion Imminent"
            body = f"""Hello {user.username},

This is your FINAL NOTICE.
Your account will expire and be DELETED in {days_left} days on {user.expiry_at.strftime('%Y-%m-%d')}.

Please backup your data immediately.
"""

        success, response = send_email(user.email, subject, body)
        
        # Log
        log = MailSendLog(
            user_id=user.id,
            template_name=template_type,
            status='sent' if success else 'failed',
            response_body=str(response)
        )
        db.session.add(log)
        
        if success:
            user.last_reminder_sent = datetime.utcnow()
            db.session.commit()
        else:
            db.session.commit()
            # Retry
            raise self.retry(exc=Exception(response), countdown=60 * 5) # 5 min backoff

@celery_app.task
def check_reminders():
    with app.app_context():
        now = datetime.utcnow()
        users = User.query.filter(User.expiry_at != None, User.status == UserStatus.ACTIVE).all()
        
        for user in users:
            # Check if already sent today
            if user.last_reminder_sent and user.last_reminder_sent.date() == now.date():
                continue
                
            days_left = (user.expiry_at - now).days
            
            should_send = False
            template = 'standard'
            
            # Monthly: 6, 5, 4, 3, 2, 1 months (approx 30 days)
            # We match ranges to catch if script runs slightly off?
            # Or just check exact day? Exact day is risky if script fails one day.
            # Range check:
            # 6mo = 180d. If days_left between 179 and 181?
            # Or just check if days_left in specific set
            check_days = [180, 150, 120, 90, 60]
            if days_left in check_days:
                should_send = True
            
            # Final Notice (1 mo)
            if days_left == 30:
                should_send = True
                template = 'final'
                
            # Daily last week: 7, 6, 5, 4, 3, 2, 1
            if 0 < days_left <= 7:
                should_send = True
                if days_left <= 3:
                     template = 'final'
            
            if should_send:
                send_reminder_email.delay(user.id, template, days_left)

@celery_app.task
def check_cleanup():
    with app.app_context():
        now = datetime.utcnow()
        # Find expired users
        # Expiry is EXACT date. So if now > expiry_at, delete.
        expired_users = User.query.filter(User.expiry_at < now, User.status != UserStatus.DELETED).all()
        
        for user in expired_users:
            try:
                # Execute deletion script
                # Requirement: Archive or Delete. We default to Archive for safety?
                # User config says "Delete or Archive". Let's Archive then Delete.
                script_path = os.path.abspath('/home/pi/hdd/ssh/kawamonn_platform/scripts/delete_user.sh')
                subprocess.check_call(['sudo', script_path, user.username, 'archive'])
                
                user.status = UserStatus.DELETED
                db.session.commit()
                print(f"User {user.username} expired and archived/deleted.")
                
            except Exception as e:
                print(f"Failed to cleanup user {user.username}: {e}")

