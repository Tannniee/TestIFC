from __future__ import annotations

import os
import sqlite3
import sys
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import Mock, patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'src'))
import ifc_elements
import model_index


class SemanticOptimizationTests(unittest.TestCase):
    def test_missing_volume_does_not_resolve_density(self):
        units = SimpleNamespace(has_mass_unit=True, mass_scale=1)
        with patch.object(ifc_elements.ifcopenshell.util.element, 'get_element_mass_density') as density:
            self.assertIsNone(ifc_elements._compute_mass_kg(object(), units, {}))
            density.assert_not_called()

    def test_zero_volume_remains_a_valid_numeric_mass(self):
        units = SimpleNamespace(has_mass_unit=True, mass_scale=1)
        with patch.object(ifc_elements.ifcopenshell.util.element, 'get_element_mass_density', return_value=7850):
            self.assertEqual(ifc_elements._compute_mass_kg(object(), units, {'Qto': {'NetVolume': 0}}), 0)

    @unittest.skipUnless(os.name == 'nt', 'Windows WAL recovery')
    def test_transient_truncate_reopens_connection(self):
        error = sqlite3.OperationalError('disk I/O error')
        error.sqlite_errorcode = sqlite3.SQLITE_IOERR_TRUNCATE
        first, second = Mock(), Mock()
        first.execute.side_effect = error
        with patch.object(model_index.sqlite3, 'connect', side_effect=[first, second]), patch.object(model_index, 'sleep'):
            model_index.recover_interrupted_build(Path('probe.sqlite'))
        first.close.assert_called_once()
        second.close.assert_called_once()

    def test_other_io_errors_are_not_retried(self):
        error = sqlite3.OperationalError('disk I/O error')
        error.sqlite_errorcode = sqlite3.SQLITE_IOERR_READ
        connection = Mock()
        connection.execute.side_effect = error
        with patch.object(model_index.sqlite3, 'connect', return_value=connection) as connect:
            with self.assertRaises(sqlite3.OperationalError):
                model_index.recover_interrupted_build(Path('probe.sqlite'))
        self.assertEqual(connect.call_count, 1)

    @unittest.skipUnless(os.name == 'nt', 'Windows WAL recovery')
    def test_persistent_truncate_is_not_hidden(self):
        error = sqlite3.OperationalError('disk I/O error')
        error.sqlite_errorcode = sqlite3.SQLITE_IOERR_TRUNCATE
        connection = Mock()
        connection.execute.side_effect = error
        with patch.object(model_index.sqlite3, 'connect', return_value=connection) as connect, patch.object(model_index, 'sleep'):
            with self.assertRaises(sqlite3.OperationalError):
                model_index.recover_interrupted_build(Path('probe.sqlite'))
        self.assertEqual(connect.call_count, 6)
