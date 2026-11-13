"""Password verification and one-way storage for high-entropy session tokens."""

import hashlib
import secrets

from argon2 import PasswordHasher
from argon2.exceptions import InvalidHashError, VerificationError

_hasher = PasswordHasher()
# Missing users perform the same expensive verification as incorrect passwords.
_dummy_hash = _hasher.hash(secrets.token_urlsafe(32))


def hash_password(password: str) -> str:
    return _hasher.hash(password)


def verify_password(password: str, stored_hash: str | None) -> bool:
    try:
        matched = _hasher.verify(stored_hash or _dummy_hash, password)
    except (VerificationError, InvalidHashError):
        return False
    return bool(stored_hash and matched)


def issue_token() -> str:
    return secrets.token_urlsafe(32)


def token_digest(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()
