# Digital Slide Preview System

An educational web application for viewing and managing digital pathology slides. Supports TIFF, JPEG, PNG, and KFBIO formats with deep zoom capabilities.

## Features

### For Students
- View high-resolution digital slides with deep zoom
- Pan and navigate slide images smoothly
- Access slides organized by course
- Responsive design for various screen sizes

### For Teachers/Admins
- Upload slides (TIFF, JPEG, PNG, KFBIO formats)
- Create and manage courses
- Enroll students in courses
- Organize slides by course
- Monitor upload and processing status

## Tech Stack

- **Backend**: Node.js, Express, SQLite
- **Frontend**: React, Tailwind CSS, OpenSeadragon
- **Image Processing**: Sharp (for pyramid tile generation)

## Quick Start

### Prerequisites
- Node.js 18+ installed

### Installation

1. Install root dependencies:
```bash
npm install
```

2. Install client dependencies:
```bash
cd client && npm install && cd ..
```

3. Start the development server:
```bash
npm run dev
```

This will start:
- Backend server on http://localhost:3001
- React frontend on http://localhost:3000

### Default Login

- **Teacher**: `teacher` / `teacher123`
- Students can register via the registration page

## Project Structure

```
DigitalSlideSystem/
├── server/               # Express backend
│   ├── index.js         # Main server entry
│   ├── database.js      # SQLite database setup
│   ├── middleware/      # Auth middleware
│   └── routes/          # API routes
│       ├── auth.js      # Authentication
│       ├── slides.js    # Slide management
│       ├── courses.js   # Course management
│       ├── upload.js    # File upload & processing
│       └── tiles.js     # Tile serving
├── client/              # React frontend
│   ├── src/
│   │   ├── pages/       # Page components
│   │   ├── components/  # Reusable components
│   │   └── contexts/    # React contexts
│   └── public/
├── uploads/             # Uploaded files & generated tiles
│   ├── slides/          # Original uploaded files
│   ├── tiles/           # Generated pyramid tiles
│   └── thumbnails/      # Slide thumbnails
└── data/                # SQLite database
```

## Supported File Formats

| Format | Extension | Notes |
|--------|-----------|-------|
| TIFF | .tiff, .tif | Multi-page: largest page used as true WSI (not a ~4000px overview) |
| JPEG | .jpg, .jpeg | Standard format |
| PNG | .png | Lossless format |
| SVS | .svs | Aperio TIFF; Sharp/libvips native pyramid |
| KFB / KFBIO | .kfb, .kfbio | Native vendor decoder (`libImageOperationLib.so`) → same tile pyramid |

## How It Works

### Slide Processing
1. User uploads a slide (HTTP returns immediately with `status=processing`).
2. A **useful preview** is built first: low-res overview/macro JPEG, thumbnail, and (for KFB) the slide **label** image. Coarsest 256px tiles are written so the home view is instant.
3. The slide is marked **ready** (`pyramid_complete=1`). Remaining zoom levels are **not** pre-rendered. OpenSeadragon requests only the visible 256 JPEG tiles; the server generates missing `{level}/{col}_{row}.jpg` files on demand and caches them (`Cache-Control: public, max-age=604800, immutable`).
4. KFB never waits on a full-file convert. A persistent Python worker keeps the vendor decoder open and answers tile requests (same 256-grid as the rest of the app). Optional `SLIDE_PREBUILD_PYRAMID=1` restores the old full-pyramid background build.
5. Tiles live at `/tiles/<id>/<level>/<col>_<row>.jpg` (level 0 = lowest res). URLs include `tiles_version`. Missing tiles are a real 404 until generated (never the SPA HTML).

