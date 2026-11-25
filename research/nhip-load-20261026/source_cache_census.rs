// Research-only Nhip load census. Temporarily include in the geometry crate.
// No mesh retention, memoization, geometry changes, or new dependencies.
// API: observe(kind, P, stock, cutters, work); write_report(path).
// Set IFCLITE_SOURCE_CACHE_CENSUS=1 before process startup; flag is latched.

use std::collections::{BTreeSet, HashMap};
use std::io::{BufWriter, Write};
use std::sync::{Mutex, OnceLock};
use std::time::Instant;

const MAX_KEYS: usize = 100_000;
const MAX_OUTPUT_VARIANTS: usize = 8;
static ENABLED: OnceLock<bool> = OnceLock::new();
static STATE: OnceLock<Mutex<State>> = OnceLock::new();

fn enabled() -> bool {
    *ENABLED.get_or_init(|| std::env::var("IFCLITE_SOURCE_CACHE_CENSUS").as_deref() == Ok("1"))
}

#[derive(Clone, Copy, Debug, Hash, PartialEq, Eq, PartialOrd, Ord)]
struct Digest(u64, u64);

impl std::fmt::Display for Digest {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{:016x}{:016x}", self.0, self.1)
    }
}

// Diagnostic hash, not cryptographic and not a mesh-equality proof. Every
// value/length/tag is visited; float bits and order are never normalized.
#[derive(Clone)]
struct HashBits { a: u64, b: u64, bytes: u64 }

impl HashBits {
    fn new(domain: u64) -> Self {
        let mut h = Self { a: 0xcbf29ce484222325, b: 0x9e3779b97f4a7c15, bytes: 0 };
        h.u64(domain);
        h
    }
    fn feed(&mut self, value: u64, bytes: u64) {
        self.a = (self.a ^ value).rotate_left(13).wrapping_mul(0x517cc1b727220a95);
        self.b = (self.b ^ value.rotate_left(31)).rotate_left(29).wrapping_mul(0x9ddfea08eb382d69);
        self.bytes = self.bytes.saturating_add(bytes);
    }
    fn u64(&mut self, value: u64) { self.feed(value, 8); }
    fn u32(&mut self, value: u32) { self.feed(u64::from(value), 4); }
    fn flag(&mut self, value: bool) { self.feed(u64::from(value), 1); }
    fn f32s(&mut self, values: &[f32]) {
        self.u64(values.len() as u64);
        for value in values { self.u32(value.to_bits()); }
    }
    fn f64s(&mut self, values: &[f64]) {
        self.u64(values.len() as u64);
        for value in values { self.u64(value.to_bits()); }
    }
    fn optional_f64s<const N: usize>(&mut self, values: &Option<[f64; N]>) {
        self.flag(values.is_some());
        if let Some(values) = values { self.f64s(values); }
    }
    fn digest(&self) -> Digest { Digest(self.a, self.b) }
}

// Full includes every current Mesh field. Payload intentionally omits frame,
// plane and instancing metadata: useful as an offline upper-bound grouping,
// never a proposed production memoization key.
fn mesh_hashes(mesh: &crate::Mesh) -> (Digest, Digest, u64) {
    let mut h = HashBits::new(0x4d4553485f7631);
    h.f32s(&mesh.positions);
    h.f32s(&mesh.normals);
    h.u64(mesh.indices.len() as u64);
    for value in &mesh.indices { h.u32(*value); }
    h.f64s(&mesh.origin);
    let payload = h.digest();
    h.flag(mesh.rtc_applied);
    h.flag(mesh.local_bounds.is_some());
    if let Some(bounds) = &mesh.local_bounds { h.f32s(bounds); }
    h.optional_f64s(&mesh.local_to_world);
    h.flag(mesh.welded_in_object_frame);
    h.flag(mesh.plane_tags.is_some());
    if let Some(tags) = &mesh.plane_tags {
        h.u64(tags.len() as u64);
        for tag in tags { h.f64s(&tag.n); h.u64(tag.d.to_bits()); }
    }
    h.flag(mesh.instance_meta.is_some());
    if let Some(meta) = &mesh.instance_meta {
        h.f64s(&meta.transform);
        h.optional_f64s(&meta.local_transform);
        h.optional_f64s(&meta.canonical_transform);
        h.u64(meta.rep_identity as u64);
        h.u64((meta.rep_identity >> 64) as u64);
        h.flag(meta.instanceable);
    }
    (h.digest(), payload, h.bytes)
}

