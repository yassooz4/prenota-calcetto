"""Frontend Streamlit. In produzione non scrive direttamente nel foglio."""
import json
import os
import secrets
from datetime import date, datetime
from html import escape
from pathlib import Path
from zoneinfo import ZoneInfo

import requests
import streamlit as st

from booking.api import ApiError, BookingAPI
from booking.auth import authorized, login_owner


def create_api():
    try:
        config = dict(st.secrets['backend'])
    except (KeyError, FileNotFoundError):
        raise ApiError('CONFIGURATION', 'Le prenotazioni non sono ancora attive. Il proprietario sta completando il collegamento al campo.') from None
    if os.getenv('BOOKING_DEMO') == '1':
        def transport(envelope):
            response = requests.post(config['url'], json=envelope, timeout=20)
            response.raise_for_status()
            return response.json()
        return BookingAPI(config, transport)
    return BookingAPI(config)


def stamp(value, timezone):
    return datetime.fromisoformat(value.replace('Z', '+00:00')).astimezone(ZoneInfo(timezone)).strftime('%d/%m/%Y alle %H:%M')


def show_receipt(receipt, key='customer_receipt'):
    result, code = receipt['result'], receipt['token']
    if result['status'] != 'CONFIRMED':
        st.warning('Questo invio si riferisce a una prenotazione già annullata.')
        return
    st.markdown('<div class="confirmed"><b>✓ Turno confermato</b><br>Ci vediamo al campo.</div>', unsafe_allow_html=True)
    st.write(f"**{stamp(result['start'], result['timezone'])} · 60 minuti · 60 € al campo**")
    st.caption(f"Cancellazione consentita fino al {stamp(result['cancel_before'], result['timezone'])}, compreso.")
    st.write('**Conserva il tuo codice privato. Serve per gestire o cancellare la prenotazione.**')
    st.code(code, language=None)
    contents = f"Prenota Calcetto\nPrenotazione: {result['booking_id']}\nInizio: {stamp(result['start'], result['timezone'])}\nPrezzo: 60 EUR, pagamento al campo\nCodice privato: {code}\nCancellabile fino a: {stamp(result['cancel_before'], result['timezone'])}\n"
    st.download_button('Salva la conferma', contents, file_name='conferma-calcetto.txt', mime='text/plain', key=f'{key}_download')


def send_booking(api):
    pending = st.session_state['pending_booking']
    try:
        result = api.call('book', **pending)
    except ApiError as exc:
        st.error(str(exc))
        if exc.code in ('OCCUPIED', 'VALIDATION', 'PAST', 'IDEMPOTENCY_CONFLICT'):
            st.session_state.pop('pending_booking', None)
        return
    st.session_state['receipt'] = {'result': result, 'token': pending['management_token']}
    st.session_state.pop('pending_booking', None)
    st.rerun()


def booking_page(api):
    if st.session_state.get('receipt'):
        try:
            st.session_state['receipt']['result'] = api.call('manage', management_token=st.session_state['receipt']['token'])
        except ApiError as exc:
            st.error(str(exc))
            st.code(st.session_state['receipt']['token'], language=None)
            return
        show_receipt(st.session_state['receipt'])
        if st.button('Prenota un altro turno'):
            st.session_state.pop('receipt', None)
            st.session_state.pop('selected_slot', None)
            st.rerun()
        return
    if st.session_state.get('pending_booking'):
        st.warning('Invio in attesa di conferma. Riprova con gli stessi dati: una richiesta ripetuta non crea una seconda prenotazione.')
        st.caption('Puoi conservare questo codice e controllare lo stato nella scheda Gestisci.')
        st.code(st.session_state['pending_booking']['management_token'], language=None)
        if st.button('Riprova lo stesso invio', type='primary'):
            send_booking(api)
        return
    today = st.session_state['field_today']
    day = st.date_input('Quando vuoi giocare?', min_value=today, value=today, format='DD/MM/YYYY', key='booking_day')
    try:
        available = api.call('availability', date=day.isoformat())
    except ApiError as exc:
        st.error(str(exc))
        return
    st.caption(f"Orari del campo · {available['timezone']} · aggiornati a ogni apertura della pagina")
    if st.button('Aggiorna disponibilità', key='refresh_slots'):
        st.rerun()
    for index, slot in enumerate(available['slots']):
        if index % 2 == 0:
            columns = st.columns(2)
        free = slot['status'] == 'free'
        label = 'Libero' if free else 'Occupato' if slot['status'] == 'occupied' else 'Già iniziato'
        if columns[index % 2].button(f"{slot['hour']:02}:00 – {slot['hour']+1:02}:00 · {label}", key=f"slot_{slot['hour']}", disabled=not free, width='stretch', type='primary' if st.session_state.get('selected_slot') == (day.isoformat(), slot['hour']) else 'secondary'):
            st.session_state['selected_slot'] = (day.isoformat(), slot['hour'])
            st.rerun()
    selected = st.session_state.get('selected_slot')
    if not selected or selected[0] != day.isoformat():
        st.info('Scegli un turno libero per prenotare.')
        return
    if not any(s['hour'] == selected[1] and s['status'] == 'free' for s in available['slots']):
        st.session_state.pop('selected_slot', None)
        st.warning('Il turno non è più disponibile. Scegline un altro.')
        return
    st.subheader(f"Il tuo turno: {selected[1]:02}:00 – {selected[1]+1:02}:00")
    with st.form('customer_booking'):
        left, right = st.columns(2)
        first = left.text_input('Nome', max_chars=80)
        last = right.text_input('Cognome', max_chars=80)
        phone = st.text_input('Numero di telefono', max_chars=40, placeholder='Con prefisso se necessario')
        st.caption('60 € per l’intero campo, da pagare sul posto. La prenotazione è confermata subito se il turno è ancora libero.')
        st.caption('Nome, cognome e telefono sono visibili solo al proprietario per gestire questa prenotazione. Non vengono mostrati nel calendario pubblico.')
        accepted = st.checkbox('Ho letto le regole: posso cancellare fino a 6 ore prima dell’inizio.')
        if st.form_submit_button('Conferma prenotazione · 60 €', type='primary', width='stretch'):
            if not first.strip() or not last.strip() or not phone.strip() or not accepted:
                st.error('Completa tutti i campi e conferma di aver letto le regole.')
            else:
                st.session_state['pending_booking'] = {'date': selected[0], 'hour': selected[1], 'first_name': first, 'last_name': last, 'phone': phone, 'management_token': secrets.token_urlsafe(32), 'request_id': secrets.token_urlsafe(24)}
                send_booking(api)


