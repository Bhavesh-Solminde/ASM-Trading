import json, subprocess, sys
from pathlib import Path
from urllib.parse import urlparse

ROOT = Path(__file__).resolve().parents[3]
BASE = Path(__file__).resolve().parent
MODEL = 'kling-video/v4.0/reference-to-video'
credential = ''
for name in ['.env', '.env.local']:
    path = ROOT / name
    if path.is_file():
        for line in path.read_text().splitlines():
            key, sep, value = line.strip().partition('=')
            if sep and key == 'HIGGSFIELD_API_KEY':
                credential = value.strip().strip('\"\'')
if not credential or credential == 'KEY_ID:KEY_SECRET':
    raise SystemExit('Missing configured credential.')

def call(path, payload=None):
    config = ['url = '+json.dumps('https://api.higgsfield.ai/'+path),
              'header = '+json.dumps('Authorization: Key '+credential),
              'header = "Content-Type: application/json"', 'write-out = "\\n%{http_code}"']
    if payload is not None:
        config += ['request = "POST"', 'data = '+json.dumps(json.dumps(payload))]
    result = subprocess.run(['curl','--silent','--show-error','--max-time','55','--config','-'], input='\n'.join(config), text=True, capture_output=True)
    if result.returncode:
        raise SystemExit('Network error; inspect submission marker before any retry.')
    body, status = result.stdout.rsplit('\n',1)
    if not status.startswith('2'):
        for secret in [credential, *credential.split(':',1)]:
            if secret: body=body.replace(secret,'[redacted]')
        raise SystemExit('HTTP '+status+': '+body[:1000])
    return json.loads(body)

def save(name, value):
    (BASE/name).write_text(json.dumps(value,indent=2))

action = sys.argv[1]
if action == 'prepare':
    references = [
        ('Fresh paper chakri design and overhead camera','master-overhead-v1.png'),
        ('Ignition: sparks attached to the consuming striped coil tip','lit-chakri-v2-tip-emission.png'),
        ('Approved peak-speed spin and mandatory blue background','lit-chakri-v4-blue-background.png'),
        ('Celebration composition: fireworks and three diyas; typography added locally','celebration-screen-v1.png'),
    ]
    manifest_path=BASE/'references.json'
    manifest=json.loads(manifest_path.read_text()) if manifest_path.exists() else []
    for role, filename in references[len(manifest):]:
        path=ROOT/'artifacts/diwali/storyboard'/filename
        upload=call('files/generate-upload-url', {'content_type':'image/png'})
        if urlparse(upload['upload_url']).scheme != 'https': raise SystemExit('Invalid upload URL.')
        config=['url = '+json.dumps(upload['upload_url']), 'request = "PUT"', 'upload-file = '+json.dumps(str(path)), 'write-out = "\\n%{http_code}"']
        config += ['header = '+json.dumps(k+': '+v) for k,v in upload['upload_headers'].items()]
        result=subprocess.run(['curl','--silent','--show-error','--max-time','60','--config','-'],input='\n'.join(config),text=True,capture_output=True)
        if result.returncode or not result.stdout.rsplit('\n',1)[-1].startswith('2'): raise SystemExit('Reference upload failed.')
        manifest.append({'role':role,'file':str(path.relative_to(ROOT)),'public_url':upload['public_url']})
        save('references.json',manifest)
    prompt=(BASE/'prompt.txt').read_text()
    request={'prompt':prompt,'image_urls':[r['public_url'] for r in manifest], 'duration':12,'resolution':'1080p','aspect_ratio':'16:9'}
    save('request.json',request)
    estimate=call('estimate/'+MODEL, request)
    save('estimate.json',estimate)
    print(json.dumps({'references_uploaded':len(manifest),'estimate':estimate,'submitted':False}))
elif action == 'submit':
    if (BASE/'submission-started.json').exists() or (BASE/'submission.json').exists(): raise SystemExit('Submission already attempted; no duplicate request.')
    request=json.loads((BASE/'request.json').read_text())
    quote=json.loads((BASE/'estimate.json').read_text())
    if quote.get('type')=='description' and '1080p $0.235/s' in quote.get('pricing_description','') and not request.get('video_urls'):
        cost=.235*request['duration']
    else: cost=float(quote.get('usd',99))
    if not 0<cost<=3: raise SystemExit('Estimate exceeds user 3-dollar limit.')
    save('submission-started.json',{'estimated_usd_before_discounts':cost,'budget_limit_usd':3,'finished_duration_seconds':17})
    response=call(MODEL, request)
    save('submission.json',response)
    print(json.dumps(response))
elif action == 'status':
    submission=json.loads((BASE/'submission.json').read_text())
    rid=submission['request_id']
    if not all(c in '0123456789abcdef-' for c in rid): raise SystemExit('Invalid request ID.')
    response=call('requests/'+rid+'/status')
    save('status.json',response)
    print(json.dumps(response))
else: raise SystemExit('Unknown action.')
