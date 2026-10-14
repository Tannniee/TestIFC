// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.
use super::*;

fn repeated_fixture() -> Vec<u8> {
    let path = Path::new(env!("CARGO_MANIFEST_DIR")).join("../../apps/viewer/public/samples/building-architecture.ifc");
    let source = std::fs::read_to_string(path).unwrap();
    let begin = source.find("DATA;").unwrap() + 5;
    let end = source.rfind("ENDSEC;").unwrap();
    let mut output = source[..begin].to_string();
    // Geometry fixture repeated with disjoint STEP ids. This is a queue/lifetime
    // stress fixture, not an authoring-tool or geometry-quality oracle.
    for copy in 0..256 {
        let mut chars = source[begin..end].chars().peekable();
        while let Some(c) = chars.next() {
            output.push(c);
            if c == '#' {
                let mut digits = String::new();
                while chars.peek().is_some_and(|c| c.is_ascii_digit()) { digits.push(chars.next().unwrap()); }
                if !digits.is_empty() { output.push_str(&(digits.parse::<u32>().unwrap() + copy * 10_000).to_string()); }
            }
        }
    }
    output.push_str(&source[end..]);
    output.into_bytes()
}

#[test]
fn abandoned_bounded_stream_cancels_worker_and_deletes_its_owned_source() {
    let jobs = Jobs::default();
    let id = jobs.create().unwrap();
    assert_eq!(jobs.status(&id).unwrap().progress.total_elements, 0);
    let source = repeated_fixture();
    for chunk in source.chunks(INPUT_CHUNK_BYTES) { jobs.append(&id, chunk).unwrap(); }
    let job = jobs.get(&id).unwrap();
    let path = job.source.lock().unwrap().path().to_owned();
    let weak = Arc::downgrade(&job);
    drop(job);
    jobs.start(&id).unwrap();
    let deadline = std::time::Instant::now() + Duration::from_secs(30);
    // Wait for real meshing to reach the receiver, then stop pulling. With at
    // enough geometry packets, the worker cannot finish past a two-packet channel.
    loop {
        assert!(std::time::Instant::now() < deadline);
        if !jobs.next_packet(&id).unwrap().is_empty() { break; }
        std::thread::sleep(Duration::from_millis(5));
    }
    std::thread::sleep(Duration::from_millis(100));
    let status = jobs.status(&id).unwrap();
    assert!(!status.done, "producer must wait for a consumer");
    assert!(status.progress.processed_elements > 0);
    assert!(status.progress.processed_elements <= status.progress.total_elements);
    assert!(status.progress.meshes > 0);
    jobs.close(&id).unwrap();
    // The final Arc decrements its strong count before dropping Job's fields.
    // Wait for the actual NamedTempFile cleanup as well as worker release.
    while weak.upgrade().is_some() || path.exists() {
        assert!(std::time::Instant::now() < deadline, "cancel must release worker and source");
        std::thread::sleep(Duration::from_millis(5));
    }
    assert!(!path.exists(), "only the owned temporary snapshot is deleted");
}

#[test]
fn isolated_jobs_do_not_share_source_or_lifetime() {
    let jobs = Jobs::default();
    let a = jobs.create().unwrap();
    let b = jobs.create().unwrap();
    jobs.append(&a, b"source-a").unwrap();
    jobs.append(&b, b"source-b").unwrap();
    jobs.close(&a).unwrap();
    assert!(jobs.source_bytes(&a).is_err());
    assert_eq!(jobs.source_bytes(&b).unwrap(), b"source-b");
    jobs.close(&b).unwrap();
}

#[test]
fn closing_a_job_removes_its_semantic_stream_and_cannot_republish_it() {
    let jobs = Jobs::default();
    let id = jobs.create().unwrap();
    let job = jobs.get(&id).unwrap();
    let stream = || crate::semantic::SemanticStream::encode(|writer|
        crate::semantic::record(writer, "complete", &true, &AtomicBool::new(false))).unwrap();
    job.set_semantics(stream()).unwrap();
    assert!(!job.next_semantic_packet().unwrap().is_empty());
    jobs.close(&id).unwrap();
    assert!(job.next_semantic_packet().is_err());
    assert!(job.set_semantics(stream()).is_err(), "a cancelled extraction cannot revive the job");
}
