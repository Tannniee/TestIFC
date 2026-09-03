"""Per-process API credentials, with loopback Host and browser Origin checks."""
from __future__ import annotations

import hmac
import os
import secrets
from urllib.parse import urlsplit

from fastapi import Request
from fastapi.responses import JSONResponse

SESSION_HEADER = "X-IFC-Session"
LOCAL_HOSTS = {"127.0.0.1", "::1", "localhost"}
DEV_ORIGINS = {f"http://{host}:{port}" for host in ("127.0.0.1", "localhost") for port in (5173, 4173)}


class InternalApiSession:
    def __init__(self) -> None:
        self.secret = os.environ.get("IFC_API_SESSION_TOKEN") or secrets.token_urlsafe(32)
        if len(self.secret) < 32 or not self.secret.isascii():
            raise ValueError("IFC_API_SESSION_TOKEN must contain at least 32 ASCII characters")

    async def protect(self, request: Request, call_next):
        client = request.client.host if request.client else ""
        try:
            authority = urlsplit("http://" + request.headers.get("host", ""))
            valid_host = (
                authority.hostname in LOCAL_HOSTS and not authority.username and not authority.password
                and not authority.path and not authority.query and not authority.fragment
            )
            # Accessing port also rejects malformed authorities.
            authority.port
        except ValueError:
            valid_host = False
        if client not in LOCAL_HOSTS | {"testclient"} or not valid_host:
            return JSONResponse({"error": "local_only"}, status_code=403)
        origin = request.headers.get("origin")
        same_origin = f"{request.url.scheme}://{request.headers['host']}"
        if origin is not None and origin not in DEV_ORIGINS | {same_origin}:
            return JSONResponse({"error": "untrusted_origin"}, status_code=403)
        # Fail closed for all endpoint families. Only the packaged UI and probes
        # can be loaded before the desktop bridge supplies its credential.
        path = request.url.path
        protected = path not in ("/", "/index.html", "/favicon.ico", "/favicon.svg", "/health", "/_desktop/ready") and not path.startswith(("/assets/", "/vendor/"))
        if protected and request.method != "OPTIONS":
            supplied = request.headers.get(SESSION_HEADER, "")
            if not hmac.compare_digest(supplied.encode(), self.secret.encode()):
                return JSONResponse({"error": "invalid_session"}, status_code=401)
        response = await call_next(request)
        if protected:
            response.headers["Cache-Control"] = "no-store"
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["Referrer-Policy"] = "no-referrer"
        response.headers["X-Frame-Options"] = "DENY"
        return response