def manage_page(api):
    st.subheader('Gestisci il tuo turno')
    st.write('Inserisci il codice privato ricevuto alla conferma.')
    with st.form('find_booking'):
        token = st.text_input('Codice di gestione', type='password', max_chars=100)
        if st.form_submit_button('Mostra prenotazione'):
            try:
                details = api.call('manage', management_token=token.strip())
            except ApiError as exc:
                st.error(str(exc))
            else:
                st.session_state['managed'] = {'token': token.strip(), 'result': details, 'cancel_request': secrets.token_urlsafe(24)}
    managed = st.session_state.get('managed')
    if not managed:
        return
    try:
        result = api.call('manage', management_token=managed['token'])
    except ApiError as exc:
        st.error(str(exc))
        return
    st.write(f"**{stamp(result['start'], result['timezone'])} · 60 € al campo**")
    if result['status'] == 'CANCELLED':
        st.success('La prenotazione è annullata. Il turno è nuovamente disponibile.')
        return
    st.caption(f"Puoi cancellare fino al {stamp(result['cancel_before'], result['timezone'])}, compreso.")
    if not result['cancellable']:
        st.warning('Il termine per la cancellazione è passato.')
        return
    confirm = st.checkbox('Confermo di voler annullare questo turno', key='customer_cancel_confirm')
    if st.button('Annulla prenotazione', disabled=not confirm):
        try:
            api.call('cancel', management_token=managed['token'], request_id=managed['cancel_request'])
        except ApiError as exc:
            st.error(str(exc))
        else:
            st.rerun()


def owner_mutate(api, action, values):
    st.session_state['admin_pending'] = {'action': action, 'values': {**values, 'request_id': secrets.token_urlsafe(24)}}
    retry_owner(api)


def retry_owner(api):
    pending = st.session_state['admin_pending']
    try:
        result = api.call(pending['action'], owner_session=st.session_state.get('owner_session'), **pending['values'])
    except ApiError as exc:
        st.error(str(exc))
        if exc.code not in ('NETWORK', 'BUSY', 'UNAVAILABLE'):
            st.session_state.pop('admin_pending', None)
    else:
        if pending['action'] == 'admin_book':
            st.session_state['phone_receipt'] = {'result': result, 'token': pending['values']['management_token']}
        st.session_state.pop('admin_pending', None)
        st.session_state['owner_notice'] = 'Operazione salvata.'
        st.rerun()


