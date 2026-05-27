import unittest
import sys
import os
from flask import Flask

# Add project root to path
sys.path.append(os.path.abspath(os.path.join(os.path.dirname(__file__), '../')))

from common.config import Config
from common.database import db
from common.models import User, UserStatus
from common.utils import hash_password, check_password

class TestModels(unittest.TestCase):
    def setUp(self):
        self.app = Flask(__name__)
        self.app.config['SQLALCHEMY_DATABASE_URI'] = 'sqlite:///:memory:'
        self.app.config['SQLALCHEMY_TRACK_MODIFICATIONS'] = False
        db.init_app(self.app)
        
        with self.app.app_context():
            db.create_all()

    def tearDown(self):
        with self.app.app_context():
            db.session.remove()
            db.drop_all()

    def test_user_creation(self):
        with self.app.app_context():
            user = User(
                username='testuser', 
                email='test@example.com',
                quota_bytes=100
            )
            user.password_hash = hash_password('secret')
            db.session.add(user)
            db.session.commit()
            
            check = User.query.filter_by(username='testuser').first()
            self.assertIsNotNone(check)
            self.assertTrue(check_password('secret', check.password_hash))
            self.assertFalse(check_password('wrong', check.password_hash))

    def test_user_status(self):
        with self.app.app_context():
            user = User(username='u', email='e', status=UserStatus.PENDING)
            db.session.add(user)
            db.session.commit()
            self.assertEqual(user.status, UserStatus.PENDING)

if __name__ == '__main__':
    unittest.main()
