# Prenota Calcetto

Prenotazione di **un solo campo** con Python/Streamlit, un’API Google Apps Script e un archivio Google Sheets privato. Nessun indirizzo, foto o nome definitivo del campo è stato inventato.

## Comportamento

- Tutti i giorni, turni 15–16, 16–17, 17–18, 18–19, 19–20, 20–21 e 21–22.
- 60 € per turno/campo; pagamento sul posto.
- Nome, cognome e telefono obbligatori; nessun account cliente.
- Conferma immediata, codice privato di gestione e conferma scaricabile.
- Cancellazione cliente fino a 6 ore prima, soglia esatta inclusa. La verifica avviene sul server.
- Area proprietario con email e password, elenco completo, prenotazioni telefoniche, annullamento, pagato/non pagato e blocco/sblocco.
- Il calendario pubblico mostra soltanto libero, occupato o già iniziato. Nessuna email, SMS o WhatsApp automatici.

Il fuso è `Europe/Rome`. Può essere modificato nella scheda Impostazioni: API e interfaccia usano la data locale restituita dal server. Orari, durata, prezzo e termine di cancellazione sono verificati come requisiti fissi di questa prima versione.

## Attivazione

Segui [ATTIVAZIONE.md](ATTIVAZIONE.md). Il collegamento Google di ChatGPT **non è** l’autenticazione dell’app pubblicata. L’API Apps Script viene eseguita con il consenso Google del titolare del nuovo progetto. Streamlit usa due chiavi di firma distinte nei Secrets. Non servono le credenziali JSON delle altre app.

Il codice è pronto per Streamlit Community Cloud, con Python **3.12**, branch `main`, file `app.py`. Senza configurazione completa, l’app mostra una pagina di preparazione e non raccoglie prenotazioni.

## Come si evitano i doppioni

L’API verifica ogni firma e autorizzazione prima di aprire il foglio. Tutte le operazioni attraversano `LockService.getScriptLock()`. Controllo di disponibilità, controllo dell’idempotenza e scrittura avvengono dentro lo stesso lock, condiviso tra le esecuzioni del progetto Google. `SpreadsheetApp.flush()` termina la scrittura prima del rilascio.

La scheda Prenotazioni è un registro di eventi: ogni variazione aggiunge un singolo record con stato e hash della richiesta. L’ultimo evento di ciascuna prenotazione ne definisce lo stato corrente. Un ritentativo identico recupera lo stesso risultato, anche dopo una risposta persa; dati diversi con la stessa richiesta vengono rifiutati. Una richiesta originaria cancellata non ricrea la prenotazione.

**Usare un solo progetto Apps Script per questo foglio.** Non fare scritture parallele dirette da Python, altri script o modifiche manuali al registro: non parteciperebbero allo stesso lock. La firma amministrativa è distinta da quella dell’API ordinaria; il backend verifica la firma amministrativa e l’email proprietario in ogni operazione riservata. Il gateway Python genera quella firma soltanto dopo la verifica della sessione del proprietario.

Il codice cliente è generato con 32 byte casuali nel server Streamlit; nel registro si conserva solo SHA-256. Le sessioni del proprietario scadono dopo un’ora e le modifiche alla password invalidano le precedenti prove di accesso. La password è conservata come hash PBKDF2-SHA256 con salt casuale e 310.000 iterazioni. Non vengono usate cache condivise dei dati personali.

## Verifiche

```sh
pip install -r requirements.txt pytest
python -m pytest tests -q
node --test tests/backend.test.cjs
```

17 test del backend e 14 test Python/Streamlit: concorrenza reale fra thread separati, retry simultanei, risposta persa dopo la scrittura, confine delle 6 ore al millisecondo, riapertura, date/orari invalidi, cambio ora legale, firme, accesso proprietario, prenotazioni telefoniche, pagamenti, blocchi, privacy tra sessioni e funzionamento senza configurazione. Le regressioni coprono anche date convertite automaticamente da Google Sheets, vecchie date numeriche e pagamenti salvati come stringhe.

I test eseguono **lo stesso Code.gs** con adattatori di test per Google Sheets e ScriptLock. Quelli simultanei condividono un archivio e un mutex atomico fra worker. È una verifica locale della logica e della concorrenza: il collaudo del deployment Google reale va completato dopo aver installato le credenziali.

## Demo locale

I file `tests/demo_server.cjs` e `tests/google_mock.cjs` servono soltanto a test e demo. Non usarli come API pubblica. Il backend di produzione è Apps Script. La demo avviata durante lo sviluppo è isolata, con dati inventati e chiavi temporanee; il calendario reale parte vuoto.

## Limiti operativi

Questa prima versione è pensata per un piccolo campo. Restano applicabili i limiti di Google Apps Script e Sheets. Il registro cresce nel tempo e viene letto a ogni operazione; valutare un archivio transazionale diverso se il volume o i tempi di risposta lo richiederanno, senza modificare la regola di un solo punto di scrittura. Prima dell’apertura reale, il proprietario deve completare nome/località/contatto del campo e decidere la conservazione dei dati dei clienti. Non viene raccolto alcun pagamento online.

## Riferimenti tecnici

- [Google ScriptLock](https://developers.google.com/apps-script/reference/lock/lock-service)
- [Web app Apps Script](https://developers.google.com/apps-script/guides/web)
- [SpreadsheetApp.flush](https://developers.google.com/apps-script/reference/spreadsheet/spreadsheet-app#flush())
- [Streamlit Community Cloud](https://docs.streamlit.io/deploy/streamlit-community-cloud/deploy-your-app)
