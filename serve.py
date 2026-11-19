#!/usr/bin/env python3
"""Serve dist/ on the LAN with an explicit UTF-8 charset. Usage: python3 serve.py [port]"""
import http.server, sys, pathlib, functools
class H(http.server.SimpleHTTPRequestHandler):
    extensions_map = {**http.server.SimpleHTTPRequestHandler.extensions_map, '.html': 'text/html; charset=utf-8', '.json': 'application/json; charset=utf-8', '.csv': 'text/csv; charset=utf-8'}
port = int(sys.argv[1]) if len(sys.argv) > 1 else 8090
d = str(pathlib.Path(__file__).parent / 'dist')
http.server.ThreadingHTTPServer(('0.0.0.0', port), functools.partial(H, directory=d)).serve_forever()
