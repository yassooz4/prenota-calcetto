# API JSON firmata

Endpoint: web app Apps Script `/exec`. Tutte le operazioni vengono inviate con POST. Le risposte ContentService sono JSON con envelope `ok/result` oppure `ok/error`; il codice HTTP può restare 200 anche per un errore applicativo. Non usare uno stato HTTP 200 come prova di avvenuta prenotazione.

Il client Python gestisce firma, timestamp UTC e nonce. `payload_json` è il JSON originale serializzato; il messaggio firmato è `timestamp + "\n" + nonce + "\n" + payload_json`. HMAC-SHA256 è codificato in esadecimale. La firma ordinaria usa API_SECRET; quella riservata usa ADMIN_SECRET. Timestamp validi per cinque minuti.

| Operazione | Parametri principali | Risposta |
|---|---|---|
| configuration | nessuno | Nome provvisorio, fuso, oggi server, prezzo |
| availability | date AAAA-MM-GG | Sette turni con free/occupied/past; nessun dato cliente |
| book | date, hour, first_name, last_name, phone, management_token, request_id | Conferma senza dati personali |
| manage | management_token | Stato e termine di cancellazione della sola prenotazione legata al codice |
| cancel | management_token, request_id | Cancellazione verificata sul server |
| admin_list | owner_email + firma amministrativa | Tutte le prenotazioni con dati cliente, pagato e turni bloccati |
| admin_book | Come book + owner_email + firma amministrativa | Prenotazione telefonica |
| admin_cancel | booking_id, request_id + autorizzazione proprietario | Annullamento del proprietario |
| admin_paid | booking_id, paid boolean, request_id + autorizzazione | Stato di pagamento al campo |
| admin_block / admin_unblock | date, hour, request_id + autorizzazione | Blocco o riapertura del turno |

Ogni mutazione usa request_id casuale, stabile per l’invio e tutti i suoi ritentativi. Conservare i dati dell’invio e il token in memoria di sessione fino a conferma. Non cambiare request_id dopo un timeout. Tutte le risposte pubbliche escludono nomi, telefoni, token e hash. Nessun token è messo nel link o nei log.

Errori applicativi: VALIDATION, PAST, OCCUPIED, NOT_FOUND, TOO_LATE, IDEMPOTENCY_CONFLICT, UNAUTHORIZED, FORBIDDEN, BUSY, CONFIGURATION, ARCHIVE_INVALID, UNAVAILABLE. BUSY/UNAVAILABLE e problemi di rete richiedono un ritentativo identico; una conferma sconosciuta non va trattata come rifiuto definitivo.