fn mesh_digest(mesh: &crate::Mesh) -> (Digest, u64) {
    let (full, _, bytes) = mesh_hashes(mesh);
    (full, bytes)
}

#[derive(Clone, Copy, Debug, Hash, PartialEq, Eq)]
struct Key { kind: &'static str, precision_bits: u64, full: Digest, payload: Digest }

fn input_key(kind: &'static str, precision: f64, stock: &crate::Mesh, cutters: &[&crate::Mesh]) -> (Key, u64) {
    let mut full = HashBits::new(0x494e5055545f7631);
    full.u64(kind.len() as u64);
    for byte in kind.bytes() { full.feed(u64::from(byte), 1); }
    full.u64(precision.to_bits());
    full.u64(cutters.len() as u64);
    let mut payload = full.clone();
    let mut bytes = 0_u64;
    for mesh in std::iter::once(stock).chain(cutters.iter().copied()) {
        let (f, p, n) = mesh_hashes(mesh);
        full.u64(f.0); full.u64(f.1);
        payload.u64(p.0); payload.u64(p.1);
        bytes = bytes.saturating_add(n);
    }
    (Key { kind, precision_bits: precision.to_bits(), full: full.digest(), payload: payload.digest() }, bytes)
}

#[derive(Clone, Default)]
struct Row {
    calls: u64, accepted: u64, rejected: u64,
    input_bytes: u128, hash_nanos: u128, work_nanos: u128,
    accepted_work_nanos: u128, accepted_work_after_first_nanos: u128,
    output_bytes: u128, outputs: BTreeSet<Digest>, output_variant_overflow: bool,
}

#[derive(Default)]
struct State { rows: HashMap<Key, Row>, calls: u64, accepted: u64, rejected: u64, dropped_calls: u64 }

/// Observe every returned Some/None attempt. Work executes once, outside any
/// census lock. No catch_unwind: panics propagate unchanged and are not rows.
/// Times are wall durations inclusive of nested observe calls, not elapsed wins.
pub fn observe(
    kind: &'static str, precision: f64, stock: &crate::Mesh, cutters: &[&crate::Mesh],
    work: impl FnOnce() -> Option<crate::Mesh>,
) -> Option<crate::Mesh> {
    if !enabled() { return work(); }
    observe_into(true, STATE.get_or_init(|| Mutex::new(State::default())), kind, precision, stock, cutters, work)
}

fn observe_into(
    active: bool, state: &Mutex<State>, kind: &'static str, precision: f64,
    stock: &crate::Mesh, cutters: &[&crate::Mesh], work: impl FnOnce() -> Option<crate::Mesh>,
) -> Option<crate::Mesh> {
    if !active { return work(); }
    let hashing = Instant::now();
    let (key, bytes) = input_key(kind, precision, stock, cutters);
    let mut hash_nanos = hashing.elapsed().as_nanos();
    let working = Instant::now();
    let result = work();
    let work_nanos = working.elapsed().as_nanos();
    let hashing = Instant::now();
    let output = result.as_ref().map(mesh_digest);
    hash_nanos = hash_nanos.saturating_add(hashing.elapsed().as_nanos());
    let mut state = state.lock().unwrap_or_else(|e| e.into_inner());
    state.calls = state.calls.saturating_add(1);
    if output.is_some() { state.accepted = state.accepted.saturating_add(1); }
    else { state.rejected = state.rejected.saturating_add(1); }
    if !state.rows.contains_key(&key) && state.rows.len() >= MAX_KEYS {
        state.dropped_calls = state.dropped_calls.saturating_add(1);
        return result;
    }
    let row = state.rows.entry(key).or_default();
    row.calls = row.calls.saturating_add(1);
    row.input_bytes = row.input_bytes.saturating_add(u128::from(bytes));
    row.hash_nanos = row.hash_nanos.saturating_add(hash_nanos);
    row.work_nanos = row.work_nanos.saturating_add(work_nanos);
    if let Some((digest, output_bytes)) = output {
        if row.accepted > 0 {
            row.accepted_work_after_first_nanos = row.accepted_work_after_first_nanos.saturating_add(work_nanos);
        }
        row.accepted = row.accepted.saturating_add(1);
        row.accepted_work_nanos = row.accepted_work_nanos.saturating_add(work_nanos);
        row.output_bytes = row.output_bytes.saturating_add(u128::from(output_bytes));
        if row.outputs.len() < MAX_OUTPUT_VARIANTS || row.outputs.contains(&digest) { row.outputs.insert(digest); }
        else { row.output_variant_overflow = true; }
    } else { row.rejected = row.rejected.saturating_add(1); }
    result
}

fn json_string(out: &mut impl Write, value: &str) -> std::io::Result<()> {
    write!(out, "\"")?;
    for ch in value.chars() {
        match ch {
            '"' => write!(out, "\\\"")?, '\\' => write!(out, "\\\\")?,
            ch if ch.is_control() => write!(out, "\\u{:04x}", u32::from(ch))?,
            ch => write!(out, "{ch}")?,
        }
    }
    write!(out, "\"")
}

/// Snapshot after workers finish. Does not reset counters. No mesh/source data
/// is written. Rows are deterministic by kind/P/hash; timings remain observed.
pub fn write_report(path: &str) -> std::io::Result<()> {
    let (mut rows, calls, accepted, rejected, dropped) = {
        let state = STATE.get_or_init(|| Mutex::new(State::default())).lock().unwrap_or_else(|e| e.into_inner());
        (state.rows.iter().map(|(key, row)| (*key, row.clone())).collect::<Vec<_>>(),
         state.calls, state.accepted, state.rejected, state.dropped_calls)
    };
    rows.sort_by_key(|(key, _)| (key.kind, key.precision_bits, key.full, key.payload));
    let mut out = BufWriter::new(std::fs::File::create(path)?);
    writeln!(out, "{{\"schemaVersion\":1,\"enabled\":{},\"hashAlgorithm\":\"dual-word-mix-v1\",", enabled())?;
    writeln!(out, "\"diagnosticOnly\":true,\"hashEqualityIsNotProof\":true,\"payloadHashIsProductionKey\":false,")?;
    writeln!(out, "\"workNanosIsInclusiveWallTime\":true,\"nestedRowsAreNotAdditive\":true,\"panicsAreNotRecorded\":true,")?;
    writeln!(out, "\"scope\":\"one process; caller must use one immutable source and fixed policy\",\"acceptedWorkAfterFirstIsReuseUpperBound\":true,")?;
    writeln!(out, "\"byteCounts\":\"mesh field encodings including lengths and tags; not resident memory or transport bytes\",")?;
    writeln!(out, "\"acceptedMeans\":\"work returned Some; later route gates may reject\",\"maxKeys\":{MAX_KEYS},\"maxOutputVariants\":{MAX_OUTPUT_VARIANTS},")?;
    writeln!(out, "\"calls\":{calls},\"accepted\":{accepted},\"rejected\":{rejected},\"droppedCalls\":{dropped},\"rows\":[")?;
    for (index, (key, row)) in rows.iter().enumerate() {
        if index > 0 { writeln!(out, ",")?; }
        write!(out, "{{\"kind\":")?; json_string(&mut out, key.kind)?;
        write!(out, ",\"precisionBits\":\"{:016x}\",\"fullKey\":\"{}\",\"geometryPayloadHash\":\"{}\",", key.precision_bits, key.full, key.payload)?;
        write!(out, "\"calls\":{},\"accepted\":{},\"rejected\":{},\"inputBytes\":{},\"hashNanos\":{},\"workNanos\":{},",
            row.calls, row.accepted, row.rejected, row.input_bytes, row.hash_nanos, row.work_nanos)?;
        write!(out, "\"acceptedWorkNanos\":{},\"acceptedWorkAfterFirstNanos\":{},\"outputBytes\":{},\"outputVariants\":{},\"outputVariantOverflow\":{},\"outputHashes\":[",
            row.accepted_work_nanos, row.accepted_work_after_first_nanos, row.output_bytes, row.outputs.len(), row.output_variant_overflow)?;
        for (index, hash) in row.outputs.iter().enumerate() {
            if index > 0 { write!(out, ",")?; }
            write!(out, "\"{hash}\"")?;
        }
        write!(out, "]}}")?;
    }
    writeln!(out, "\n]}}")?;
    out.flush()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn triangle() -> crate::Mesh {
        let mut m = crate::Mesh::new();
        m.positions = vec![0., 0., 0., 1., 0., 0., 0., 1., 0.];
        m.normals = vec![0., 0., 1., 0., 0., 1., 0., 0., 1.];
        m.indices = vec![0, 1, 2];
        m
    }

    // Nhip load 2026-10-26: no tolerance-rounded or position-only key.
    #[test]
    fn exact_key_distinguishes_normals_topology_origin_precision_and_order() {
        let a = triangle();
        let base = input_key("group", 0.001, &a, &[&a]).0;
        for field in 0..4 {
            let mut b = a.clone();
            match field {
                0 => b.normals[0] = 1.,
                1 => b.indices.swap(1, 2),
                2 => b.origin[0] = 1.,
                _ => b.positions[0] = -0.,
            }
            assert_ne!(base, input_key("group", 0.001, &b, &[&a]).0);
        }
        assert_ne!(base, input_key("group", 0.002, &a, &[&a]).0);
        assert_ne!(base, input_key("single", 0.001, &a, &[&a]).0);
        let mut b = a.clone();
        b.origin[2] = 2.;
        assert_ne!(input_key("group", 0.001, &a, &[&a, &b]).0,
                   input_key("group", 0.001, &a, &[&b, &a]).0);
    }

    #[test]
    fn disabled_path_preserves_option_mesh_and_calls_work_once() {
        let state = Mutex::new(State::default());
        let m = triangle();
        let mut calls = 0;
        let result = observe_into(false, &state, "single", 1., &m, &[], || {
            calls += 1;
            Some(m.clone())
        }).unwrap();
        assert_eq!(calls, 1);
        assert_eq!(result.positions, m.positions);
        assert_eq!(result.normals, m.normals);
        assert_eq!(result.indices, m.indices);
        assert_eq!(result.origin, m.origin);
        assert!(observe_into(false, &state, "single", 1., &m, &[], || None).is_none());
        assert_eq!(state.lock().unwrap().calls, 0);
    }

    #[test]
    fn payload_grouping_does_not_erase_full_frame_metadata() {
        let a = triangle();
        let mut b = a.clone();
        b.rtc_applied = true;
        let (ka, _) = input_key("group", 0.001, &a, &[&a]);
        let (kb, _) = input_key("group", 0.001, &b, &[&a]);
        assert_ne!(ka.full, kb.full);
        assert_eq!(ka.payload, kb.payload);
    }

    #[test]
    fn rejected_attempts_and_distinct_accepted_outputs_are_counted() {
        let state = Mutex::new(State::default());
        let m = triangle();
        assert!(observe_into(true, &state, "single", 1., &m, &[], || None).is_none());
        let mut other = m.clone();
        other.normals[0] = 1.;
        for value in [m.clone(), other] {
            let expected = mesh_digest(&value).0;
            let actual = observe_into(true, &state, "single", 1., &m, &[], || Some(value)).unwrap();
            assert_eq!(mesh_digest(&actual).0, expected);
        }
        let state = state.lock().unwrap();
        let row = state.rows.values().next().unwrap();
        assert_eq!((row.calls, row.accepted, row.rejected), (3, 2, 1));
        assert_eq!(row.outputs.len(), 2);
    }
}
