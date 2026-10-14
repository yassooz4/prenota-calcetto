"""Collaudo esplicito dell’API Google reale. Crea e annulla solo dati di prova."""
import argparse
import getpass
import secrets
import sys
import tomllib
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from booking.api import ApiError, BookingAPI
from booking.auth import login_owner


def main():
    parser=argparse.ArgumentParser()
    parser.add_argument('--date',required=True,help='Giorno futuro AAAA-MM-GG, scelto per il collaudo')
    parser.add_argument('--hour',required=True,type=int,choices=range(15,22))
    args=parser.parse_args()
    root=Path(__file__).resolve().parents[1]
    config=tomllib.loads((root/'.streamlit/secrets.toml').read_text(encoding='utf-8'))['backend']
    session=login_owner(config['owner_email'],getpass.getpass('Password proprietario: '),config)
    if session is None:raise SystemExit('Accesso non riuscito. Nessuna prenotazione creata.')
    if input(f'Creare due richieste fittizie per {args.date} alle {args.hour}:00 e annullare il risultato? Scrivi COLLAUDO: ')!='COLLAUDO':
        raise SystemExit('Collaudo non avviato.')
    api=BookingAPI(config)
    slots=api.call('availability',date=args.date)['slots']
    if not any(s['hour']==args.hour and s['status']=='free' for s in slots):
        raise SystemExit('Il turno non è libero. Nessun dato modificato.')
    tokens=[secrets.token_urlsafe(32),secrets.token_urlsafe(32)]
    payloads=[{'date':args.date,'hour':args.hour,'first_name':'Prova','last_name':'Collaudo','phone':'+390000000000',
               'management_token':token,'request_id':secrets.token_urlsafe(24)} for token in tokens]
    def book(p):
        try:return api.call('book',**p)
        except ApiError as exc:return {'error_code':exc.code}
    outcomes=[]
    try:
        with ThreadPoolExecutor(max_workers=2) as pool:outcomes=list(pool.map(book,payloads))
        confirmed=[r for r in outcomes if r.get('status')=='CONFIRMED']
        if len(confirmed)!=1 or sum(r.get('error_code')=='OCCUPIED' for r in outcomes)!=1:
            raise RuntimeError('Collaudo non conclusivo: verifica rete e archivio prima di ripeterlo.')
        winner=next(i for i,r in enumerate(outcomes) if r.get('status')=='CONFIRMED')
        retry=api.call('book',**payloads[winner])
        if retry['booking_id']!=confirmed[0]['booking_id']:raise RuntimeError('Idempotenza non verificata.')
        print('Concorrenza e ritentativo verificati sull’API reale.')
    finally:
        for token in tokens:
            try:
                row=api.call('manage',management_token=token)
                if row['status']=='CONFIRMED':
                    api.call('admin_cancel',booking_id=row['booking_id'],request_id=secrets.token_urlsafe(24),owner_session=session)
                    print('Prenotazione di prova annullata.')
            except ApiError as exc:
                if exc.code!='NOT_FOUND':print('Pulizia da verificare nell’area proprietario:',exc.code)
    if next(s for s in api.call('availability',date=args.date)['slots'] if s['hour']==args.hour)['status']!='free':
        raise RuntimeError('Il turno non risulta libero: controlla l’area proprietario.')
    print('Turno nuovamente libero. Nessun token viene stampato.')


if __name__=='__main__':main()
