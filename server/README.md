# Addis AR — Self-Hosted Photogrammetry Backend

This directory contains the optional, open-source Python + FastAPI photogrammetry server for **Addis AR's 3D Object Scanner**.

> [!NOTE]
> Addis AR already includes an **in-browser 3D reconstruction engine** that runs 100% locally on your phone or desktop without installing any server or paid API keys.
> This self-hosted server is provided for heavy workloads, high-poly Structure-from-Motion (SfM), and GPU acceleration using **COLMAP** and **Open3D**.

## Features
- **100% Free & Open-Source**: Uses COLMAP, Open3D, and FastAPI.
- **No Cloud Fees or Subscriptions**: Run on your local computer, home lab, or private server.
- **Automatic Multi-View Stereo**: Computes camera poses, point clouds, Poisson surface meshing, and glTF/GLB export.
- **Privacy-First**: Your photos never leave your private network.

## Quick Start (Local Python)

### 1. Prerequisites
- Python 3.10+
- [COLMAP](https://colmap.github.io/install.html) installed on your system PATH (`colmap` command available).

### 2. Install Python Dependencies
```bash
cd server
pip install -r requirements.txt
```

### 3. Run the Server
```bash
python photogrammetry_server.py
```
The server will start at `http://localhost:8000`.

### 4. Connect Addis AR
In the Addis AR 3D Scanner UI, click **Reconstruction Settings** and select **Self-Hosted COLMAP Engine**, pointing to `http://localhost:8000`.
