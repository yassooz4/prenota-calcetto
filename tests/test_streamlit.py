import json
import os
import secrets
import shutil
import socket
import subprocess
import time
from datetime import timedelta
from pathlib import Path

import pytest
import requests
from streamlit.testing.v1 import AppTest

from booking.api import BookingAPI
from booking.auth import hash_password

ROOT=Path(__file__).resolve().parents[1]


@pytest.fixture
def demo(tmp_path,monkeypatch):
    node=os.getenv('NODE_BINARY') or shutil.which('node')
    if not node:
        pytest.skip('Node.js necessario per il test end-to-end del backend Apps Script simulato.')
    with socket.socket() as sock:
        sock.bind(('127.0.0.1',0)); port=sock.getsockname()[1]
    cfg={'port':port,'url':f'http://127.0.0.1:{port}','api_secret':secrets.token_urlsafe(48),'admin_secret':secrets.token_urlsafe(48),
         'owner_email':'owner@example.test','owner_password_hash':hash_password('password-test-only')}
    file=tmp_path/'demo-config.json';file.write_text(json.dumps(cfg),encoding='utf-8')
    flags=subprocess.CREATE_NO_WINDOW if os.name=='nt' else 0
    process=subprocess.Popen([node,str(ROOT/'tests/demo_server.cjs'),str(file)],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL,creationflags=flags)
    try:
        for _ in range(100):
            try:
                requests.get(cfg['url'],timeout=.2);break
            except requests.RequestException:
                time.sleep(.05)
        else:
            pytest.fail('Backend di test non avviato.')
        monkeypatch.setenv('BOOKING_DEMO','1')
        at=AppTest.from_file(str(ROOT/'app.py'),default_timeout=30)
        at.secrets['backend']={k:v for k,v in cfg.items() if k!='port'}
        at.run();assert not at.exception
        def transport(e):
            return requests.post(cfg['url'],json=e,timeout=10).json()
        yield at,BookingAPI(cfg,transport)
    finally:
        process.terminate();process.wait(timeout=10)


def widget(elements,label):return next(x for x in elements if x.label==label)


def test_customer_booking_management_and_owner_area(demo):
    at,api=demo
    tomorrow=at.date_input(key='booking_day').value+timedelta(days=1)
    at.date_input(key='booking_day').set_value(tomorrow).run()
    at.button(key='slot_18').click().run()
    widget(at.text_input,'Nome').set_value('Cliente')
    widget(at.text_input,'Cognome').set_value('Prova')
    widget(at.text_input,'Numero di telefono').set_value('+393331234567')
    widget(at.checkbox,'Ho letto le regole: posso cancellare fino a 6 ore prima dell’inizio.').check()
    widget(at.button,'Conferma prenotazione · 60 €').click().run()
    assert not at.exception
    receipt=at.session_state['receipt'];assert receipt['result']['status']=='CONFIRMED'
    assert not at.dataframe
    widget(at.text_input,'Codice di gestione').set_value(receipt['token'])
    widget(at.button,'Mostra prenotazione').click().run()
    widget(at.checkbox,'Confermo di voler annullare questo turno').check().run()
    widget(at.button,'Annulla prenotazione').click().run()
    assert not at.exception
    assert api.call('manage',management_token=receipt['token'])['status']=='CANCELLED'
    assert next(s for s in api.call('availability',date=tomorrow.isoformat())['slots'] if s['hour']==18)['status']=='free'
    widget(at.text_input,'Email del proprietario').set_value('owner@example.test')
    widget(at.text_input,'Password del proprietario').set_value('wrong')
    widget(at.button,'Accedi').click().run();assert not at.dataframe
    widget(at.text_input,'Password del proprietario').set_value('password-test-only')
    widget(at.button,'Accedi').click().run();assert not at.exception
    assert at.dataframe
    widget(at.date_input,'Data della prenotazione telefonica').set_value(tomorrow)
    widget(at.selectbox,'Turno telefonico').set_value(17)
    widget(at.text_input,'Nome cliente').set_value('Telefono')
    widget(at.text_input,'Cognome cliente').set_value('Prova')
    widget(at.text_input,'Telefono cliente').set_value('+393331234567')
    widget(at.button,'Conferma prenotazione telefonica').click().run();assert not at.exception
    assert at.session_state['phone_receipt']['result']['status']=='CONFIRMED'
    widget(at.button,'Esci dall’area proprietario').click().run();assert not at.dataframe


def test_another_session_sees_only_availability(demo):
    at,api=demo
    day=at.date_input(key='booking_day').value+timedelta(days=2)
    api.call('book',date=day.isoformat(),hour=16,first_name='Privato',last_name='Prova',phone='+393339876543',management_token=secrets.token_urlsafe(32),request_id=secrets.token_urlsafe(24))
    at.date_input(key='booking_day').set_value(day).run()
    assert not at.exception and not at.dataframe
    assert at.button(key='slot_16').disabled
    text=' '.join(x.value for x in at.markdown)
    assert 'Privato' not in text and '+393339876543' not in text


def test_missing_runtime_configuration_accepts_no_bookings(monkeypatch):
    monkeypatch.delenv('BOOKING_DEMO',raising=False)
    at=AppTest.from_file(str(ROOT/'app.py'),default_timeout=30)
    at.run();assert not at.exception
    assert not at.text_input and not at.button
    assert any('non sono ancora attive' in item.value for item in at.info)
