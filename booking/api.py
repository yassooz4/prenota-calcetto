"""La firma viene generata sul server Streamlit, mai nel browser cliente."""
import hashlib
import hmac
import json
import re
import secrets
import time

import requests

from .auth import authorized


class ApiError(Exception):
    def __init__(self, code, message):
        self.code = code
        super().__init__(message)


class BookingAPI:
    def __init__(self, config, transport=None):
        self.config = config
        self.transport = transport
        url = config.get('url', '')
        if transport is None and not re.fullmatch(r'https://script\.google\.com/macros/s/[A-Za-z0-9_-]+/exec', url):
            raise ApiError('CONFIGURATION', 'Manca l’indirizzo della nuova API.')
        if len(config.get('api_secret', '')) < 32 or len(config.get('admin_secret', '')) < 32:
            raise ApiError('CONFIGURATION', 'Completa la configurazione riservata dell’app.')
        if not config.get('owner_email') or not config.get('owner_password_hash', '').startswith('pbkdf2_sha256$310000$'):
            raise ApiError('CONFIGURATION', 'Completa l’accesso riservato del proprietario.')

    def call(self, action, *, owner_session=None, **values):
        payload = {'action': action, **values}
        is_admin = action.startswith('admin_')
        if is_admin:
            if not authorized(owner_session, self.config):
                raise ApiError('FORBIDDEN', 'Accesso riservato al proprietario.')
            payload['owner_email'] = owner_session.email
        payload_json = json.dumps(payload, sort_keys=True, separators=(',', ':'), ensure_ascii=False)
        timestamp, nonce = int(time.time()), secrets.token_urlsafe(24)
        message = f'{timestamp}\n{nonce}\n{payload_json}'.encode()
        envelope = {'timestamp': timestamp, 'nonce': nonce, 'payload_json': payload_json,
                    'signature': hmac.new(self.config['api_secret'].encode(), message, hashlib.sha256).hexdigest()}
        if is_admin:
            envelope['admin_signature'] = hmac.new(self.config['admin_secret'].encode(), message, hashlib.sha256).hexdigest()
        try:
            if self.transport:
                answer = self.transport(envelope)
            else:
                response = requests.post(self.config['url'], json=envelope, timeout=(10, 35))
                response.raise_for_status()
                answer = response.json()
        except (requests.RequestException, ValueError):
            raise ApiError('NETWORK', 'Invio non confermato. Premi Riprova con gli stessi dati: il turno non verrà prenotato due volte.') from None
        if not isinstance(answer, dict) or not isinstance(answer.get('ok'), bool):
            raise ApiError('UNAVAILABLE', 'Risposta non valida dal servizio. Riprova più tardi.')
        if not answer['ok']:
            error = answer.get('error', {})
            raise ApiError(error.get('code', 'UNAVAILABLE'), error.get('message', 'Servizio non disponibile.'))
        return answer['result']
