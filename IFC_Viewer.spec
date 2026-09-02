from pathlib import Path

from PyInstaller.utils.hooks import collect_all, collect_submodules
from PyInstaller.utils.win32.versioninfo import (
    FixedFileInfo, StringFileInfo, StringStruct, StringTable, VarFileInfo,
    VarStruct, VSVersionInfo,
)

ROOT = Path(SPECPATH)
version_namespace = {}
exec((ROOT / "src" / "version.py").read_text(encoding="utf-8"), version_namespace)
PACKAGE_NAME = f"IFC Viewer {version_namespace['APP_VERSION']}"
VERSION = version_namespace["APP_VERSION"]
VERSION_PARTS = tuple(int(part) for part in VERSION.split(".")) + (0,)
VERSION_INFO = VSVersionInfo(
    ffi=FixedFileInfo(
        filevers=VERSION_PARTS, prodvers=VERSION_PARTS, mask=0x3F,
        flags=0, OS=0x40004, fileType=1, subtype=0, date=(0, 0),
    ),
    kids=[
        StringFileInfo([StringTable("040904B0", [
            StringStruct("FileDescription", "IFC Viewer"),
            StringStruct("FileVersion", VERSION),
            StringStruct("ProductName", "IFC Viewer"),
            StringStruct("ProductVersion", VERSION),
            StringStruct("OriginalFilename", f"{PACKAGE_NAME}.exe"),
        ])]),
        VarFileInfo([VarStruct("Translation", [1033, 1200])]),
    ],
)

ifc_data, ifc_binaries, ifc_hidden = collect_all("ifcopenshell")
webview_hidden = collect_submodules("webview")

analysis = Analysis(
    [str(ROOT / "desktop" / "main.py")],
    pathex=[str(ROOT / "src")],
    binaries=ifc_binaries,
    datas=ifc_data
    + [
        (str(ROOT / "frontend" / "dist"), "frontend/dist"),
        (str(ROOT / "backend" / "reference_data"), "backend/reference_data"),
        (str(ROOT / "desktop" / "assets" / "app_icon.ico"), "desktop/assets"),
    ],
    hiddenimports=ifc_hidden + webview_hidden,
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=[],
    noarchive=False,
    optimize=0,
)

pyz = PYZ(analysis.pure)

exe = EXE(
    pyz,
    analysis.scripts,
    analysis.binaries,
    analysis.datas,
    [],
    name=PACKAGE_NAME,
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=True,
    upx_exclude=[],
    runtime_tmpdir=None,
    console=False,
    disable_windowed_traceback=False,
    argv_emulation=False,
    target_arch=None,
    codesign_identity=None,
    entitlements_file=None,
    icon=[str(ROOT / "desktop" / "assets" / "app_icon.ico")],
    version=VERSION_INFO,
)
