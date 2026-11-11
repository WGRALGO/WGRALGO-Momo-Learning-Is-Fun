"""Puts the code-only export (tools/github_export.py) on GitHub and the APK in a Release, with the gh CLI's API
(no git on this PC, and no .git folder in the project: the owner's rule).
  .venv/bin/python -I tools/github_publish.py EXPORT_DIR OWNER/REPO APK VERSION
The repo is created public if missing. One commit replaces the whole tree with EXPORT_DIR. The Release v<VERSION>
gets the APK and its .sha256 (refuses if that release exists)."""
import base64, hashlib, json, os, subprocess, sys

GH = os.path.expanduser('~/.local/bin/gh')
EXEC = ('build.sh', 'linux/momo-learning', 'tests/run-all.sh', 'tests/android/setup.sh', 'tests/android/teardown.sh')
DESC = 'The Momma Lewis Momo Learning Is FUN: a free learning game for ages 2-7 (Android APK in Releases). Code only.'


def gh(*a, data=None, ok_fail=False):
    r = subprocess.run([GH] + list(a), input=json.dumps(data) if data is not None else None, capture_output=True, text=True)
    if r.returncode and not ok_fail:
        sys.exit('gh %s failed: %s' % (' '.join(a[:3]), r.stderr.strip()[:400]))
    return r


def api(method, path, data=None):
    r = gh('api', '-X', method, path, '--input', '-', data=data or {}) if data is not None else gh('api', '-X', method, path)
    return json.loads(r.stdout or 'null')


def main():
    if len(sys.argv) != 5:
        sys.exit(__doc__)
    src, repo, apk, ver = sys.argv[1:]
    if gh('repo', 'view', repo, '--json', 'name', ok_fail=True).returncode:
        gh('repo', 'create', repo, '--public', '--description', DESC, '--add-readme')
        print('created', repo)
    head = api('GET', 'repos/%s/git/ref/heads/main' % repo)['object']['sha']
    tree = []
    for dp, _, fs in os.walk(src):
        for f in sorted(fs):
            full = os.path.join(dp, f); rel = os.path.relpath(full, src)
            blob = api('POST', 'repos/%s/git/blobs' % repo, {'content': base64.b64encode(open(full, 'rb').read()).decode(), 'encoding': 'base64'})
            tree.append({'path': rel, 'mode': '100755' if rel in EXEC else '100644', 'type': 'blob', 'sha': blob['sha']})
    t = api('POST', 'repos/%s/git/trees' % repo, {'tree': tree})
    c = api('POST', 'repos/%s/git/commits' % repo, {'message': 'Momo Learning %s: the code (content not included)' % ver, 'tree': t['sha'], 'parents': [head]})
    api('PATCH', 'repos/%s/git/refs/heads/main' % repo, {'sha': c['sha'], 'force': False})
    print('pushed %d files, commit %s' % (len(tree), c['sha'][:10]))
    tag = 'v' + ver
    if not gh('release', 'view', tag, '--repo', repo, ok_fail=True).returncode:
        sys.exit('release %s already exists: not replacing it' % tag)
    sha = hashlib.sha256(open(apk, 'rb').read()).hexdigest()
    shafile = apk + '.sha256'
    open(shafile, 'w').write('%s  %s\n' % (sha, os.path.basename(apk)))
    notes = ('The Momma Lewis Momo Learning Is FUN %s, a free learning game for ages 2-7.\n\n'
             'Install: download `%s` on an Android phone or tablet (Android 7 or newer) and open it '
             '(allow installing from this source when Android asks).\n\nSHA-256: `%s`\n\n'
             'Signed by WGRALGO (The Wealth Gap Resolution Algorithm Inc). No ads, no accounts, no tracking, works offline.'
             % (ver, os.path.basename(apk), sha))
    gh('release', 'create', tag, apk, shafile, '--repo', repo, '--title', 'Momo Learning ' + ver, '--notes', notes, '--target', 'main')
    print('release', tag, 'with', os.path.basename(apk), sha[:16])


if __name__ == '__main__':
    main()
