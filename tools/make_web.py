"""Builds the "learn" web folder: the public Momo app (ages 2-7) for the owner's domain (Hostinger, LiteSpeed).
No password (owner, 2026-11-10), but the same privacy rules as the other folders: HTTPS forced, nosniff, framing and
referrer limits, no directory listings, data/ never served, nothing secret in the folder, no cookies, no tracking,
nothing fetched from anywhere else (a Content-Security-Policy holds the page to its own files), and the child's name
never leaves the page. Every file is plain static (no PHP), so LiteSpeed serves the videos and voice clips with byte
ranges itself (Safari needs them).
Usage: .venv/bin/python -I tools/make_web.py OUT_PARENT      → OUT_PARENT/learn (refuses to replace an existing one)"""
import os, shutil, sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
WEB = os.path.join(ROOT, 'web')
CSP = ("default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; "
       "media-src 'self' blob: data:; font-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'self'; "
       "form-action 'none'; frame-ancestors 'self'")
HTACCESS = r'''# The Momma Lewis Momo Learning Is FUN, the public app for ages 2-7 (Apache / LiteSpeed, Hostinger shared hosting).
# No password: anyone may play. The privacy rules of the other folders still hold (see README.txt).
Options -Indexes
DirectoryIndex index.html

<IfModule mod_rewrite.c>
  RewriteEngine On
  # --- force HTTPS ------------------------------------------------------------
  RewriteCond %{HTTPS} !=on
  RewriteCond %{HTTP:X-Forwarded-Proto} !https
  RewriteRule ^ https://%{HTTP_HOST}%{REQUEST_URI} [L,R=301]
</IfModule>

# --- never serve a data directory, notes or hidden files ---------------------------
RedirectMatch 404 ^/?(.*/)?data/.*$
<FilesMatch "(^\.|^README|\.(md|txt|bak|json|php|py|sh)$)">
  <IfModule mod_authz_core.c>
    Require all denied
  </IfModule>
</FilesMatch>

# --- mime ----------------------------------------------------------------------
<IfModule mod_mime.c>
  AddType video/mp4 .mp4
  AddType audio/mpeg .mp3
  AddType image/webp .webp
  AddType font/ttf .ttf
  AddType text/javascript .js
</IfModule>

# --- headers -------------------------------------------------------------------
# No cookies are ever set; the page loads nothing from any other site (the CSP); the child's name stays in the page.
<IfModule mod_headers.c>
  Header always set X-Content-Type-Options "nosniff"
  Header always set X-Frame-Options "SAMEORIGIN"
  Header always set Referrer-Policy "no-referrer"
  Header always set Permissions-Policy "camera=(), microphone=(), geolocation=(), payment=(), usb=(), interest-cohort=()"
  Header always set Content-Security-Policy "{CSP}"
  Header always unset Set-Cookie
  # the app's code is checked for updates every time; pictures, voices and videos are kept a week
  <FilesMatch "\.(html|js|css)$">
    Header set Cache-Control "no-cache"
  </FilesMatch>
  <FilesMatch "\.(mp3|mp4|jpg|webp|png|ttf)$">
    Header set Cache-Control "public, max-age=604800"
  </FilesMatch>
</IfModule>

# --- compression (not for media: they must keep their byte ranges) ------------
<IfModule mod_deflate.c>
  AddOutputFilterByType DEFLATE text/html text/css text/javascript application/javascript
</IfModule>
'''.replace('{CSP}', CSP)
README = '''The Momma Lewis Momo Learning Is FUN - "learn" web folder (public, ages 2-7), version {VER}

Upload this whole folder to public_html/learn on the domain. Open https://<your-domain>/learn/ to play.

- No password: anyone can open it (owner's choice, 2026-11-10).
- Privacy rules (the same as the other folders): HTTPS is forced; nosniff, SAMEORIGIN framing and no-referrer headers;
  no directory listings; data/ folders, notes (.md/.txt/.json) and hidden files are never served; no cookies;
  nothing is loaded from any other site (Content-Security-Policy); no ads, no accounts, no tracking. The child's name
  stays on the screen and is never saved or sent. The only thing kept in the browser is the "Mix up" switch.
- Everything is plain files (no PHP), so LiteSpeed answers the video and voice requests with byte ranges itself.
- This README and the .htaccess are not served to visitors.
'''


def main():
    if len(sys.argv) != 2:
        sys.exit(__doc__)
    out = os.path.join(os.path.abspath(sys.argv[1]), 'learn')
    if os.path.exists(out):
        sys.exit('%s exists: archive it first (ask the owner), then build again' % out)
    ver = [l for l in open(os.path.join(WEB, 'js', 'app.js')) if "var VERSION = '" in l][0].split("'")[1]
    n = 0
    for dp, dn, fn in os.walk(WEB):
        dn[:] = [d for d in dn if not d.startswith('.')]
        for f in fn:
            if '.bak' in f or f.startswith('.'):
                continue
            src = os.path.join(dp, f); dst = os.path.join(out, os.path.relpath(src, WEB))
            os.makedirs(os.path.dirname(dst), exist_ok=True); shutil.copy2(src, dst); n += 1
    open(os.path.join(out, '.htaccess'), 'w').write(HTACCESS)
    open(os.path.join(out, 'README.txt'), 'w').write(README.replace('{VER}', ver))
    size = sum(os.path.getsize(os.path.join(dp, f)) for dp, _, fs in os.walk(out) for f in fs)
    print('%s: %d app files + .htaccess + README.txt, %.1f MB (version %s)' % (out, n, size / 1e6, ver))


if __name__ == '__main__':
    main()
