import sys
import os
from flask import Flask
# Add project root to path
sys.path.append(os.path.abspath(os.path.join(os.path.dirname(__file__), '../')))

from common.config import Config
from common.database import db
from common.models import User, AuditLog, MailSendLog

app = Flask(__name__)
app.config.from_object(Config)
db.init_app(app)

def init_db():
    with app.app_context():
        # Create DB directory if not exists
        db_path = Config.SQLALCHEMY_DATABASE_URI.replace('sqlite:///', '')
        db_dir = os.path.dirname(db_path)
        if not os.path.exists(db_dir):
            os.makedirs(db_dir)
            
        print(f"Creating database at {db_path}...")
        db.create_all()
        print("Database initialized.")

if __name__ == "__main__":
    init_db()
