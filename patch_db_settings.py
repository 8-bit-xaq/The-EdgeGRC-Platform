with open("grc-backend/grc_api/settings.py", "r") as f:
    content = f.read()

old_db = """DATABASES = {
    'default': {
        'ENGINE': 'django.db.backends.sqlite3',
        'NAME': BASE_DIR / 'db.sqlite3',
    }
}"""

new_db = """DATABASES = {
    'default': {
        'ENGINE': 'django.db.backends.sqlite3',
        'NAME': BASE_DIR / 'db.sqlite3',
        'OPTIONS': {
            'timeout': 20,
        }
    }
}"""

content = content.replace(old_db, new_db)

with open("grc-backend/grc_api/settings.py", "w") as f:
    f.write(content)
