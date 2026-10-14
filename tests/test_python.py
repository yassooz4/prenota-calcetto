import hashlib
import hmac
import json
import time
from dataclasses import replace

import pytest
import requests

from booking.api import BookingAPI, ApiError
from booking.auth import hash_password, login_owner, authorized


@pytest.fixture
def config():
    return {'url':'https://script.google.com/macros/s/test/exec','api_secret':'test-api-secret-'*4,'admin_secret':'test-admin-secret-'*4,
            'owner_email':'owner@example.test','owner_password_hash':hash_password('password-test-only')}


def test_login_email_password_expiry_and_tampering(config):
    session=login_owner('OWNER@example.test','password-test-only',config,now=1000)
    assert authorized(session,config,now=1001)
    assert not authorized(session,config,now=4600)
    assert not authorized(replace(session,email='intruso@example.test'),config,now=1001)
    assert not authorized(replace(session,expires=999999),config,now=1001)
    assert login_owner('intruso@example.test','password-test-only',config) is None
    assert login_owner('owner@example.test','wrong',config) is None
    assert not authorized(session,{**config,'owner_password_hash':hash_password('nuova-password-test')},now=1001)


def test_public_client_does_not_include_owner_credentials(config):
    envelopes=[]
    api=BookingAPI(config,lambda e:(envelopes.append(e) or {'ok':True,'result':{'slots':[]}}))
    api.call('availability',date='2026-10-15')
    assert 'admin_signature' not in envelopes[0]
    assert 'owner_email' not in json.loads(envelopes[0]['payload_json'])
    assert config['admin_secret'] not in json.dumps(envelopes)


@pytest.mark.parametrize('action',['admin_list','admin_book','admin_cancel','admin_paid','admin_block','admin_unblock'])
def test_every_admin_method_requires_owner_session(config,action):
    api=BookingAPI(config,lambda _:pytest.fail('Non deve raggiungere il trasporto'))
    with pytest.raises(ApiError,match='proprietario'):
        api.call(action)


def test_admin_assertion_is_signed_and_email_from_verified_session(config):
    captured=[];api=BookingAPI(config,lambda e:(captured.append(e) or {'ok':True,'result':{}}))
    session=login_owner('owner@example.test','password-test-only',config)
    api.call('admin_list',owner_session=session,owner_email='intruso@example.test')
    env=captured[0];assert json.loads(env['payload_json'])['owner_email']=='owner@example.test'
    message=f"{env['timestamp']}\n{env['nonce']}\n{env['payload_json']}".encode()
    assert env['admin_signature']==hmac.new(config['admin_secret'].encode(),message,hashlib.sha256).hexdigest()


def test_network_error_contains_no_request_or_personal_data(config):
    def fail(_):raise requests.Timeout('secret and phone must not appear')
    with pytest.raises(ApiError) as error:
        BookingAPI(config,fail).call('book',phone='+393331234567')
    assert '+393331234567' not in str(error.value)
    assert 'secret' not in str(error.value)


def test_invalid_production_url_and_config_fail_closed(config):
    for url in ['http://localhost:9999','https://example.com/exec','https://script.google.com/macros/s/test/dev']:
        with pytest.raises(ApiError):BookingAPI({**config,'url':url})
    with pytest.raises(ApiError):BookingAPI({**config,'owner_password_hash':''})
