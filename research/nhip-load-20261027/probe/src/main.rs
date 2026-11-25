//! Research-only cold-load attribution using the exact desktop producer and
//! optional production packet partition. No GUI, source mutation or cache.
use ifc_lite_processing::{process_geometry_streaming_filtered_with_baked_basis,OpeningFilterMode,StreamingOptions};
use std::{sync::OnceLock,time::Instant};
use sha2::{Digest,Sha256};
#[allow(dead_code)] // Harness exercises only the production partition encoder.
#[path="F:/Steel/VBA/IFC-Lite-Core104/desktop/src-tauri/src/packet.rs"] mod packet;
#[allow(dead_code)]
#[path="F:/Steel/VBA/IFC-Lite-Core104/desktop/src-tauri/src/packet_batches.rs"] mod packet_batches;
#[allow(dead_code)]
#[path="F:/Steel/VBA/IFC-Lite-Core104/apps/server/src/services/axis.rs"] mod axis;
#[allow(dead_code)]
#[path="F:/Steel/VBA/IFC-Lite-Core104/desktop/src-tauri/src/partition.rs"] mod partition;

fn main(){
 let args:Vec<_>=std::env::args().collect();
 let mode=args.get(3).map(String::as_str).unwrap_or("mesh-only");
 assert!(matches!(mode,"mesh-only"|"packet"));
 let opened=Instant::now();let source=std::fs::read(&args[1]).unwrap();let read_seconds=opened.elapsed().as_secs_f64();
 let start=Instant::now();let basis=OnceLock::new();
 let source_sha256=format!("{:x}",Sha256::digest(&source));
 let mut mesh_hash=Sha256::new();let mut packet_hash=Sha256::new();let mut color_hash=Sha256::new();
 let mut bounds=[f64::INFINITY,f64::INFINITY,f64::INFINITY,f64::NEG_INFINITY,f64::NEG_INFINITY,f64::NEG_INFINITY];
 let(mut meshes_total,mut triangles,mut vertices,mut instance_tagged)=(0_usize,0_usize,0_usize,0_usize);
 let(mut flat,mut instances,mut templates,mut packets,mut packet_bytes)=(0_usize,0_usize,0_usize,0_usize,0_usize);
 let mut callback_seconds=0.;let mut first_mesh_seconds=None;let mut batches=Vec::new();let mut failure=None;
 let result=process_geometry_streaming_filtered_with_baked_basis(&source,OpeningFilterMode::Default,StreamingOptions{
  initial_batch_size:16,throughput_batch_size:4096,retain_emitted_meshes:false,..StreamingOptions::default()
 },&basis,|meshes,processed,total|{
  let at=start.elapsed().as_secs_f64();let part_start=Instant::now();
  if first_mesh_seconds.is_none()&&!meshes.is_empty(){first_mesh_seconds=Some(at);}
  meshes_total+=meshes.len();vertices+=meshes.iter().map(|m|m.positions.len()/3).sum::<usize>();
  triangles+=meshes.iter().map(|m|m.indices.len()/3).sum::<usize>();
  instance_tagged+=meshes.iter().filter(|m|m.instance.is_some()).count();
  for m in meshes {
   mesh_hash.update(m.express_id.to_le_bytes());mesh_hash.update([m.geometry_class]);
   mesh_hash.update((m.positions.len() as u64).to_le_bytes());mesh_hash.update(bytemuck::cast_slice::<f32,u8>(&m.positions));
   mesh_hash.update((m.normals.len() as u64).to_le_bytes());mesh_hash.update(bytemuck::cast_slice::<f32,u8>(&m.normals));
   mesh_hash.update((m.indices.len() as u64).to_le_bytes());mesh_hash.update(bytemuck::cast_slice::<u32,u8>(&m.indices));
   mesh_hash.update(bytemuck::cast_slice::<f64,u8>(&m.origin));mesh_hash.update(bytemuck::cast_slice::<f32,u8>(&m.color));
  }
  if mode=="packet"{
   match partition::encode(meshes,basis.get().expect("published canonical basis"),&mut bounds){
    Ok(part)=>{flat+=part.flat_meshes;instances+=part.occurrences;templates+=part.templates;
     packets+=part.packets.len();packet_bytes+=part.packets.iter().map(Vec::len).sum::<usize>();
     for packet in part.packets {packet_hash.update((packet.len() as u64).to_le_bytes());packet_hash.update(&packet);}},
    Err(error)=>failure=Some(error),
   }
  }
  let seconds=part_start.elapsed().as_secs_f64();callback_seconds+=seconds;
  batches.push(serde_json::json!({"processed":processed,"total":total,"meshes":meshes.len(),"atSeconds":at,"callbackSeconds":seconds}));
  eprintln!("{}",serde_json::json!({"processed":processed,"total":total,"atSeconds":at,"callbackSeconds":seconds}));
 },|updates|{for (id,color) in updates {color_hash.update(id.to_le_bytes());color_hash.update(bytemuck::cast_slice::<f32,u8>(color));}},|_|{});
 let seconds=start.elapsed().as_secs_f64();
 let report=serde_json::json!({"source":args[1],"sourceSha256":source_sha256,"mode":mode,"sourceBytes":source.len(),"fileReadSeconds":read_seconds,
  "orderedMeshSha256":format!("{:x}",mesh_hash.finalize()),"orderedPacketSha256":format!("{:x}",packet_hash.finalize()),"colorUpdatesSha256":format!("{:x}",color_hash.finalize()),
  "pipelineSeconds":seconds,"callbackSeconds":callback_seconds,"firstMeshSeconds":first_mesh_seconds,
  "meshes":meshes_total,"vertices":vertices,"triangles":triangles,"instanceTaggedMeshes":instance_tagged,
  "flatMeshes":flat,"instances":instances,"templates":templates,"packets":packets,"packetBytes":packet_bytes,
  "failure":failure,"stats":result.stats,"batches":batches,
  "scope":"Fresh-process canonical native worker-pool stream; excludes GUI, semantic extraction and transport waits. OS file cache uncontrolled; diagnostic attribution, not an interleaved performance claim."});
 serde_json::to_writer_pretty(std::fs::File::create(&args[2]).unwrap(),&report).unwrap();
 println!("{}",serde_json::json!({"mode":mode,"pipelineSeconds":seconds,"callbackSeconds":callback_seconds,"meshes":meshes_total,"triangles":triangles}));
 assert!(failure.is_none());
}
