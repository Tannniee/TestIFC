from pathlib import Path

from PyInstaller.utils.hooks import collect_all, collect_submodules

ROOT = Path(SPECPATH)

ifc_data, ifc_binaries, ifc_hidden = collect_all("ifcopenshell")
webview_hidden = collect_submodules("webview")

analysis = Analysis(
    [str(ROOT / "desktop" / "main.py")],
    pathex=[str(ROOT / "src"), str(ROOT / "vendor")],
    binaries=ifc_binaries
    + [(str(ROOT / "vendor" / "ifc_auth" / "ifc_auth.pyd"), "ifc_auth")],
    datas=ifc_data
    + [
        (str(ROOT / "frontend" / "dist"), "frontend/dist"),
        (str(ROOT / "backend" / "reference_data"), "backend/reference_data"),
        (str(ROOT / "desktop" / "build_config.json"), "desktop"),
        (str(ROOT / "desktop" / "assets" / "app_icon.ico"), "desktop/assets"),
        (str(ROOT / "vendor" / "ifc_auth" / "__init__.py"), "ifc_auth"),
    ],
    hiddenimports=ifc_hidden + webview_hidden + ["ifc_auth", "ifc_auth.ifc_auth"],
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
    name="IFC Viewer 0.4.0 ahihi",
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
)
