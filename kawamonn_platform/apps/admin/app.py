import sys
import os
import subprocess
import secrets
import string
import random
from datetime import datetime
from flask import Flask, render_template, redirect, url_for, flash, request, abort, session
from sqlalchemy import or_, desc
from flask_login import LoginManager, login_user, logout_user, login_required, current_user

# Add project root to path
sys.path.append(os.path.abspath(os.path.join(os.path.dirname(__file__), '../../')))

from common.config import Config
from common.database import db
from common.models import User, AuditLog, MailSendLog, UserStatus
from common.utils import hash_password, check_password, format_bytes, send_email

app = Flask(__name__)
app.config.from_object(Config)
db.init_app(app)

login_manager = LoginManager()
login_manager.init_app(app)
login_manager.login_view = 'login'

@login_manager.user_loader
def load_user(user_id):
    return User.query.get(int(user_id))

# Helper to log actions
def log_audit(action, details, user_id=None):
    admin_id = current_user.id if current_user.is_authenticated else None
    log = AuditLog(
        action=action,
        details=details,
        user_id=user_id,
        performer_id=admin_id,
        ip_address=request.remote_addr
    )
    db.session.add(log)
    db.session.commit()

# --- Login & 2FA Routes ---
@app.route('/login', methods=['GET', 'POST'])
def login():
    if current_user.is_authenticated:
        if current_user.is_admin:
            return redirect(url_for('dashboard'))
        else:
            flash('Access denied.', 'danger')
            logout_user()
            return redirect(url_for('login'))
            
    if request.method == 'POST':
        # Step 1: Check credentials
        username = request.form.get('username')
        password = request.form.get('password')
        
        user = User.query.filter_by(username=username).first()
        
        if user and check_password(password, user.password_hash) and user.is_admin:
            # Step 2: Generate OTP
            otp = ''.join(random.choices(string.digits, k=6))
            session['admin_2fa_otp'] = otp
            session['admin_2fa_user_id'] = user.id
            
            # Send Email
            # Requirement: Send to kawamonn91@gmail.com (which is the admin email)
            send_email(user.email, "Admin 2FA Code", f"Your login code is: {otp}")
            
            return redirect(url_for('verify_otp'))
        else:
            flash('Invalid credentials or not an admin.', 'danger')
            
    return render_template('login.html')

@app.route('/verify-otp', methods=['GET', 'POST'])
def verify_otp():
    if 'admin_2fa_otp' not in session or 'admin_2fa_user_id' not in session:
        return redirect(url_for('login'))
        
    if request.method == 'POST':
        input_otp = request.form.get('otp')
        if input_otp == session['admin_2fa_otp']:
            # Success
            user = User.query.get(session['admin_2fa_user_id'])
            login_user(user)
            session.pop('admin_2fa_otp', None)
            session.pop('admin_2fa_user_id', None)
            log_audit('admin_login', 'Logged in via 2FA')
            return redirect(url_for('dashboard'))
        else:
            flash('Invalid Code.', 'danger')
            
    return render_template('verify_otp.html')

@app.route('/logout')
@login_required
def logout():
    log_audit('admin_logout', 'Logged out')
    logout_user()
    return redirect(url_for('login'))

# --- Admin Protected Routes ---
@app.before_request
def restrict_admin():
    # Allow static and login routes
    if request.endpoint in ['login', 'verify_otp', 'static']:
        return
    
    if not current_user.is_authenticated or not current_user.is_admin:
        return redirect(url_for('login'))

@app.route('/')
@login_required
def dashboard():
    page = request.args.get('page', 1, type=int)
    search = request.args.get('search', '')
    
    query = User.query
    if search:
        query = query.filter(or_(User.username.contains(search), User.email.contains(search)))
        
    users = query.order_by(User.created_at.desc()).paginate(page=page, per_page=20)
    
    return render_template('dashboard.html', users=users, search=search, format_bytes=format_bytes)

@app.route('/user/<int:user_id>')
def user_detail(user_id):
    user = User.query.get_or_404(user_id)
    logs = AuditLog.query.filter_by(user_id=user_id).order_by(AuditLog.timestamp.desc()).limit(50).all()
    return render_template('user_detail.html', user=user, logs=logs, format_bytes=format_bytes)

@app.route('/user/<int:user_id>/quota', methods=['POST'])
def update_quota(user_id):
    user = User.query.get_or_404(user_id)
    try:
        new_quota_gb = int(request.form.get('quota_gb'))
        new_quota_bytes = new_quota_gb * 1024 * 1024 * 1024
        
        # Update DB
        old_quota = user.quota_bytes
        user.quota_bytes = new_quota_bytes
        db.session.commit()
        
        # Update System Quota
        script_path = os.path.abspath('/home/pi/hdd/ssh/kawamonn_platform/scripts/update_quota.sh')
        subprocess.check_call(['sudo', script_path, str(user.fs_project_id), str(new_quota_bytes)])
        
        log_audit('update_quota', f'Changed quota from {format_bytes(old_quota)} to {format_bytes(new_quota_bytes)}', user_id)
        flash('Quota updated successfully.', 'success')
    except Exception as e:
        flash(f'Error updating quota: {e}', 'danger')
        
    return redirect(url_for('user_detail', user_id=user_id))

@app.route('/user/<int:user_id>/reset_password', methods=['POST'])
def reset_password(user_id):
    user = User.query.get_or_404(user_id)
    # Generate temp password
    chars = string.ascii_letters + string.digits + "!@#$%"
    temp_pass = ''.join(secrets.choice(chars) for _ in range(12))
    
    user.password_hash = hash_password(temp_pass)
    user.password_last_set_at = datetime.utcnow()
    db.session.commit()
    
    log_audit('reset_password', 'Admin generated temporary password', user_id)
    
    # Requirement: Show or Send.
    # We will flash it (one time view) as requested "Temporary password generate"
    flash(f'Temporary Password for {user.username}: {temp_pass}', 'warning')
    return redirect(url_for('user_detail', user_id=user_id))

@app.route('/user/<int:user_id>/delete', methods=['POST'])
def delete_user(user_id):
    user = User.query.get_or_404(user_id)
    action = request.form.get('action', 'archive') # archive or delete
    
    try:
        # Run script
        script_path = os.path.abspath('/home/pi/hdd/ssh/kawamonn_platform/scripts/delete_user.sh')
        subprocess.check_call(['sudo', script_path, user.username, action])
        
        user.status = UserStatus.DELETED
        log_audit('delete_user', f'User {action}d', user_id)
        db.session.commit()
        
        flash(f'User {user.username} {action}d successfully.', 'success')
    except Exception as e:
        flash(f'Error deleting user: {e}', 'danger')
        
    return redirect(url_for('dashboard'))

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5003, debug=True)