### Architecture
- **Deep Zoom**: On-demand 256×256 JPEG pyramid (overview-first)
- **TIFF/JPEG/PNG/SVS**: Sharp extract from the best matching pyramid page
- **KFB**: Python `kfb_extract.py --preview` / `--serve` + vendor `.so` (no full-file convert-to-TIFF wait)
- **Navigator**: static overview JPEG + red viewport rectangle (OSD's built-in navigator is off so it does not fetch extra tiles)
- **Share links**: `/s/<token>` — public viewer, optional viewport hash `#x,y,zoom`

## Development Notes

### KFB / KFBIO native path
KFB files are decoded with the KFBIO vendor library that ships in `vendor/lib/libImageOperationLib.so`. That library needs **libjpeg.so.9** (Ubuntu's default is `.so.8`). This repo includes a stripped `vendor/lib/libjpeg.so.9` and the Node process sets `LD_LIBRARY_PATH` automatically.

1. Paths resolve relative to the repo (`vendor/…`). The old hardcoded `/www/digitalpathology/…` path is only a fallback.
2. Upload a `.kfb` / `.kfbio` file. Preview (overview + label) is ready without decoding every zoom level; pan/zoom fetches 256px JPEGs on demand.
3. Optional content-bbox scan (slow, usually unnecessary): `KFB_CROP_CONTENT=1`.
4. Runtime check: `node scripts/check-kfb-runtime.js` or `GET /api/system/kfb` (teacher/admin).
5. If the decoder `.so` will not load: `bash scripts/install-kfb-deps.sh`.
6. To restore full pre-build (old behaviour): `SLIDE_PREBUILD_PYRAMID=1`.

Env overrides: `PFB_PYTHON`, `KFB_DLL`, `KFB_BLANK`, `KFB_LIBJPEG`, `KFB_TIMEOUT_MS` (full prebuild, default 30 min), `KFB_PREVIEW_TIMEOUT_MS` (default 2 min), `KFB_WORKERS` (concurrent open KFB files, default 3), `SLIDE_PREBUILD_PYRAMID`.

### Performance
- Overview JPEG paints immediately (CSS placeholder); OpenSeadragon is **not** destroyed when it arrives.
- Only **visible** 256 JPEG tiles at the current pyramid level are fetched, in parallel (`imageLoaderLimit=32`, `immediateRender`, `minPixelRatio=0.5`).
- Missing `/tiles/…` requests return a real 404 (not the SPA HTML). Successful tiles are cached 7 days.
- Custom overview map with a red viewport rectangle; wheel zoom + drag pan; scale bar in mm or µm.
- Check scripts: `npm run test:viewer`

### Security
- JWT authentication required for API endpoints
- Role-based access control (student/teacher/admin)
- File upload size limit: 5GB
- File type validation on upload
- Public share links still serve tiles over the static `/tiles/:id/…` path (same as before)

## Production Deployment

Production on the VPS is systemd unit `digitalpathology`, port **3001**.

1. Pull the branch, install, build:
```bash
cd /www/digitalpathology   # or the app root
git pull
npm install
cd client && npm install && npm run build && cd ..
# first-time KFB deps (if vendor/lib/libjpeg.so.9 is missing):
bash scripts/install-kfb-deps.sh
```

2. Environment (systemd `Environment=` or a file sourced by the unit). See `.env.example`.
```bash
NODE_ENV=production
JWT_SECRET=your-secret-key
PORT=3001
```

3. Restart:
```bash
sudo systemctl restart digitalpathology
sudo systemctl status digitalpathology --no-pager
journalctl -u digitalpathology -n 80 --no-pager
```
Confirm the log line `[kfb] runtime ok` (or fix the printed problems).

4. Optional nginx in front: proxy `/` and `/api` to `127.0.0.1:3001`, raise `client_max_body_size` to 5g, and let `/tiles/` cache. HTTP/2 on nginx helps parallel tile fetch.

Example systemd unit (`/etc/systemd/system/digitalpathology.service`):
```
[Unit]
Description=Digital Pathology slide viewer
After=network.target

[Service]
Type=simple
WorkingDirectory=/www/digitalpathology
Environment=NODE_ENV=production
Environment=PORT=3001
Environment=JWT_SECRET=your-secret-key
ExecStart=/usr/bin/node server/index.js
Restart=on-failure
RestartSec=5

[Install]
WantedBy=multi-user.target
```

Do not Docker-ize unless you want to; the vendor `.so` is Linux x86_64 and expects Ubuntu-like glibc + libjpeg.so.9 via `LD_LIBRARY_PATH`.

## API Endpoints

### Authentication
- `POST /api/auth/login` - Login
- `POST /api/auth/register` - Register as student
- `POST /api/auth/create-user` - Create user (teacher/admin)
- `GET /api/auth/me` - Get current user
- `GET /api/auth/students` - List all students

### Slides
- `GET /api/slides` - List slides
- `GET /api/slides/:id` - Get slide details
- `GET /api/slides/:id/info` - Get slide dimensions & tile info
- `PUT /api/slides/:id` - Update slide
- `DELETE /api/slides/:id` - Delete slide

### Courses
- `GET /api/courses` - List courses
- `GET /api/courses/:id` - Get course details
- `POST /api/courses` - Create course
- `PUT /api/courses/:id` - Update course
- `DELETE /api/courses/:id` - Delete course
- `POST /api/courses/:id/enroll` - Enroll students
- `DELETE /api/courses/:id/enroll/:studentId` - Remove student

### Upload
- `POST /api/upload` - Upload slide file
- `GET /api/upload/status/:id` - Check processing status (includes progress % / message)

### Share
- `POST /api/share/:id` - Enable share link
- `GET /api/share/:id` - Share status
- `DELETE /api/share/:id` - Disable share
- `GET /api/share/public/:token` - Public viewer metadata (no auth)

### System
- `GET /api/system/kfb` - KFB decoder runtime check (teacher/admin)

### Tiles
- `GET /tiles/:slideId/:level/:col_:row.jpg` - On-demand 256 JPEG tiles (cached after first generate)
- `GET /uploads/labels/:id.jpg` / `/uploads/macros/:id.jpg` - KFB associated images when present
- `GET /api/tiles/:slideId/:level/:col/:row.jpg` - Authenticated tile API (legacy)

## License

MIT License
