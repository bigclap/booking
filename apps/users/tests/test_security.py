from workplace_users.security import hash_password, issue_token, token_digest, verify_password


def test_password_hashes_are_salted_and_unusable_as_passwords():
    first = hash_password("correct horse battery staple")
    second = hash_password("correct horse battery staple")
    assert first != second
    assert first.startswith("$argon2id$")
    assert verify_password("correct horse battery staple", first)
    assert not verify_password("wrong", first)
    assert not verify_password(first, first)
    assert not verify_password("anything", None)


def test_session_token_is_high_entropy_and_only_its_digest_is_stored():
    token = issue_token()
    assert len(token) >= 43
    assert issue_token() != token
    assert token_digest(token) != token
    assert len(token_digest(token)) == 64
