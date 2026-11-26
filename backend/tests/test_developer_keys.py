from app.core.developer_keys import issue_key, digest_key, SCOPES

def test_key_format_and_uniqueness():
    keys = {issue_key() for _ in range(1000)}
    assert len(keys) == 1000
    assert all(k.startswith('avs_') and len(k)==47 for k in keys)
    assert len({digest_key(k) for k in keys}) == 1000

def test_digest_and_scopes():
    key = issue_key()
    assert len(digest_key(key)) == 64
    assert digest_key(key) == digest_key(key)
    assert len(set(SCOPES)) == 6
