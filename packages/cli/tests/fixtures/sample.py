import os
from os import environ

# Standard os.environ access
db_url = os.environ['DATABASE_URL']
debug = os.environ["DEBUG_MODE"]

# os.environ.get with and without default
stripe_key = os.environ.get('STRIPE_SECRET_KEY')
redis_url = os.environ.get('REDIS_URL', 'redis://localhost:6379')

# os.getenv
secret_key = os.getenv('SECRET_KEY')
jwt_secret = os.getenv('JWT_SECRET', 'dev-secret')

# From imported environ
admin_email = environ['ADMIN_EMAIL']
allowed_hosts = environ.get('ALLOWED_HOSTS', 'localhost')

# In a function
def get_database_config():
    return {
        'host': os.environ.get('DB_HOST', 'localhost'),
        'port': os.environ.get('DB_PORT', '5432'),
        'name': os.environ['DB_NAME'],
    }

# This should be skipped — it's commented out
# password = os.environ['COMMENTED_PASSWORD']

# Dynamic access — flagged as __DYNAMIC__
key_name = 'SOME_VAR'
dynamic = os.environ[key_name]
