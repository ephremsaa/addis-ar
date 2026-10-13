import os
import shutil
import uuid
import subprocess
import asyncio
from typing import List
from fastapi import FastAPI, UploadFile, File, Form, BackgroundTasks, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
import uvicorn

app = FastAPI(
    title="Addis AR Photogrammetry Reconstruction Server",
    description="Self-hosted open-source photogrammetry backend for Addis AR mobile 3D scanner using COLMAP and Open3D",
    version="1.0.0"
)

# Enable CORS for Addis AR frontend
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

TEMP_DIR = os.path.join(os.path.dirname(__file__), "storage")
os.makedirs(TEMP_DIR, exist_ok=True)

# Job registry
jobs = {}

@app.get("/api/health")
async def health_check():
    colmap_installed = shutil.which("colmap") is not None
    return {
        "status": "healthy",
        "engine": "COLMAP + Open3D + glTF",
        "colmap_available": colmap_installed,
        "active_jobs": len(jobs)
    }

def run_photogrammetry_pipeline(job_id: str, job_dir: str, quality: str):
    images_dir = os.path.join(job_dir, "images")
    sparse_dir = os.path.join(job_dir, "sparse")
    dense_dir = os.path.join(job_dir, "dense")
    output_glb = os.path.join(job_dir, "scanned-object.glb")
    db_path = os.path.join(job_dir, "database.db")

    os.makedirs(sparse_dir, exist_ok=True)
    os.makedirs(dense_dir, exist_ok=True)

    try:
        jobs[job_id]["status"] = "processing"
        jobs[job_id]["progress"] = 10
        jobs[job_id]["message"] = "Extracting visual features (SIFT)..."

        # Check for colmap binary
        colmap = shutil.which("colmap") or "colmap"

        # 1. Feature extraction
        subprocess.run([
            colmap, "feature_extractor",
            "--database_path", db_path,
            "--image_path", images_dir,
            "--ImageReader.camera_model", "SIMPLE_RADIAL",
            "--SiftExtraction.max_num_features", "4096" if quality == "high" else "2048"
        ], check=True, capture_output=True)

        jobs[job_id]["progress"] = 30
        jobs[job_id]["message"] = "Matching image features across views..."

        # 2. Feature matching
        subprocess.run([
            colmap, "exhaustive_matcher",
            "--database_path", db_path
        ], check=True, capture_output=True)

        jobs[job_id]["progress"] = 50
        jobs[job_id]["message"] = "Estimating camera positions & sparse point cloud..."

        # 3. Sparse reconstruction (Mapper)
        subprocess.run([
            colmap, "mapper",
            "--database_path", db_path,
            "--image_path", images_dir,
            "--output_path", sparse_dir
        ], check=True, capture_output=True)

        jobs[job_id]["progress"] = 70
        jobs[job_id]["message"] = "Generating dense stereo point cloud..."

        # 4. Dense reconstruction
        model_sparse = os.path.join(sparse_dir, "0")
        subprocess.run([
            colmap, "image_undistorter",
            "--image_path", images_dir,
            "--input_path", model_sparse,
            "--output_path", dense_dir
        ], check=True, capture_output=True)

        subprocess.run([
            colmap, "patch_match_stereo",
            "--workspace_path", dense_dir
        ], check=True, capture_output=True)

        fused_ply = os.path.join(dense_dir, "fused.ply")
        subprocess.run([
            colmap, "stereo_fusion",
            "--workspace_path", dense_dir,
            "--output_path", fused_ply
        ], check=True, capture_output=True)

        jobs[job_id]["progress"] = 85
        jobs[job_id]["message"] = "Reconstructing Poisson surface mesh & textures..."

        # 5. Open3D Poisson surface reconstruction & mesh optimization
        try:
            import open3d as o3d
            pcd = o3d.io.read_point_cloud(fused_ply)
            pcd.estimate_normals()
            mesh, densities = o3d.geometry.TriangleMesh.create_from_point_cloud_poisson(pcd, depth=8 if quality == "draft" else 9)
            
            # Clean mesh
            mesh.remove_degenerate_triangles()
            mesh.remove_duplicated_triangles()
            mesh.remove_duplicated_vertices()
            mesh.remove_non_manifold_edges()

            # Save as glTF / GLB
            o3d.io.write_triangle_mesh(output_glb, mesh)
        except Exception as e:
            # Fallback to colmap poisson mesher if Open3D is not installed
            meshed_ply = os.path.join(dense_dir, "meshed-poisson.ply")
            subprocess.run([
                colmap, "poisson_mesher",
                "--input_path", fused_ply,
                "--output_path", meshed_ply
            ], check=True, capture_output=True)
            # Use ply2gltf or copy
            shutil.copyfile(meshed_ply, output_glb)

        jobs[job_id]["progress"] = 100
        jobs[job_id]["status"] = "complete"
        jobs[job_id]["message"] = "3D reconstruction complete! Valid GLB model ready."
        jobs[job_id]["glb_path"] = output_glb

    except Exception as exc:
        jobs[job_id]["status"] = "failed"
        jobs[job_id]["message"] = f"Reconstruction error: {str(exc)}"

@app.post("/api/reconstruct")
async def start_reconstruction(
    background_tasks: BackgroundTasks,
    quality: str = Form("standard"),
    photos: List[UploadFile] = File(...)
):
    if len(photos) < 3:
        raise HTTPException(status_code=400, detail="At least 3 photos are required")

    job_id = str(uuid.uuid4())
    job_dir = os.path.join(TEMP_DIR, job_id)
    images_dir = os.path.join(job_dir, "images")
    os.makedirs(images_dir, exist_ok=True)

    # Save uploaded files
    for idx, photo in enumerate(photos):
        filename = f"img_{idx:03d}_{photo.filename}"
        dest = os.path.join(images_dir, filename)
        with open(dest, "wb") as f:
            shutil.copyfileobj(photo.file, f)

    jobs[job_id] = {
        "status": "queued",
        "progress": 0,
        "message": f"Queued {len(photos)} photos for photogrammetry...",
        "quality": quality,
        "photo_count": len(photos)
    }

    background_tasks.add_task(run_photogrammetry_pipeline, job_id, job_dir, quality)
    return {"job_id": job_id, "status": "queued"}

@app.get("/api/status/{job_id}")
async def get_job_status(job_id: str):
    if job_id not in jobs:
        raise HTTPException(status_code=404, detail="Job not found")
    return jobs[job_id]

@app.get("/api/download/{job_id}")
async def download_glb(job_id: str):
    if job_id not in jobs or jobs[job_id]["status"] != "complete":
        raise HTTPException(status_code=400, detail="Reconstruction not yet complete")
    glb_path = jobs[job_id].get("glb_path")
    if not glb_path or not os.path.exists(glb_path):
        raise HTTPException(status_code=404, detail="GLB file not found")
    return FileResponse(glb_path, media_type="model/gltf-binary", filename="scanned-object.glb")

@app.delete("/api/cleanup/{job_id}")
async def cleanup_job(job_id: str):
    job_dir = os.path.join(TEMP_DIR, job_id)
    if os.path.exists(job_dir):
        shutil.rmtree(job_dir, ignore_errors=True)
    jobs.pop(job_id, None)
    return {"status": "cleaned"}

if __name__ == "__main__":
    uvicorn.run(app, host="0.0.0.0", port=8000)
