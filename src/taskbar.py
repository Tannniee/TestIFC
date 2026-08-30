"""Windows taskbar-button progress through ITaskbarList3."""

from __future__ import annotations

import ctypes
import threading
from ctypes import wintypes

TBPF_NOPROGRESS = 0
TBPF_INDETERMINATE = 1
TBPF_NORMAL = 2
TBPF_ERROR = 4
_PROGRESS_TOTAL = 100
_CLSID_TASKBAR_LIST = "{56FDF344-FD6D-11D0-958A-006097C9A090}"
_IID_ITASKBAR_LIST4 = "{C43DC798-95D1-4BEA-9030-BB99E2983A1A}"
_VTBL_RELEASE = 2
_VTBL_HR_INIT = 3
_VTBL_SET_PROGRESS_VALUE = 9
_VTBL_SET_PROGRESS_STATE = 10
_COINIT_APARTMENTTHREADED = 2
_RPC_E_CHANGED_MODE = -2147417850

_lock = threading.Lock()
_failure_logged = False


class _Guid(ctypes.Structure):
    _fields_ = [
        ("data1", wintypes.DWORD),
        ("data2", wintypes.WORD),
        ("data3", wintypes.WORD),
        ("data4", ctypes.c_ubyte * 8),
    ]


def _guid(text: str) -> _Guid:
    guid = _Guid()
    ctypes.oledll.ole32.CLSIDFromString(ctypes.c_wchar_p(text), ctypes.byref(guid))
    return guid


def _method(com_object: ctypes.c_void_p, index: int, *arg_types):
    vtable = ctypes.cast(
        com_object, ctypes.POINTER(ctypes.POINTER(ctypes.c_void_p))
    ).contents
    prototype = ctypes.WINFUNCTYPE(ctypes.HRESULT, ctypes.c_void_p, *arg_types)
    return prototype(vtable[index])


def _set_state(hwnd: int, flag: int, completed: int | None) -> bool:
    global _failure_logged
    with _lock:
        com_inited = False
        taskbar = ctypes.c_void_p()
        try:
            hr = ctypes.oledll.ole32.CoInitializeEx(
                None, _COINIT_APARTMENTTHREADED
            )
            com_inited = hr != _RPC_E_CHANGED_MODE
            ctypes.oledll.ole32.CoCreateInstance(
                ctypes.byref(_guid(_CLSID_TASKBAR_LIST)),
                None,
                1,
                ctypes.byref(_guid(_IID_ITASKBAR_LIST4)),
                ctypes.byref(taskbar),
            )
            _method(taskbar, _VTBL_HR_INIT)(taskbar)
            if completed is not None:
                _method(
                    taskbar,
                    _VTBL_SET_PROGRESS_VALUE,
                    wintypes.HWND,
                    ctypes.c_ulonglong,
                    ctypes.c_ulonglong,
                )(taskbar, hwnd, completed, _PROGRESS_TOTAL)
            else:
                _method(
                    taskbar,
                    _VTBL_SET_PROGRESS_STATE,
                    wintypes.HWND,
                    wintypes.DWORD,
                )(taskbar, hwnd, flag)
        except OSError as error:
            if not _failure_logged:
                _failure_logged = True
                print(f"WARN taskbar progress unavailable: {error}")
            return False
        finally:
            if taskbar.value:
                _method(taskbar, _VTBL_RELEASE)(taskbar)
            if com_inited:
                ctypes.oledll.ole32.CoUninitialize()
        return True


def set_progress(hwnd: int, ratio: float) -> bool:
    clamped = min(max(ratio, 0.0), 1.0)
    return _set_state(hwnd, TBPF_NORMAL, int(clamped * _PROGRESS_TOTAL))


def set_indeterminate(hwnd: int) -> bool:
    return _set_state(hwnd, TBPF_INDETERMINATE, None)


def set_error(hwnd: int) -> bool:
    return _set_state(hwnd, TBPF_ERROR, None)


def clear(hwnd: int) -> bool:
    return _set_state(hwnd, TBPF_NOPROGRESS, None)
