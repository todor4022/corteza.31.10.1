"""Seed the Tickets application and sample tickets through a container-local API."""

import json
import os
import re
import subprocess
import sys
import tempfile
import time
from contextlib import contextmanager
from pathlib import Path
from urllib.error import URLError
from urllib.parse import urlencode
from urllib.request import Request, urlopen


@contextmanager
def local_api():
    # The main web server waits for this seed job. Run an API only on this
    # container's loopback interface, with the newly imported modules loaded.
    base = "http://127.0.0.1:8080"
    with tempfile.TemporaryDirectory(prefix="corteza-record-seed-") as directory:
        with (Path(directory) / "server.log").open("w+") as log:
            process = subprocess.Popen(
                ["corteza-server", "serve-api"],
                env={**os.environ, "HTTP_ADDR": "127.0.0.1:8080"},
                stdout=log,
                stderr=subprocess.STDOUT,
            )
            try:
                deadline = time.monotonic() + 60
                while True:
                    if process.poll() is not None:
                        raise RuntimeError("The temporary Corteza API stopped during startup")
                    try:
                        with urlopen(base + "/healthcheck", timeout=2) as response:
                            response.read()
                        break
                    except (URLError, TimeoutError):
                        if time.monotonic() >= deadline:
                            raise RuntimeError("Timed out starting the temporary Corteza API")
                        time.sleep(0.25)
                yield base
            except BaseException:
                log.seek(0)
                print("".join(log.readlines()[-40:]), file=sys.stderr)
                raise
            finally:
                if process.poll() is None:
                    process.terminate()
                    try:
                        process.wait(timeout=15)
                    except subprocess.TimeoutExpired:
                        process.kill()
                        process.wait()


def seed_application(api, application):
    key = application["labels"]["plexysHomeworkSeedKey"]
    cursor = ""
    while True:
        # Include deleted applications so an administrator's deletion is kept.
        query = {"limit": 100, "deleted": 1}
        if cursor:
            query["pageCursor"] = cursor
        page = api("/application/?" + urlencode(query), service="system")
        for existing in page["set"]:
            if (
                (existing.get("labels") or {}).get("plexysHomeworkSeedKey") == key
                or existing["name"] == application["name"]
                or (existing.get("unify") or {}).get("url", "").strip("/") == "tickets"
            ):
                print("Tickets application already exists; skipping.", flush=True)
                return
        cursor = page.get("filter", {}).get("nextPage")
        if not cursor:
            break
    api("/application/", application, service="system")
    print("Registered the Tickets home-screen application.", flush=True)


def seed_resources(base, samples, application):
    # A short-lived token works even if an existing user changed their password.
    result = subprocess.run(
        ["corteza-server", "auth", "jwt", os.environ["SEED_USER_EMAIL"],
         "--duration", "5m", "--scope", "api"],
        capture_output=True,
        text=True,
        check=True,
    )
    match = re.search(
        r"eyJ[A-Za-z0-9_-]*\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+",
        result.stdout + result.stderr,
    )
    if match is None:
        raise RuntimeError("Could not obtain the seed user's API token")
    token = match.group()

    def api(path, payload=None, service="compose"):
        headers = {"Authorization": "Bearer " + token}
        if payload is not None:
            headers["Content-Type"] = "application/json"
        request = Request(
            base + "/api/" + service + path,
            headers=headers,
            data=None if payload is None else json.dumps(payload).encode(),
        )
        with urlopen(request, timeout=30) as response:
            body = json.load(response)
        if body.get("error"):
            raise RuntimeError("Corteza seed failed: " + json.dumps(body["error"]))
        return body["response"]

    seed_application(api, application)

    namespaces = api("/namespace/?slug=plexys-homework")["set"]
    if len(namespaces) != 1:
        raise RuntimeError("Expected one Plexys Homework namespace")
    namespace_path = "/namespace/" + namespaces[0]["namespaceID"]
    modules = api(namespace_path + "/module/?handle=support-ticket")["set"]
    if len(modules) != 1:
        raise RuntimeError("Expected one Support Ticket module")
    record_path = namespace_path + "/module/" + modules[0]["moduleID"] + "/record/"

    # Include soft-deleted records: deleting a demo ticket should keep it deleted.
    existing_keys = set()
    cursor = ""
    while True:
        query = {"limit": 100, "deleted": 1}
        if cursor:
            query["pageCursor"] = cursor
        page = api(record_path + "?" + urlencode(query))
        for record in page["set"]:
            key = (record.get("meta") or {}).get("plexysHomeworkSeedKey")
            if key:
                existing_keys.add(key)
        cursor = page.get("filter", {}).get("nextPage")
        if not cursor:
            break

    for sample in samples:
        key = sample["seedKey"]
        if key in existing_keys:
            print("Sample ticket already exists; skipping: " + key, flush=True)
            continue
        api(record_path, {
            "meta": {"plexysHomeworkSeedKey": key},
            "values": [
                {"name": name, "value": value}
                for name, value in sample["values"].items()
            ],
        })
        existing_keys.add(key)
        print("Created sample ticket: " + sample["values"]["Subject"], flush=True)


if __name__ == "__main__":
    samples = json.loads(Path("/seed/support-tickets.json").read_text())
    application = json.loads(Path("/seed/tickets-application.json").read_text())
    keys = [sample["seedKey"] for sample in samples]
    if not all(keys) or len(keys) != len(set(keys)):
        raise ValueError("Sample ticket seed keys must be non-empty and unique")
    with local_api() as base:
        seed_resources(base, samples, application)
