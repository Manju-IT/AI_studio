# Developer API

Run backend and worker normally after upgrading the database. Open `/developer` in the dashboard and create a key. Store the secret in a server-side environment variable `VOICE_API_KEY`; never embed it in browser code. Keys are account-scoped, not restricted to individual jobs. Revoking a key blocks future authentication, not already accepted jobs. Request counts count authorized endpoint attempts, not successful jobs. No billing.

External API base: `http://localhost:8000/api/v1/external`. Swagger: `/api/docs`. Use Authorization: Bearer <key>.

| Method and path | Scope |
|---|---|
| GET /models, /voices | catalog:read |
| POST /tts | tts:write |
| GET /tts/{id} | tts:read |
| POST /tts/{id}/cancel | tts:write |
| GET /audio/{id}/download | audio:read |
| POST /asr | asr:write |
| GET /asr/{id} | asr:read |

Python example (requests installed separately if needed):

```python
import os, time, uuid, requests
base = 'http://localhost:8000/api/v1/external'
s = requests.Session()
s.headers['Authorization'] = 'Bearer ' + os.environ['VOICE_API_KEY']
def call(method, path, **kwargs):
    r = s.request(method, base+path, timeout=60, **kwargs)
    r.raise_for_status()
    return r
print(call('GET','/models').json())
model = os.environ['VOICE_MODEL_ID'] # choose an installed compatible model from catalog
job = call('POST','/tts',json={'model_installation_id':model,'text':'Hello from AI Voice Studio.','language':'en','idempotency_key':str(uuid.uuid4())}).json()
for _ in range(300):
    job = call('GET','/tts/'+job['id']).json()
    if job['status'] in ('completed','failed','cancelled'): break
    time.sleep(2)
if job['status'] != 'completed': raise RuntimeError(job['status'])
with open('speech.wav','wb') as f:
    f.write(call('GET','/audio/'+job['audio_asset_id']+'/download').content)
```

ASR upload: `call('POST','/asr',files={'file':('speech.wav',open('speech.wav','rb'),'audio/wav')},data={'model':'tiny','language':'en'})` (close file after request). Poll `/asr/{id}`. Existing ASR limits apply.

Node.js 20+ server-side example:

```js
const base = 'http://localhost:8000/api/v1/external';
const r = await fetch(base + '/models', {headers: {Authorization: `Bearer ${process.env.VOICE_API_KEY}`}});
if (!r.ok) throw new Error(`HTTP ${r.status}`);
console.log(await r.json());
```

No webhook delivery, per-key quotas, rate limiting, or durable ASR queue is added in this release. Keep the server local. Do not run Qwen and diarization concurrently on a memory-constrained machine. Existing voice restrictions remain unchanged.
