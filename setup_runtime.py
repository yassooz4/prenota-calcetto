"""Eseguire sul proprio computer: crea file privati ignorati da Git."""
import argparse
import getpass
import json
import secrets
from pathlib import Path

from booking.auth import hash_password


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--owner-email', required=True)
    parser.add_argument('--sheet-id', required=True)
    parser.add_argument('--api-url', default='INSERISCI_URL_APPS_SCRIPT_EXEC')
    args = parser.parse_args()
    password = getpass.getpass('Nuova password proprietario (almeno 14 caratteri): ')
    if password != getpass.getpass('Ripeti la password: '):
        raise SystemExit('Le due password non coincidono. Nessun file creato.')
    password_hash = hash_password(password)
    if not args.owner_email.strip() or '@' not in args.owner_email:
        raise SystemExit('Email non valida.')
    root = Path(__file__).resolve().parent
    files = [root/'runtime-private.json', root/'.streamlit/secrets.toml']
    if any(file.exists() for file in files):
        raise SystemExit('File privati già presenti: conservane una copia e rimuovili esplicitamente prima di rigenerare le chiavi.')
    api_secret, admin_secret = secrets.token_urlsafe(48), secrets.token_urlsafe(48)
    properties = {'SPREADSHEET_ID': args.sheet_id, 'API_SECRET': api_secret, 'ADMIN_SECRET': admin_secret, 'OWNER_EMAIL': args.owner_email.strip().lower()}
    files[0].write_text(json.dumps(properties, indent=2), encoding='utf-8')
    config = {'url': args.api_url, 'api_secret': api_secret, 'admin_secret': admin_secret, 'owner_email': args.owner_email.strip().lower(), 'owner_password_hash': password_hash}
    files[1].parent.mkdir(exist_ok=True)
    files[1].write_text('[backend]\n'+'\n'.join(f'{key} = {json.dumps(value)}' for key,value in config.items())+'\n', encoding='utf-8')
    print('Creati runtime-private.json e .streamlit/secrets.toml. Non caricarli su GitHub e non incollarli in chat.')


if __name__ == '__main__':
    main()
