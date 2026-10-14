# Addis AR

Free, browser-based WebAR creation platform and 3D Object Scanner.

## Features

- **3D Object Scanner**: Camera photogrammetry with 360° guided orbit, real-time background segmentation, keypoint tracking, sparse point cloud triangulation, and watertight manifold GLB reconstruction.
- **WebAR Studio**: Full-screen AR camera workspace with marker detection, surface plane tracking, and 3D object placement.
- **Scene Editor**: Client-only 3D scene authoring powered by React Three Fiber with IndexedDB persistence.
- **Export & Share**: Direct GLB export, OBJ export, texture atlas download, and dataset export.

## Development

```sh
npm install
npm run dev
```

### Tests & Build

```sh
npm test          # Run test suite with Vitest
npx tsc --noEmit  # TypeScript type-checking
npm run build     # Production bundle build
```
