#!/usr/bin/env python3
"""Emulsion bridge: serves the app and syncs an AI director with the user's browser.

Endpoints:
  GET  /                 the app
  GET  /ops?since=N      ops newer than seq N (the app polls this; spec / seek / play / shotview / say / assets)
  POST /op               queue an op for every open browser; 'spec' ops also stored
  GET  /state            latest scene spec (updated by agent ops AND by user edits in the app)
  POST /state            app pushes user-edited scene state (no broadcast)
  GET  /annotations      annotations the user clicked in the app
  POST /annotations      app appends an annotation
  POST /annotations/clear
  GET  /assets.json      file listing of ./assets for the in-app shelf

stdlib only. ponytail: last-writer-wins state, in-memory only — persistence via the app's Save button.
"""
import json
import mimetypes
import os
import time
import urllib.parse
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

ROOT = os.path.dirname(os.path.abspath(__file__))
PORT = int(os.environ.get('EMULSION_PORT', 8741))

state = {'spec': None, 'seq': 0}  # seq: monotonic op counter so clients drop stale/duplicate ops
ops = []  # recent op log; clients poll /ops?since=<seq>. ponytail: capped in-memory ring
annotations = []


def _safe_name(name):
    return ''.join(c for c in name if c.isalnum() or c in ' ._-')[:64].strip() or 'untitled'


class Handler(BaseHTTPRequestHandler):
    def log_message(self, *args):
        pass

    def _json(self, obj, code=200):
        body = json.dumps(obj).encode()
        self.send_response(code)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Content-Length', str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _body(self):
        n = int(self.headers.get('Content-Length', 0))
        return json.loads(self.rfile.read(n) or b'{}')

    def do_GET(self):
        path = urllib.parse.urlparse(self.path).path
        if path == '/ops':
            qs = urllib.parse.parse_qs(urllib.parse.urlparse(self.path).query)
            since = int(qs.get('since', ['0'])[0] or 0)
            if since == 0 and state['spec']:
                return self._json({'ops': [{'type': 'spec', 'spec': state['spec'], 'note': 'sync', 'seq': state['seq']}]})
            return self._json({'ops': [op for op in ops if op['seq'] > since]})
        if path == '/state':
            return self._json(state['spec'] or {})
        if path == '/annotations':
            return self._json(annotations)
        for lib in ('shots', 'sets'):
            if path == f'/{lib}':
                sdir = os.path.join(ROOT, lib)
                names = sorted(f[:-5] for f in os.listdir(sdir) if f.endswith('.json')) if os.path.isdir(sdir) else []
                return self._json(names)
            if path.startswith(f'/{lib}/'):
                name = _safe_name(urllib.parse.unquote(path[len(lib) + 2:]))
                f = os.path.join(ROOT, lib, name + '.json')
                if not os.path.isfile(f):
                    return self._json({'error': f'no such {lib[:-1]}'}, 404)
                with open(f) as fh:
                    return self._json(json.load(fh))
        if path == '/assets.json':
            adir = os.path.join(ROOT, 'assets')
            files = sorted(os.listdir(adir)) if os.path.isdir(adir) else []
            return self._json([f for f in files if not f.startswith('.')])
        if path == '/':
            path = '/index.html'
        f = os.path.normpath(os.path.join(ROOT, path.lstrip('/')))
        if not f.startswith(ROOT) or not os.path.isfile(f):
            self.send_response(404)
            self.end_headers()
            return
        with open(f, 'rb') as fh:
            body = fh.read()
        ctype = mimetypes.guess_type(f)[0] or 'application/octet-stream'
        rng = self.headers.get('Range', '')
        if rng.startswith('bytes='):  # video seeking needs 206 partial responses
            try:
                start_s, _, end_s = rng[6:].partition('-')
                start = int(start_s or 0)
                end = min(int(end_s) if end_s else len(body) - 1, len(body) - 1)
                chunk = body[start:end + 1]
                self.send_response(206)
                self.send_header('Content-Type', ctype)
                self.send_header('Content-Range', f'bytes {start}-{end}/{len(body)}')
                self.send_header('Accept-Ranges', 'bytes')
                self.send_header('Content-Length', str(len(chunk)))
                self.end_headers()
                self.wfile.write(chunk)
                return
            except ValueError:
                pass
        self.send_response(200)
        self.send_header('Content-Type', ctype)
        self.send_header('Accept-Ranges', 'bytes')
        self.send_header('Content-Length', str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_POST(self):
        path = urllib.parse.urlparse(self.path).path
        if path == '/op':
            op = self._body()
            state['seq'] += 1
            op['seq'] = state['seq']
            if op.get('type') == 'spec':
                state['spec'] = op.get('spec')
            ops.append(op)
            del ops[:-200]
            return self._json({'ok': True, 'seq': op['seq']})
        if path == '/state':
            state['spec'] = self._body()
            return self._json({'ok': True})
        if path in ('/shots', '/sets'):
            lib = path[1:]
            body = self._body()
            name = _safe_name(body.get('name') or 'untitled')
            sdir = os.path.join(ROOT, lib)
            os.makedirs(sdir, exist_ok=True)
            with open(os.path.join(sdir, name + '.json'), 'w') as fh:
                json.dump(body.get('spec') or {}, fh)
            state['seq'] += 1
            ops.append({'type': lib, 'seq': state['seq']})  # library lists refresh everywhere
            return self._json({'ok': True, 'name': name})
        if path.startswith('/assets/'):
            name = _safe_name(urllib.parse.unquote(path[len('/assets/'):]))
            adir = os.path.join(ROOT, 'assets')
            os.makedirs(adir, exist_ok=True)
            n = int(self.headers.get('Content-Length', 0))
            with open(os.path.join(adir, name), 'wb') as fh:
                fh.write(self.rfile.read(n))
            state['seq'] += 1
            ops.append({'type': 'assets', 'seq': state['seq']})
            return self._json({'ok': True, 'name': name})
        if path == '/open':
            import subprocess
            name = _safe_name(self._body().get('name') or '')
            f = os.path.join(ROOT, 'assets', name)
            if os.path.isfile(f):
                subprocess.Popen(['open', '-R', f])  # reveal in Finder (macOS)
                return self._json({'ok': True})
            return self._json({'error': 'no such asset'}, 404)
        if path == '/annotations':
            ann = self._body()
            ann['at'] = time.strftime('%H:%M:%S')
            annotations.append(ann)
            return self._json({'ok': True})
        if path == '/annotations/clear':
            annotations.clear()
            return self._json({'ok': True})
        self.send_response(404)
        self.end_headers()


if __name__ == '__main__':
    print(f'Emulsion running at http://localhost:{PORT}')
    ThreadingHTTPServer(('127.0.0.1', PORT), Handler).serve_forever()
