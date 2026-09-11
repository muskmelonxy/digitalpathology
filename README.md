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
2. Coarse zoom levels (overview) are generated first and the slide is marked **viewable**.
3. Remaining high-resolution tiles finish in the background (`pyramid_complete=0` until done).
4. Tiles live at `/tiles/<id>/<level>/<col>_<row>.jpg` (level 0 = lowest res).
5. OpenSeadragon loads the coarsest tiles first, then refines on zoom. Cache-Control is 7 days immutable; URLs include `tiles_version`.

### Architecture
- **Deep Zoom**: Pyramid tiling (256×256 JPEG)
- **TIFF/JPEG/PNG/SVS**: libvips `sharp.tile` (google layout remapped to the existing grid)
- **KFB**: Python `kfb_extract.py` + vendor `.so` (no full-file convert-to-TIFF wait)
- **Share links**: `/s/<token>` — public viewer, optional viewport hash `#x,y,zoom`

## Development Notes

### KFB / KFBIO native path
KFB files are decoded with the KFBIO vendor library that ships in `vendor/lib/libImageOperationLib.so`. That library needs **libjpeg.so.9** (Ubuntu's default is `.so.8`). This repo includes a stripped `vendor/lib/libjpeg.so.9` and the Node process sets `LD_LIBRARY_PATH` automatically.

1. Paths resolve relative to the repo (`vendor/…`). The old hardcoded `/www/digitalpathology/…` path is only a fallback.
2. Upload a `.kfb` / `.kfbio` file. Status polling shows decode progress; the viewer opens after the overview level exists.
3. Optional content-bbox scan (slow, usually unnecessary): `KFB_CROP_CONTENT=1`.
4. Runtime check: `node scripts/check-kfb-runtime.js` or `GET /api/system/kfb` (teacher/admin).
5. If the decoder `.so` will not load: `bash scripts/install-kfb-deps.sh`.

Env overrides: `PFB_PYTHON`, `KFB_DLL`, `KFB_BLANK`, `KFB_LIBJPEG`, `KFB_TIMEOUT_MS` (default 30 min).

### Performance
- Viewer does **not** destroy/recreate OpenSeadragon when the overview JPEG arrives (that used to refetch every tile).
- Missing `/tiles/…` requests return a real 404 (not the SPA HTML), so pan/zoom is not poisoned.
- Parallel tile fetch: `imageLoaderLimit=32`, `immediateRender`, `minPixelRatio=0.5`.
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
- `GET /tiles/:slideId/:level/:col_:row.jpg` - Static tiles (used by the viewer)
- `GET /api/tiles/:slideId/:level/:col/:row.jpg` - Authenticated tile API (legacy)

## License

MIT License