def owner_page(api):
    session = st.session_state.get('owner_session')
    if not authorized(session, api.config):
        st.session_state.pop('owner_session', None)
        st.subheader('Area del proprietario')
        with st.form('owner_login'):
            email = st.text_input('Email del proprietario')
            password = st.text_input('Password del proprietario', type='password')
            if st.form_submit_button('Accedi', type='primary'):
                login = login_owner(email, password, api.config)
                if not login:
                    st.error('Email o password non corretti.')
                else:
                    st.session_state['owner_session'] = login
                    st.rerun()
        return
    if st.button('Esci dall’area proprietario'):
        st.session_state.pop('owner_session', None)
        st.session_state.pop('admin_pending', None)
        st.rerun()
    if st.session_state.pop('owner_notice', None):
        st.success('Operazione salvata.')
    if st.session_state.get('admin_pending'):
        st.warning('L’ultima operazione non è ancora confermata. Riprova prima di inserirne un’altra.')
        if st.button('Riprova operazione proprietario'):
            retry_owner(api)
        return
    try:
        archive = api.call('admin_list', owner_session=session)
    except ApiError as exc:
        st.error(str(exc))
        return
    st.subheader('Tutte le prenotazioni')
    rows = sorted(archive['bookings'], key=lambda r: r['start'], reverse=True)
    if rows:
        st.dataframe([{'Data': r['date'], 'Ora': f"{r['hour']:02}:00", 'Nome': r['first_name'], 'Cognome': r['last_name'], 'Telefono': r['phone'], 'Stato': r['status'], 'Pagato': 'Sì' if r['paid'] else 'No'} for r in rows], hide_index=True, width='stretch')
    else:
        st.info('Non ci sono ancora prenotazioni.')
    active = {r['booking_id']: r for r in rows if r['status'] == 'CONFIRMED'}
    if active:
        selected = st.selectbox('Prenotazione da gestire', list(active), format_func=lambda k: f"{active[k]['date']} · {active[k]['hour']:02}:00 · {active[k]['first_name']} {active[k]['last_name']}")
        r = active[selected]
        paid = st.checkbox('Pagamento ricevuto al campo', value=r['paid'], key=f'paid_{selected}')
        if st.button('Salva stato pagamento'):
            owner_mutate(api, 'admin_paid', {'booking_id': selected, 'paid': paid})
        confirm = st.checkbox('Confermo l’annullamento', key=f'admin_cancel_{selected}')
        if st.button('Annulla come proprietario', disabled=not confirm):
            owner_mutate(api, 'admin_cancel', {'booking_id': selected})
    with st.expander('Inserisci una prenotazione telefonica'):
        with st.form('phone_booking'):
            day = st.date_input('Data della prenotazione telefonica', min_value=st.session_state['field_today'], format='DD/MM/YYYY')
            hour = st.selectbox('Turno telefonico', range(15, 22), format_func=lambda h: f'{h:02}:00 – {h+1:02}:00')
            first = st.text_input('Nome cliente', max_chars=80)
            last = st.text_input('Cognome cliente', max_chars=80)
            phone = st.text_input('Telefono cliente', max_chars=40)
            if st.form_submit_button('Conferma prenotazione telefonica'):
                owner_mutate(api, 'admin_book', {'date': day.isoformat(), 'hour': hour, 'first_name': first, 'last_name': last, 'phone': phone, 'management_token': secrets.token_urlsafe(32)})
        if st.session_state.get('phone_receipt'):
            show_receipt(st.session_state['phone_receipt'], key='phone_receipt')
    with st.expander('Blocca o sblocca un turno'):
        day = st.date_input('Giorno da gestire', min_value=st.session_state['field_today'], format='DD/MM/YYYY')
        hour = st.selectbox('Turno da gestire', range(15, 22), format_func=lambda h: f'{h:02}:00 – {h+1:02}:00')
        left, right = st.columns(2)
        if left.button('Blocca turno'):
            owner_mutate(api, 'admin_block', {'date': day.isoformat(), 'hour': hour})
        if right.button('Sblocca turno'):
            owner_mutate(api, 'admin_unblock', {'date': day.isoformat(), 'hour': hour})
    if archive['blocks']:
        st.caption('Turni bloccati dal proprietario')
        st.dataframe([{'Data': r['date'], 'Ora': f"{r['hour']:02}:00"} for r in archive['blocks']], hide_index=True)


def main():
    st.set_page_config(page_title='Prenota Calcetto', page_icon='⚽', layout='centered')
    st.markdown('<style>'+Path(__file__).with_name('booking').joinpath('style.css').read_text(encoding='utf-8')+'</style>', unsafe_allow_html=True)
    st.markdown('<div class="brand">⚽ Prenota Calcetto · un campo, la tua partita</div><div class="hero"><div class="pitch"></div><h1>Il tuo prossimo<br>calcio d’inizio.</h1><p>Scegli il giorno, trova il turno libero e prepara la squadra.</p></div><div class="facts"><div class="fact">Tutti i giorni · 15:00–22:00</div><div class="fact">60 minuti</div><div class="fact">60 € per campo</div><div class="fact">Pagamento sul posto</div></div>', unsafe_allow_html=True)
    if os.getenv('BOOKING_DEMO') == '1':
        st.warning('DEMO LOCALE · dati inventati e nessuna prenotazione reale. Accesso demo: owner@example.test / demo-proprietario.')
    try:
        api = create_api()
        configuration = api.call('configuration')
        st.session_state['field_today'] = date.fromisoformat(configuration['today'])
    except ApiError as exc:
        st.info(str(exc))
        st.caption('Il calendario sarà disponibile dopo l’attivazione del servizio di prenotazione.')
        return
    book, manage, owner = st.tabs(['Prenota', 'Gestisci', 'Proprietario'])
    with book:
        booking_page(api)
    with manage:
        manage_page(api)
    with owner:
        owner_page(api)
    st.markdown('<div class="policy">Cancellazione cliente fino a 6 ore prima dell’inizio, soglia compresa. Nessun pagamento online e nessun account cliente. Nome e posizione del campo verranno aggiunti dal proprietario.</div>', unsafe_allow_html=True)


if __name__ == '__main__':
    main()
