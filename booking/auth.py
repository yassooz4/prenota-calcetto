import base64
import hashlib
import hmac
import secrets
import time
from dataclasses import dataclass


def hash_password(password, salt=None):
    if len(password) < 14:
        raise ValueError('Scegli una password di almeno 14 caratteri.')
    salt = salt or secrets.token_bytes(16)
    digest = hashlib.pbkdf2_hmac('sha256', password.encode(), salt, 310000)
    return f'pbkdf2_sha256$310000${base64.b64encode(salt).decode()}${base64.b64encode(digest).decode()}'


def verify_password(password, encoded):
    try:
        algorithm, iterations, salt, expected = encoded.split('$')
        if algorithm != 'pbkdf2_sha256' or int(iterations) != 310000:
            return False
        found = hashlib.pbkdf2_hmac('sha256', password.encode(), base64.b64decode(salt), int(iterations))
        return hmac.compare_digest(found, base64.b64decode(expected))
    except (ValueError, TypeError):
        return False


@dataclass(frozen=True)
class OwnerSession:
    email: str
    expires: int
    proof: str


def _proof(email, expires, secret, password_hash):
    return hmac.new(secret.encode(), f'{email}\n{expires}\n{password_hash}'.encode(), hashlib.sha256).hexdigest()


def login_owner(email, password, config, now=None):
    owner = config['owner_email'].strip().lower()
    if email.strip().lower() != owner or not verify_password(password, config['owner_password_hash']):
        return None
    expires = int(now if now is not None else time.time()) + 3600
    return OwnerSession(owner, expires, _proof(owner, expires, config['admin_secret'], config['owner_password_hash']))


def authorized(session, config, now=None):
    if not isinstance(session, OwnerSession) or session.expires <= int(now if now is not None else time.time()):
        return False
    owner = config['owner_email'].strip().lower()
    return session.email == owner and hmac.compare_digest(session.proof, _proof(owner, session.expires, config['admin_secret'], config['owner_password_hash']))
