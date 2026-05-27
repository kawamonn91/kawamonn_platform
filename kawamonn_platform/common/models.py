from datetime import datetime
from .database import db
import enum

class UserStatus(enum.Enum):
    PENDING = "pending"
    ACTIVE = "active"
    SUSPENDED = "suspended"
    DELETED = "deleted"

from datetime import datetime
from .database import db
import enum
from flask_login import UserMixin

class UserStatus(enum.Enum):
    PENDING = "pending"
    ACTIVE = "active"
    SUSPENDED = "suspended"
    DELETED = "deleted"

class User(UserMixin, db.Model):
    __tablename__ = 'users'

    id = db.Column(db.Integer, primary_key=True)
    username = db.Column(db.String(64), unique=True, nullable=False)
    email = db.Column(db.String(120), unique=True, nullable=False)
    password_hash = db.Column(db.String(128))
    
    created_at = db.Column(db.DateTime, default=datetime.utcnow, nullable=False)
    status = db.Column(db.Enum(UserStatus), default=UserStatus.PENDING, nullable=False)
    
    # Authority
    is_admin = db.Column(db.Boolean, default=False)
    
    # Quota logic
    fs_project_id = db.Column(db.Integer, unique=True, nullable=True) # ID for ext4 project quota
    quota_bytes = db.Column(db.BigInteger, default=21474836480, nullable=False) # 20GB
    used_bytes = db.Column(db.BigInteger, default=0, nullable=False)
    
    # Lifecycle & Security
    password_last_set_at = db.Column(db.DateTime, default=datetime.utcnow)
    expiry_at = db.Column(db.DateTime, nullable=True) # For @u-aizu.ac.jp accounts
    last_reminder_sent = db.Column(db.DateTime, nullable=True)

    def __repr__(self):
        return f'<User {self.username}>'

class AuditLog(db.Model):
    __tablename__ = 'audit_logs'

    id = db.Column(db.Integer, primary_key=True)
    user_id = db.Column(db.Integer, db.ForeignKey('users.id'), nullable=True)
    action = db.Column(db.String(64), nullable=False)
    details = db.Column(db.Text, nullable=True)
    ip_address = db.Column(db.String(45), nullable=True)
    performer_id = db.Column(db.Integer, db.ForeignKey('users.id'), nullable=True) # Who performed the action (e.g. admin)
    timestamp = db.Column(db.DateTime, default=datetime.utcnow, nullable=False)

class MailSendLog(db.Model):
    __tablename__ = 'mail_send_logs'

    id = db.Column(db.Integer, primary_key=True)
    user_id = db.Column(db.Integer, db.ForeignKey('users.id'), nullable=False)
    template_name = db.Column(db.String(64), nullable=False)
    sent_at = db.Column(db.DateTime, default=datetime.utcnow, nullable=False)
    status = db.Column(db.String(20), nullable=False) # 'sent', 'failed'
    response_body = db.Column(db.Text, nullable=True)
