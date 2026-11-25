fn main() {
    if let Some(path) = std::env::args().nth(1) {
        let bytes = std::fs::read(path).unwrap();
        let json = serde_json::to_vec(&ifc_lite_processing::extract_symbolic_data(&bytes)).unwrap();
        std::io::Write::write_all(&mut std::io::stdout(), &json).unwrap();
    } else {
        println!("{}", ifc_lite_processing::determinism::compute_mesh_manifest().to_json());
    }
}
