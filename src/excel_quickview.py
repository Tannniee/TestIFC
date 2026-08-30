"""Open a table in a live, unsaved Excel workbook."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Sequence

_SHEET_NAME = "Takeoff"
_CHUNK_ROWS = 5000
_KG_NUMBER_FORMAT = "0.00"


@dataclass(frozen=True)
class Opened:
    book: str
    rows: int


@dataclass(frozen=True)
class Unavailable:
    reason: str
    detail: str


Result = Opened | Unavailable


def _rectangular(rows: Sequence[Sequence[Any]]) -> list[tuple[Any, ...]]:
    width = max((len(row) for row in rows), default=0)
    return [
        tuple(cell if cell is not None else "" for cell in row)
        + ("",) * (width - len(row))
        for row in rows
    ]


def open_table(
    rows: Sequence[Sequence[Any]],
    kg_columns: Sequence[int] = (),
    header_index: int = 0,
) -> Result:
    if not rows:
        return Unavailable("empty", "there are no rows to show")
    try:
        import pythoncom
        import win32com.client as win32com_client
    except ImportError as error:
        return Unavailable("no_com_support", str(error))

    pythoncom.CoInitialize()
    try:
        try:
            return _fill_new_workbook(
                win32com_client, rows, kg_columns, header_index
            )
        except Exception as error:
            return Unavailable(
                "excel_unavailable", f"{type(error).__name__}: {error}"
            )
    finally:
        pythoncom.CoUninitialize()


def _fill_new_workbook(
    client: Any,
    rows: Sequence[Sequence[Any]],
    kg_columns: Sequence[int],
    header_index: int = 0,
) -> Result:
    grid = _rectangular(rows)
    excel = client.Dispatch("Excel.Application")
    excel.Visible = True
    excel.UserControl = True
    screen_updating = excel.ScreenUpdating
    excel.ScreenUpdating = False
    try:
        sheet = excel.Workbooks.Add().Worksheets(1)
        sheet.Name = _SHEET_NAME
        width = len(grid[0])
        for start in range(0, len(grid), _CHUNK_ROWS):
            chunk = grid[start : start + _CHUNK_ROWS]
            sheet.Range(
                sheet.Cells(start + 1, 1),
                sheet.Cells(start + len(chunk), width),
            ).Value = chunk
        _dress(sheet, grid, width, kg_columns, header_index)
        return Opened(str(sheet.Parent.Name), len(grid))
    finally:
        excel.ScreenUpdating = screen_updating


def _dress(
    sheet: Any,
    grid: Sequence[Sequence[Any]],
    width: int,
    kg_columns: Sequence[int],
    header_index: int,
) -> None:
    header_row = header_index + 1
    sheet.Range(
        sheet.Cells(header_row, 1), sheet.Cells(header_row, width)
    ).Font.Bold = True
    sheet.Range(
        sheet.Cells(header_row, 1), sheet.Cells(len(grid), width)
    ).Columns.AutoFit()
    for column in kg_columns:
        if column >= width:
            continue
        sheet.Range(
            sheet.Cells(header_row + 1, column + 1),
            sheet.Cells(len(grid), column + 1),
        ).NumberFormat = _KG_NUMBER_FORMAT
    sheet.Activate()
    sheet.Application.ActiveWindow.FreezePanes = False
    sheet.Cells(header_row + 1, 1).Select()
    sheet.Application.ActiveWindow.FreezePanes = True
