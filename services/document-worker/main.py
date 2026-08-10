import json
import os
import queue
import threading
import traceback
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

from dotenv import load_dotenv

from jobs.process_pdf import process_source

load_dotenv()

PORT = int(os.environ.get("WORKER_PORT", 8000))

# Processing a scanned PDF runs to minutes, so /process accepts the job and
# returns immediately; source_documents.status is the progress channel the UI
# polls. Holding the connection open instead would block the upload for the
# whole parse and strand the request behind any proxy timeout.
#
# One consumer thread, not a pool: parsing is CPU-bound and the Docling
# converter is shared mutable state, so concurrent jobs would contend for both.
_jobs: "queue.Queue[str]" = queue.Queue()


def _worker_loop() -> None:
    while True:
        source_id = _jobs.get()
        try:
            print(f"[worker] processing {source_id}", flush=True)
            process_source(source_id)
            print(f"[worker] finished {source_id}", flush=True)
        except Exception:
            # process_source already recorded the failure on the row; this is
            # only so the traceback is visible in the worker log.
            print(f"[worker] FAILED {source_id}", flush=True)
            traceback.print_exc()
        finally:
            _jobs.task_done()


class Handler(BaseHTTPRequestHandler):
    def do_GET(self):
        if self.path == "/health":
            self._respond(200, {"status": "ok", "queued": _jobs.qsize()})
        else:
            self._respond(404, {"status": "error", "message": "not found"})

    def do_POST(self):
        if self.path != "/process":
            self._respond(404, {"status": "error", "message": "not found"})
            return

        length = int(self.headers.get("Content-Length", 0))
        body = self.rfile.read(length)

        try:
            payload = json.loads(body)
            source_id = payload["source_id"]
        except (json.JSONDecodeError, KeyError):
            self._respond(400, {"status": "error", "message": "body must be JSON with source_id"})
            return

        _jobs.put(source_id)
        self._respond(202, {"status": "accepted", "queued": _jobs.qsize()})

    def _respond(self, code: int, body: dict):
        payload = json.dumps(body).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(payload)))
        self.end_headers()
        self.wfile.write(payload)

    def log_message(self, format, *args):
        print(f"[worker] {self.address_string()} - {format % args}", flush=True)


if __name__ == "__main__":
    threading.Thread(target=_worker_loop, daemon=True).start()
    print(f"[worker] starting on port {PORT}", flush=True)
    ThreadingHTTPServer(("", PORT), Handler).serve_forever()
