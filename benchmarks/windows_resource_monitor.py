"""Sample only a benchmark process tree; private bytes are committed memory."""
from __future__ import annotations

import ctypes as c
from ctypes import wintypes as w
import json
import os
from pathlib import Path
import sys
import time


class ProcessEntry(c.Structure):
    _fields_ = [("size", w.DWORD), ("usage", w.DWORD), ("pid", w.DWORD),
                ("heap", c.c_size_t), ("module", w.DWORD), ("threads", w.DWORD),
                ("parent", w.DWORD), ("priority", w.LONG), ("flags", w.DWORD),
                ("name", w.WCHAR * 260)]


class MemoryCounters(c.Structure):
    _fields_ = [("size", w.DWORD), ("faults", w.DWORD)] + [
        (name, c.c_size_t) for name in ("peakWorking", "working", "peakPaged", "paged",
                                       "peakNonpaged", "nonpaged", "pagefile", "peakPagefile", "private")]


class MemoryStatus(c.Structure):
    _fields_ = [("size", w.DWORD), ("load", w.DWORD)] + [
        (name, c.c_ulonglong) for name in ("total", "available", "totalPage", "availablePage",
                                         "totalVirtual", "availableVirtual", "extended")]


kernel = c.WinDLL("kernel32", use_last_error=True)
psapi = c.WinDLL("psapi", use_last_error=True)
kernel.CreateToolhelp32Snapshot.argtypes = [w.DWORD, w.DWORD]
kernel.CreateToolhelp32Snapshot.restype = w.HANDLE
kernel.Process32FirstW.argtypes = [w.HANDLE, c.POINTER(ProcessEntry)]
kernel.Process32NextW.argtypes = [w.HANDLE, c.POINTER(ProcessEntry)]
kernel.OpenProcess.argtypes = [w.DWORD, w.BOOL, w.DWORD]
kernel.OpenProcess.restype = w.HANDLE
kernel.CloseHandle.argtypes = [w.HANDLE]
kernel.GetProcessTimes.argtypes = [w.HANDLE] + [c.POINTER(w.FILETIME)] * 4
kernel.GlobalMemoryStatusEx.argtypes = [c.POINTER(MemoryStatus)]
psapi.GetProcessMemoryInfo.argtypes = [w.HANDLE, c.POINTER(MemoryCounters), w.DWORD]


def processes():
    snapshot = kernel.CreateToolhelp32Snapshot(2, 0)
    result = {}
    try:
        entry = ProcessEntry(size=c.sizeof(ProcessEntry))
        success = kernel.Process32FirstW(snapshot, c.byref(entry))
        while success:
            result[entry.pid] = (entry.parent, entry.name)
            success = kernel.Process32NextW(snapshot, c.byref(entry))
        return result
    finally:
        kernel.CloseHandle(snapshot)


def usage(pid):
    handle = kernel.OpenProcess(0x410, False, pid)
    if not handle:
        return None
    try:
        counters = MemoryCounters(size=c.sizeof(MemoryCounters))
        if not psapi.GetProcessMemoryInfo(handle, c.byref(counters), c.sizeof(counters)):
            return None
        created, exited, system, user = (w.FILETIME() for _ in range(4))
        kernel.GetProcessTimes(handle, c.byref(created), c.byref(exited), c.byref(system), c.byref(user))
        cpu = sum((value.dwHighDateTime << 32) + value.dwLowDateTime for value in (system, user)) / 1e7
        return {"workingBytes": counters.working, "privateBytes": counters.private, "cpuSeconds": cpu}
    finally:
        kernel.CloseHandle(handle)


def main():
    root, output, phase_file = int(sys.argv[1]), Path(sys.argv[2]), Path(sys.argv[3])
    previous, last = {}, time.monotonic()
    with output.open("a", encoding="utf-8", buffering=1) as stream:
        while True:
            table = processes()
            if root not in table:
                return
            family = {root}
            while True:
                children = {pid for pid, (parent, _) in table.items() if parent in family}
                if children <= family:
                    break
                family.update(children)
            family.discard(os.getpid())
            rows = []
            for pid in family:
                measured = usage(pid)
                if measured:
                    rows.append({"pid": pid, "name": table[pid][1], **measured})
            now = time.monotonic()
            delta = sum(max(0, row["cpuSeconds"] - previous.get(row["pid"], row["cpuSeconds"])) for row in rows)
            memory = MemoryStatus(size=c.sizeof(MemoryStatus))
            kernel.GlobalMemoryStatusEx(c.byref(memory))
            try:
                phase = json.loads(phase_file.read_text(encoding="utf-8"))
            except (OSError, ValueError):
                phase = {}
            sample = {"time": time.time(), **phase, "privateBytes": sum(r["privateBytes"] for r in rows),
                      "workingBytes": sum(r["workingBytes"] for r in rows), "availableBytes": memory.available,
                      "cpuCoreEquivalents": delta / max(now - last, 0.001), "processes": rows}
            stream.write(json.dumps(sample) + "\n")
            # A separate small file supports early stopping without reading a growing log.
            status = output.with_suffix(".status.json")
            staging = status.with_suffix(".tmp")
            staging.write_text(json.dumps(sample), encoding="utf-8")
            # A concurrent Windows reader can temporarily deny replacement.
            # Keep sampling the authoritative JSONL even if this advisory file
            # cannot be refreshed on this tick.
            try:
                os.replace(staging, status)
            except PermissionError:
                pass
            previous = {r["pid"]: r["cpuSeconds"] for r in rows}
            last = now
            time.sleep(1)


if __name__ == "__main__":
    main()
