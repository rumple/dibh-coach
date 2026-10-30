"""Tests for the test server: it must serve the app's scripts as JavaScript and nothing else in the repo."""
import sys
import threading
import unittest
import urllib.error
import urllib.request
from http.server import ThreadingHTTPServer
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
import server


class ServerTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.httpd = ThreadingHTTPServer(("127.0.0.1", 0), server.Handler)
        cls.base = f"http://127.0.0.1:{cls.httpd.server_address[1]}"
        threading.Thread(target=cls.httpd.serve_forever, daemon=True).start()

    @classmethod
    def tearDownClass(cls):
        cls.httpd.shutdown()
        cls.httpd.server_close()

    def get(self, path):
        try:
            with urllib.request.urlopen(self.base + path) as r:
                return r.status, r.headers["Content-Type"]
        except urllib.error.HTTPError as e:
            return e.code, e.headers["Content-Type"]

    def test_serves_the_page(self):
        for path in ("/", "/index.html"):
            self.assertEqual(self.get(path), (200, "text/html; charset=utf-8"))

    def test_serves_every_script_as_javascript(self):
        for name in ("core", "shared", "config", "demo", "phone-check", "coaching"):
            self.assertEqual(self.get(f"/js/{name}.js"), (200, "text/javascript; charset=utf-8"), name)

    def test_serves_nothing_else(self):
        for path in ("/server.py", "/README.md", "/.git/config", "/js/../server.py", "/js/", "/logs/"):
            self.assertEqual(self.get(path)[0], 404, path)


if __name__ == "__main__":
    unittest.main()
