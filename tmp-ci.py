import urllib.request, json, time, sys

# Wait up to 3 minutes for the new run to finish.
sha = '23ccf28'
deadline = time.time() + 180
run_id = None
while time.time() < deadline:
    req = urllib.request.Request(
        'https://api.github.com/repos/seedtheword/seedtheword/actions/workflows/admin-editor-tests.yml/runs?per_page=3',
        headers={'Accept': 'application/vnd.github+json'}
    )
    with urllib.request.urlopen(req, timeout=20) as r:
        data = json.loads(r.read())
    for run in data.get('workflow_runs', []):
        if run['head_sha'].startswith(sha):
            print('found', run['id'], 'status', run['status'], 'conclusion', run['conclusion'])
            if run['status'] == 'completed':
                run_id = run['id']
                break
    if run_id:
        break
    time.sleep(10)

if not run_id:
    print('timed out waiting for run', file=sys.stderr)
    sys.exit(1)

# Fetch job summary
jreq = urllib.request.Request(
    f'https://api.github.com/repos/seedtheword/seedtheword/actions/runs/{run_id}/jobs',
    headers={'Accept': 'application/vnd.github+json'}
)
with urllib.request.urlopen(jreq, timeout=20) as r:
    jobs_data = json.loads(r.read())

for job in jobs_data.get('jobs', []):
    print()
    print('JOB', job['id'], job['name'], job['conclusion'])

# Get the summary via the run-attempt API (includes summary_url)
sreq = urllib.request.Request(
    f'https://api.github.com/repos/seedtheword/seedtheword/actions/runs/{run_id}',
    headers={'Accept': 'application/vnd.github+json'}
)
with urllib.request.urlopen(sreq, timeout=20) as r:
    run_data = json.loads(r.read())
print()
print('html_url:', run_data.get('html_url'))
