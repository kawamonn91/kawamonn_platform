import sys
import os
from flask import Flask, render_template, redirect, url_for, flash, request, send_from_directory
from flask_login import LoginManager, login_user, logout_user, login_required, current_user
from werkzeug.utils import secure_filename
from werkzeug.exceptions import RequestEntityTooLarge
import shutil


# Add project root to path
sys.path.append(os.path.abspath(os.path.join(os.path.dirname(__file__), '../../')))

from common.config import Config
from common.database import db
from common.models import User, AuditLog
from common.utils import check_password, format_bytes

app = Flask(__name__)
app.config.from_object(Config)
# Set max upload size to 1GB to prevent DoS, but strictly limited by filesystem quota
app.config['MAX_CONTENT_LENGTH'] = 1024 * 1024 * 1024 
db.init_app(app)

login_manager = LoginManager()
login_manager.init_app(app)
login_manager.login_view = 'login'

@login_manager.user_loader
def load_user(user_id):
    return User.query.get(int(user_id))

def get_user_dir(username):
    return os.path.join(Config.USER_DATA_DIR, username)

def get_absolute_path(username, relative_path):
    user_root = get_user_dir(username)
    # Ensure relative_path doesn't start with / to avoid os.path.join ignoring user_root
    if relative_path.startswith('/'):
        relative_path = relative_path[1:]
    
    # Securely join paths
    abs_path = os.path.abspath(os.path.join(user_root, relative_path))
    
    # Verify the path is still within user_root
    if not abs_path.startswith(os.path.abspath(user_root)):
        return None
    return abs_path

# Log audit for user file operations? Maybe overkill for every file, but good for "Delete".
def log_audit(action, details, user_id):
    log = AuditLog(
        action=action,
        details=details,
        user_id=user_id,
        performer_id=user_id, # Self
        ip_address=request.remote_addr
    )
    db.session.add(log)
    db.session.commit()

@app.route('/')
@login_required
def index():
    current_path = request.args.get('path', '')
    # Basic directory traversal protection for UI display
    if '..' in current_path:
        flash('Invalid path.', 'danger')
        return redirect(url_for('index'))
        
    abs_path = get_absolute_path(current_user.username, current_path)
    
    # If the user's root directory doesn't exist yet, we should just show an empty list
    # instead of redirecting infinitely or flashing errors.
    user_root = get_user_dir(current_user.username)
    if not os.path.exists(user_root):
        # Create it? Or just show empty. Let's show empty for now, but ensure upload/create works.
        pass 

    # If abs_path is None (traversal attempt) or doesn't exist
    if not abs_path or not os.path.exists(abs_path):
        if current_path: # If we are in a subdir that doesn't exist, go back
            flash('Directory not found.', 'danger')
            return redirect(url_for('index'))
        else:
            # Root dir missing. Just treat as empty.
            abs_path = None 
    
    if abs_path and not os.path.isdir(abs_path):
        # It's a file, maybe download or view? For now redirect to parent
        return redirect(url_for('index', path=os.path.dirname(current_path)))

    items = []
    if abs_path and os.path.exists(abs_path):
        try:
            with os.scandir(abs_path) as entries:
                for entry in entries:
                    stat = entry.stat()
                    items.append({
                        'name': entry.name,
                        'is_dir': entry.is_dir(),
                        'size': format_bytes(stat.st_size) if entry.is_file() else '-',
                        'mtime': datetime.fromtimestamp(stat.st_mtime).strftime('%Y-%m-%d %H:%M'),
                        'path': os.path.join(current_path, entry.name)
                    })
        except PermissionError:
            flash('Permission denied.', 'danger')

    # Sort: Directories first, then files
    items.sort(key=lambda x: (not x['is_dir'], x['name'].lower()))
    
    # Breadcrumbs
    breadcrumbs = []
    parts = current_path.strip('/').split('/')
    if parts == ['']: parts = []
    built_path = ''
    for part in parts:
        if part:
            built_path = os.path.join(built_path, part)
            breadcrumbs.append({'name': part, 'path': built_path})
            
    return render_template('index.html', items=items, current_path=current_path, breadcrumbs=breadcrumbs, user=current_user)

