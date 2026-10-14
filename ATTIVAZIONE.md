# Attivazione riservata di Prenota Calcetto

La repository e il foglio sono nuovi. Non cambiare la configurazione di calcetto_cambo o delle app finanze.

## Già preparato

- Repository pubblica, con la conferma del titolare: https://github.com/yassooz4/prenota-calcetto
- Pagina Streamlit pubblicata: https://prenota-calcetto.streamlit.app/ — le prenotazioni restano disattivate finché non si completano credenziali e collaudo reale.
- Archivio privato: https://docs.google.com/spreadsheets/d/1zCbjE2S31Y2x0VInBOBekH2JjloE0u2Fv7DQJmWS8Fk/edit
- Progetto backend: https://script.google.com/u/0/home/projects/1UKMBx7v8K5GIQP3TajiVgQOvtpzmsRsvgvxhMATWnW6g24E9C6owmz-h/edit
- API pubblicata: https://script.google.com/macros/s/AKfycby7M8JbMM6iJmsNrVqgw_A95TOImOSnsHN-aR0A9cHXT3sm3qTueWicUwHxKPPSrHxa/exec — risposta di stato verificata; le operazioni di prenotazione richiedono ancora l’installazione delle chiavi.
- Nel backend sono già impostati l’ID del nuovo archivio e l’email del proprietario confermata dall’utente.
- Il codice Apps Script è salvato. Il fuso del progetto e del foglio è Europe/Rome.
- La password è stata scelta dal titolare e i due file privati sono stati generati. L’indirizzo API è già aggiornato nel file locale `.streamlit/secrets.toml`. Non eseguire nuovamente il generatore.

## 1. Genera le nuove credenziali sul tuo computer

Nella cartella del progetto, esegui:

```sh
python setup_runtime.py --owner-email "LA_TUA_EMAIL" --sheet-id "1zCbjE2S31Y2x0VInBOBekH2JjloE0u2Fv7DQJmWS8Fk"
```

Il programma ti chiede una nuova password di almeno 14 caratteri e la conferma. La password non viene mostrata e viene conservata soltanto sotto forma di hash.

Crea due file privati, ignorati da Git:

- `runtime-private.json`: proprietà da inserire nel nuovo Apps Script.
- `.streamlit/secrets.toml`: configurazione da inserire nei Secrets della nuova app Streamlit.

Non incollare password, chiavi o questi file in chat, nei documenti o su GitHub. Usa i valori direttamente nelle due piattaforme. Non riutilizzare chiavi dalle app finanze.

## 2. Completa Apps Script

Apri il progetto backend → **Impostazioni progetto → Proprietà script**.

Conserva `SPREADSHEET_ID` e `OWNER_EMAIL` già impostati. Dal file privato inserisci:

- `API_SECRET`
- `ADMIN_SECRET`

Poi nell’editor seleziona la funzione **checkConfiguration** ed eseguila. Google potrebbe chiedere il consenso al progetto per leggere e modificare i fogli del tuo account: controlla che il progetto sia **Prenota Calcetto API**. Questa autorizzazione riguarda l’account Google e deve essere completata dal titolare. La verifica stampa solo l’esito, senza chiavi o dati personali.

Scegli **Esegui il deployment → Nuovo deployment → Applicazione web**:

- Esegui come: **te stesso**, titolare del progetto.
- Accesso: **Chiunque**, per permettere le chiamate del server Streamlit senza login cliente Google.

L’URL è raggiungibile, ma tutte le operazioni sui dati richiedono una firma crittografica corretta; quelle del proprietario richiedono anche la firma amministrativa. Il foglio rimane privato. Una richiesta GET mostra soltanto lo stato del servizio.

Completa il deployment e copia l’URL che termina con `/exec`. Non usare l’indirizzo dell’editor o `/dev`. Inseriscilo come `url` nel file `.streamlit/secrets.toml` generato.

## 3. Completa Streamlit

La nuova app usa repository `yassooz4/prenota-calcetto`, branch `main`, file `app.py`, Python **3.12**.

In **Settings → Secrets**, incolla la configurazione del file privato `.streamlit/secrets.toml` e salva. Non aggiungere `BOOKING_DEMO`: la versione pubblicata deve usare l’API Google reale.

La repository è stata resa pubblica con l’autorizzazione del titolare per superare il limite di una sola app privata dello spazio Streamlit. La pagina dell’app è accessibile ai clienti senza account; fino all’attivazione mostra solo l’avviso di preparazione. Il foglio rimane privato e l’area proprietario richiede email e password. Nessuna credenziale o prenotazione va aggiunta alla repository pubblica.

## 4. Collaudo finale prima dell’apertura

Usa un turno futuro e una prenotazione esplicitamente di prova, poi annullala dall’area proprietario. Controlla che il turno si riapra e che la riga sia nel nuovo archivio. Apri un secondo browser: deve vedere solo libero/occupato, senza nomi o telefoni. Verifica accesso con la sola email proprietario e password scelta.

Per provare la concorrenza sull’API reale, usa `python tools/smoke_api.py --date AAAA-MM-GG --hour 18`, scegliendo un giorno futuro libero: richiede conferma esplicita, usa solo dati fittizi, verifica un’unica conferma fra due richieste e annulla la prenotazione creata. Non eseguirlo su un campo già aperto ai clienti senza scegliere un turno libero di prova.

Il limite di cancellazione viene comunque controllato sul server, anche se il calendario o la schermata del cliente sono vecchi. Le prove delle 6 ore e dell’ora legale sono incluse nei test automatici; non manipolare l’orologio dell’API di produzione.

## Aggiornamenti

Le modifiche Python arrivano a Streamlit tramite GitHub. Per cambiare Apps Script, salva il codice e aggiorna lo stesso deployment con una nuova versione; non creare un altro progetto per lo stesso foglio. Mantieni identiche le chiavi nelle due piattaforme. Se una chiave viene esposta, sostituiscila in entrambe.
