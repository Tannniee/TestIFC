"""Launch the packaged app and verify its local HTTP bridge and SPA."""

from __future__ import annotations

import argparse
import json
import os
import re
import socket
import subprocess
import time
import urllib.error
import urllib.request
from pathlib import Path


def _free_port() -> int:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as probe:
        probe.bind(("127.0.0.1", 0))
        return int(probe.getsockname()[1])


def _read(url: str, timeout: float = 2.0) -> tuple[int, bytes, str]:
    with urllib.request.urlopen(url, timeout=timeout) as response:
        return response.status, response.read(), response.headers.get_content_type()


def smoke(executable: Path, timeout_seconds: float) -> None:
    port = _free_port()
    base_url = f"http://127.0.0.1:{port}"
    environment = os.environ.copy()
    environment["IFC_VIEWER_PORT"] = str(port)
    environment.setdefault(
        "WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS",
        "--headless=new --disable-gpu",
    )
    process = subprocess.Popen([str(executable)], env=environment)
    try:
        deadline = time.monotonic() + timeout_seconds
        last_error: Exception | None = None
        while time.monotonic() < deadline:
            if process.poll() is not None:
                raise RuntimeError(
                    f"packaged app exited before readiness with code {process.returncode}"
                )
            try:
                status, body, content_type = _read(f"{base_url}/health")
                health = json.loads(body)
                if status == 200 and health.get("ok") is True:
                    break
            except (urllib.error.URLError, OSError, ValueError) as error:
                last_error = error
            time.sleep(0.25)
        else:
            raise RuntimeError(f"packaged app did not become ready: {last_error}")

        status, html_bytes, content_type = _read(f"{base_url}/")
        html = html_bytes.decode("utf-8")
        if status != 200 or content_type != "text/html" or 'id="app"' not in html:
            raise RuntimeError("packaged SPA entry point is invalid")
        asset_match = re.search(r'<script[^>]+src="([^"]+\.js)"', html)
        if asset_match is None:
            raise RuntimeError("packaged SPA JavaScript asset was not found")
        asset_url = f"{base_url}/{asset_match.group(1).lstrip('/')}"
        asset_status, asset_body, _ = _read(asset_url)
        if asset_status != 200 or not asset_body:
            raise RuntimeError("packaged SPA JavaScript asset is unavailable")
    finally:
        if process.poll() is None:
            process.terminate()
            try:
                process.wait(10)
            except subprocess.TimeoutExpired:
                process.kill()
                process.wait(5)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--dist", type=Path, required=True)
    parser.add_argument("--timeout", type=float, default=45.0)
    args = parser.parse_args()
    executables = sorted(args.dist.resolve().glob("*.exe"))
    if len(executables) != 1:
        raise SystemExit(
            f"expected exactly one packaged executable in {args.dist}, found {len(executables)}"
        )
    smoke(executables[0], args.timeout)
    print(f"packaged smoke test passed: {executables[0]}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