@app.route('/upload', methods=['POST'])
@login_required
def upload_file():
    current_path = request.form.get('path', '')
    if 'file' not in request.files:
        flash('No file part', 'danger')
        return redirect(url_for('index', path=current_path))
    
    file = request.files['file']
    if file.filename == '':
        flash('No selected file', 'danger')
        return redirect(url_for('index', path=current_path))
    
    if file:
        filename = secure_filename(file.filename)
        save_dir = get_absolute_path(current_user.username, current_path)
        
        if not save_dir:
             flash('Invalid upload directory.', 'danger')
             return redirect(url_for('index'))

        if not os.path.exists(save_dir):
            os.makedirs(save_dir) # Should exist by script, but fallback
            
        try:
            file.save(os.path.join(save_dir, filename))
            log_audit('file_upload', f'Uploaded {filename} to {current_path}', current_user.id)
            flash(f'File {filename} uploaded successfully.', 'success')
        except OSError as e:
            if e.errno == 122: # Disk quota exceeded
                flash('Upload failed: Storage quota exceeded.', 'danger')
            else:
                flash(f'Upload failed: {e}', 'danger')
        except RequestEntityTooLarge:
            flash('File too large.', 'danger')

    return redirect(url_for('index', path=current_path))

@app.route('/create-folder', methods=['POST'])
@login_required
def create_folder():
    current_path = request.form.get('path', '')
    folder_name = request.form.get('folder_name', '').strip()
    
    if not folder_name:
        flash('Folder name required.', 'danger')
        return redirect(url_for('index', path=current_path))
        
    # Basic validation for folder name
    if '/' in folder_name or '\\' in folder_name or folder_name.startswith('.'):
         flash('Invalid folder name.', 'danger')
         return redirect(url_for('index', path=current_path))

    parent_dir = get_absolute_path(current_user.username, current_path)
    new_folder_path = os.path.join(parent_dir, secure_filename(folder_name))
    
    if not new_folder_path.startswith(parent_dir): # Extra safety
        flash('Invalid folder path.', 'danger')
        return redirect(url_for('index', path=current_path))

    if os.path.exists(new_folder_path):
        flash('Folder already exists.', 'warning')
    else:
        try:
            os.makedirs(new_folder_path)
            log_audit('folder_create', f'Created folder {folder_name} in {current_path}', current_user.id)
            flash(f'Folder {folder_name} created.', 'success')
        except OSError as e:
             flash(f'Error creating folder: {e}', 'danger')
             
    return redirect(url_for('index', path=current_path))

@app.route('/create-file', methods=['POST'])
@login_required
def create_file():
    current_path = request.form.get('path', '')
    filename = request.form.get('filename', '').strip()
    
    if not filename:
        flash('Filename required.', 'danger')
        return redirect(url_for('index', path=current_path))
        
    if '/' in filename or '\\' in filename:
         flash('Invalid filename.', 'danger')
         return redirect(url_for('index', path=current_path))

    save_dir = get_absolute_path(current_user.username, current_path)
    file_path = os.path.join(save_dir, secure_filename(filename))
    
    if os.path.exists(file_path):
        flash('File already exists.', 'warning')
    else:
        try:
            # Create empty file
            with open(file_path, 'w') as f:
                pass
            log_audit('file_create', f'Created file {filename} in {current_path}', current_user.id)
            flash(f'File {filename} created.', 'success')
        except OSError as e:
             if e.errno == 122:
                flash('Creation failed: Storage quota exceeded.', 'danger')
             else:
                flash(f'Error creating file: {e}', 'danger')
             
    else:
        # ファイル作成成功時は編集画面へ遷移
        file_relative_path = os.path.join(current_path, secure_filename(filename)).replace('\\', '/')
        return redirect(url_for('edit_file', path=file_relative_path))

    return redirect(url_for('index', path=current_path))

# テキストとして編集可能な拡張子
TEXT_EXTENSIONS = {
    '.txt', '.md', '.py', '.js', '.ts', '.html', '.css', '.json',
    '.yaml', '.yml', '.toml', '.ini', '.cfg', '.conf', '.sh',
    '.bash', '.env', '.xml', '.csv', '.log', '.rst', '.tex',
    '.c', '.cpp', '.h', '.java', '.go', '.rb', '.php', '.sql',
    '.r', '.m', '.jl', '.scala', '.kt', '.swift', '.rs', '',
}

