import sys
import os
from datetime import datetime
from flask import Flask

# Add project root to path
sys.path.append(os.path.abspath(os.path.join(os.path.dirname(__file__), '../')))

from common.config import Config
from common.database import db
from common.models import User, UserStatus
from common.utils import hash_password

app = Flask(__name__)
app.config.from_object(Config)
db.init_app(app)

def create_admin():
    with app.app_context():
        # Check if exists
        admin = User.query.filter_by(username='kawamonn').first()
        if admin:
            print("Admin already exists. Updating...")
            admin.email = 'kawamonn91@gmail.com'
            admin.password_hash = hash_password('monnmo91')
            admin.is_admin = True
            admin.status = UserStatus.ACTIVE
        else:
            print("Creating new Admin user...")
            admin = User(
                username='kawamonn',
                email='kawamonn91@gmail.com',
                password_hash=hash_password('monnmo91'),
                is_admin=True,
                status=UserStatus.ACTIVE,
                created_at=datetime.utcnow(),
                quota_bytes=0 # Admins might not need quota, or give them some
            )
            
        db.session.add(admin)
        db.session.commit()
        print("Admin user 'kawamonn' configured successfully.")

if __name__ == "__main__":
    create_admin()
