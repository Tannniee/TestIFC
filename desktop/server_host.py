"""Lifecycle owner for the local Uvicorn bridge and packaged SPA."""

from __future__ import annotations

import logging
import mimetypes
import socket
import threading
import urllib.error
import urllib.request
from pathlib import Path
from typing import Any

import uvicorn
from fastapi.staticfiles import StaticFiles


class NoSignalServer(uvicorn.Server):
    """Uvicorn server controlled by the desktop thread."""

    def install_signal_handlers(self) -> None:
        return None


class ServerHost:
    def __init__(
        self,
        application: Any,
        *,
        host: str,
        requested_port: str | None,
        dist_dir: Path,
        startup_token: str,
        logger: logging.Logger,
    ) -> None:
        self._app = application
        self._host = host
        self._requested_port = requested_port
        self._dist_dir = dist_dir
        self._startup_token = startup_token
        self._logger = logger
        self._server: NoSignalServer | None = None
        self._thread: threading.Thread | None = None
        self._mounted = False
        self._readiness_installed = False
        self.port: int | None = None
        self._socket: socket.socket | None = None

    @property
    def base_url(self) -> str:
        if self.port is None:
            raise RuntimeError("server has not started")
        return f"http://{self._host}:{self.port}"

    def mount_spa(self) -> None:
        if self._mounted:
            return
        if not (self._dist_dir / "index.html").exists():
            raise SystemExit(
                f"Built SPA not found at {self._dist_dir}. "
                "Run `npm run build` in frontend/ first."
            )
        mimetypes.add_type("text/javascript", ".mjs")
        mimetypes.add_type("text/javascript", ".js")
        mimetypes.add_type("application/wasm", ".wasm")
        self._app.mount(
            "/",
            StaticFiles(directory=str(self._dist_dir), html=True),
            name="spa",
        )
        self._mounted = True

    def select_port(self) -> int:
        if self._requested_port is not None:
            port = int(self._requested_port)
            if not 1 <= port <= 65535:
                raise ValueError("IFC_VIEWER_PORT must be between 1 and 65535")
            return port
        return 0  # The OS selects a port on the socket passed directly to Uvicorn.

    def start(self, timeout_s: float = 15.0) -> str:
        if self._thread is not None:
            raise RuntimeError("server already started")
        # Register the probe before the catch-all SPA mount. Starlette resolves
        # routes in insertion order, so a later readiness route is unreachable.
        self._install_readiness_route()
        self.mount_spa()
        sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        try:
            if hasattr(socket, "SO_EXCLUSIVEADDRUSE"):
                sock.setsockopt(socket.SOL_SOCKET, socket.SO_EXCLUSIVEADDRUSE, 1)
            sock.bind((self._host, self.select_port()))
            sock.listen(socket.SOMAXCONN)
            self.port = int(sock.getsockname()[1])
            self._socket = sock
        except BaseException:
            sock.close()
            raise
        try:
            config = uvicorn.Config(
                self._app,
                host=self._host,
                port=self.port,
                log_level="warning",
            )
            self._server = NoSignalServer(config)
            self._thread = threading.Thread(
                target=self._run,
                name="ifc-bridge",
                daemon=True,
            )
            self._thread.start()
        except BaseException:
            self._socket.close()
            self._socket = None
            self._thread = self._server = None
            raise
        if not self.wait_until_ready(timeout_s):
            self.stop()
            raise SystemExit(f"Bridge did not come up on {self.base_url} within timeout.")
        self._logger.info(
            "Desktop bridge is ready",
            extra={"event": "server_ready"},
        )
        return self.base_url

    def wait_until_ready(self, timeout_s: float = 15.0) -> bool:
        deadline_checks = max(1, int(timeout_s * 10))
        for _ in range(deadline_checks):
            try:
                with urllib.request.urlopen(f"{self.base_url}/_desktop/ready", timeout=1) as response:
                    payload = response.read().decode("utf-8")
                    if response.status == 200 and self._startup_token in payload:
                        return True
            except (urllib.error.URLError, ConnectionError, OSError):
                pass
            threading.Event().wait(0.1)
        return False

    def stop(self, timeout_s: float = 15.0) -> None:
        server = self._server
        thread = self._thread
        if server is None or thread is None:
            return
        server.should_exit = True
        thread.join(timeout_s)
        if thread.is_alive():
            server.force_exit = True
            thread.join(1.0)
        if thread.is_alive():
            self._logger.error("Desktop bridge did not stop", extra={"event": "server_stop_timeout"})
            raise RuntimeError("Desktop bridge did not stop within the shutdown timeout")
        self._server = None
        self._thread = None
        self._logger.info(
            "Desktop bridge stopped",
            extra={"event": "server_stopped"},
        )

    def _run(self) -> None:
        try:
            assert self._server is not None
            self._server.run(sockets=[self._socket])
        except Exception:
            self._logger.exception(
                "Desktop bridge failed",
                extra={"event": "server_failed"},
            )
        finally:
            if self._socket is not None:
                self._socket.close()
                self._socket = None

    def _install_readiness_route(self) -> None:
        if self._readiness_installed:
            return

        def desktop_ready() -> dict[str, str]:
            return {"token": self._startup_token}

        self._app.add_api_route(
            "/_desktop/ready",
            desktop_ready,
            methods=["GET"],
            include_in_schema=False,
        )
        self._readiness_installed = True