@app.route('/edit', methods=['GET', 'POST'])
@login_required
def edit_file():
    path = request.args.get('path', '') if request.method == 'GET' else request.form.get('path', '')
    if not path:
        flash('No file specified.', 'danger')
        return redirect(url_for('index'))

    abs_path = get_absolute_path(current_user.username, path)
    parent_path = os.path.dirname(path)

    if not abs_path or not os.path.exists(abs_path) or os.path.isdir(abs_path):
        flash('File not found.', 'danger')
        return redirect(url_for('index', path=parent_path))

    # 拡張子チェック（バイナリファイルは編集不可）
    _, ext = os.path.splitext(abs_path)
    if ext.lower() not in TEXT_EXTENSIONS:
        flash(f'このファイル形式（{ext}）はテキストエディタで編集できません。ダウンロードしてください。', 'warning')
        return redirect(url_for('index', path=parent_path))

    if request.method == 'POST':
        content = request.form.get('content', '')
        try:
            with open(abs_path, 'w', encoding='utf-8') as f:
                f.write(content)
            log_audit('file_edit', f'Edited file {path}', current_user.id)
            flash(f'{os.path.basename(path)} を保存しました。', 'success')
        except OSError as e:
            if e.errno == 122:
                flash('保存失敗: ストレージクォータを超えています。', 'danger')
            else:
                flash(f'保存エラー: {e}', 'danger')
        return redirect(url_for('edit_file', path=path))

    # GET: ファイル内容を読み込む
    try:
        with open(abs_path, 'r', encoding='utf-8') as f:
            content = f.read()
    except UnicodeDecodeError:
        flash('このファイルはバイナリファイルのためテキストエディタで開けません。', 'warning')
        return redirect(url_for('index', path=parent_path))
    except OSError as e:
        flash(f'ファイルを開けません: {e}', 'danger')
        return redirect(url_for('index', path=parent_path))

    filename = os.path.basename(path)
    return render_template('edit.html', content=content, path=path, filename=filename,
                           parent_path=parent_path, user=current_user)

@app.route('/download')
@login_required
def download_file():
    path = request.args.get('path', '')
    if not path:
        return redirect(url_for('index'))

    # path contains "folder/filename.ext"
    directory = os.path.dirname(path)
    filename = os.path.basename(path)
    
    abs_dir = get_absolute_path(current_user.username, directory)
    if not abs_dir or not os.path.exists(os.path.join(abs_dir, filename)):
         flash('File not found.', 'danger')
         return redirect(url_for('index', path=directory))

    return send_from_directory(abs_dir, filename, as_attachment=True)

@app.route('/delete', methods=['POST'])
@login_required
def delete_item():
    path = request.form.get('path', '')
    if not path:
        return redirect(url_for('index'))

    abs_path = get_absolute_path(current_user.username, path)
    parent_path = os.path.dirname(path)

    if not abs_path or not os.path.exists(abs_path):
        flash('Item not found.', 'danger')
        return redirect(url_for('index', path=parent_path))
    
    try:
        if os.path.isdir(abs_path):
            shutil.rmtree(abs_path)
            log_audit('folder_delete', f'Deleted folder {path}', current_user.id)
            flash(f'Folder deleted.', 'success')
        else:
            os.remove(abs_path)
            log_audit('file_delete', f'Deleted file {path}', current_user.id)
            flash(f'File deleted.', 'success')
    except OSError as e:
        flash(f'Error deleting item: {e}', 'danger')
        
    return redirect(url_for('index', path=parent_path))

@app.route('/login', methods=['GET', 'POST'])
def login():
    # Reuse Account app login logic or redirect?
    # For standalone, implement simple login.
    # Ideally, we redirect to Account App login, but sharing cookie requires them to be on same domain.
    # If we are `web.kawamonn.com` and Account is `account.kawamonn.com`, 
    # and we set `SESSION_COOKIE_DOMAIN = .kawamonn.com`, 
    # then if the user logged in at Account, they are logged in here!
    # So we just need a Login page in case they come here first.
    from apps.account.app import LoginForm # Reuse form? Or redefine
    from common.utils import check_password
    
    if current_user.is_authenticated:
        return redirect(url_for('index'))

    # Redefine form locally to avoid circular imports or path issues
    from flask_wtf import FlaskForm
    from wtforms import StringField, PasswordField, SubmitField
    from wtforms.validators import DataRequired, Email
    
    class LoginForm(FlaskForm):
        email = StringField('Email', validators=[DataRequired(), Email()])
        password = PasswordField('Password', validators=[DataRequired()])
        submit = SubmitField('Login')

    form = LoginForm()
    if form.validate_on_submit():
        user = User.query.filter_by(email=form.email.data).first()
        if user and user.password_hash and check_password(form.password.data, user.password_hash):
            login_user(user)
            return redirect(url_for('index'))
        else:
            flash('Invalid credentials.', 'danger')
            
    return render_template('login.html', form=form) # Needs a local login template

@app.route('/logout')
def logout():
    logout_user()
    return redirect(url_for('login'))

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5004, debug=True)
