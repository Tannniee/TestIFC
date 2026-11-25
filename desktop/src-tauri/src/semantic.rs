// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.
//! Disk-backed semantic records. IPC carries bounded binary chunks, never a
//! model-sized JSON/UTF-16 message inside WebView2's host process.
use std::fs::File;
use std::io::{BufWriter, Read, Seek, SeekFrom, Write};
use std::sync::atomic::{AtomicBool, Ordering};
use tempfile::NamedTempFile;

pub struct SemanticStream(NamedTempFile);

pub fn record<T: serde::Serialize>(writer: &mut impl Write, table: &str, row: &T,
    cancel: &AtomicBool) -> Result<(), String> {
    if cancel.load(Ordering::Acquire) { return Err("Native IFC job cancelled".into()); }
    serde_json::to_writer(&mut *writer, &(table, row)).map_err(|e| e.to_string())?;
    writer.write_all(b"\n").map_err(|e| e.to_string())
}

impl SemanticStream {
    pub fn encode(write: impl FnOnce(&mut BufWriter<&mut File>) -> Result<(), String>) -> Result<Self, String> {
        let mut file = NamedTempFile::new().map_err(|e| e.to_string())?;
        {
            let mut writer = BufWriter::new(file.as_file_mut());
            write(&mut writer)?;
            writer.flush().map_err(|e| e.to_string())?;
        }
        file.seek(SeekFrom::Start(0)).map_err(|e| e.to_string())?;
        Ok(Self(file))
    }

    pub fn byte_len(&self) -> Result<u64, String> {
        self.0.as_file().metadata().map(|m| m.len()).map_err(|e| e.to_string())
    }

    pub fn next_packet(&mut self, limit: usize) -> Result<Vec<u8>, String> {
        let mut bytes = vec![0; limit];
        let read = self.0.read(&mut bytes).map_err(|e| e.to_string())?;
        bytes.truncate(read);
        Ok(bytes)
    }
}

#[cfg(test)]
#[path = "semantic_tests.rs"]
mod tests;
