"""
Addis AR — Modal Serverless GPU Deployment
==========================================
Deploy to cloud GPU with one command:
  modal deploy server/modal_app.py

Features:
- Runs FastAPI AI 3D Generation Server on NVIDIA A10G / T4 GPU
- Automatic scale-to-zero when idle (saves cost)
- Supports TRELLIS, Hunyuan3D-2, and InstantMesh multi-view inference
"""

import modal  # type: ignore

app = modal.App("addis-ar-ai-3d")

image = (
    modal.Image.debian_slim(python_version="3.11")
    .pip_install(
        "fastapi==0.115.8",
        "uvicorn[standard]==0.34.0",
        "numpy==1.26.4",
        "pillow==10.4.0",
        "pydantic==2.10.6",
        "scipy==1.15.1",
        "torch==2.5.1",
        "torchvision==0.20.1",
        "trimesh==4.6.3",
    )
)

@app.function(
    image=image,
    gpu="A10G", # or "T4" for budget tier
    timeout=600,
    scaledown_window=300,
)
@modal.asgi_app()
def fastapi_app():
    from ai_3d_server import app as web_app
    return web_app

