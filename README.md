# Digital Slide Preview System

数字玻片预览。课程里可以上传、管理切片；也可以把江丰 `.kfb` 和 OpenSlide 支持的 `.svs` / `.tif` 放进 `slides/`，在浏览器里直接全分辨率查看，不必先转换成 SVS 或 TIFF。

## 直接查看 KFB / SVS / TIFF

`.kfb` 由纯 Python 的 [`kfbslide`](https://pypi.org/project/kfbslide/) 读取（OpenSlide 兼容接口）。其他全切片格式走 OpenSlide。两者都交给 `openslide.deepzoom.DeepZoomGenerator` 出瓦片，前端用 OpenSeadragon 显示。

这条路径是新增的直读，不会替换原来的金字塔转换。上传 JPEG、PNG、TIFF 时仍可用 Sharp 预生成瓦片；KFB 也可以改选「转金字塔」，继续走原来的内嵌 JPEG 抽取。

### 安装

需要 Node.js 18+ 和 Python 3.10+。

```bash
python3 -m venv .venv
source .venv/bin/activate          # Windows: .venv\Scripts\activate
pip install -r requirements.txt

npm install
cd client && npm install && cd ..
```

`openslide-bin` 自带 OpenSlide 动态库，一般不用再装系统包。检查：

```bash
python -c "import openslide, kfbslide; print(openslide.__library_version__)"
```

### 切片放哪里

把要直接看的文件放进项目根目录的 [`slides/`](slides/)：

| 格式 | 读取方式 |
| --- | --- |
| `.kfb` `.kfbio` | kfbslide（江丰 KFBIO） |
| `.svs` `.tif` `.tiff` `.ndpi` `.scn` `.vms` `.bif` | OpenSlide |

课程上传的直读切片在 `uploads/slides/`，由服务自动扫描，不用手动拷贝。

### 运行

三个进程一起起（API `:3001`、网页 `:3000`、瓦片 `:5001`）：

```bash
npm run dev
```

也可以分开：

```bash
python -m tile_server          # 或 npm run tiles，只监听 127.0.0.1:5001
npm run server
npm run client
```

浏览器打开 http://localhost:3000 ，用 `teacher` / `teacher123` 登录，进入「示例切片」。登录页本身不显示这组试用账号。

生产环境不要把 Flask 开发服务器暴露到公网。瓦片服务保持在本机，由 Express 校验登录后再转发：

```bash
gunicorn -w 1 --threads 4 -b 127.0.0.1:5001 tile_server.wsgi:app
```

kfbslide 没有官方的线程安全说明，所以只用一个 worker，同一张切片的读取会加锁。

### 隐私

KFB 里的 **label（标签图）可能含有患者信息，服务端不提供这个接口，也不会把它写进元数据**。宏观图（macro）默认不显示，只有在信息面板里勾选「显示宏观图」才会请求。

### 侧栏

「示例切片」列出 `slides/` 里可直接浏览的切片，「课程切片」是课程中上传的切片。地址仍是 `/library`。侧栏底部可在「深色 / 浅色」之间切换，选择写入浏览器 `localStorage`（键 `sidebar-theme`），默认深色。浅色只改侧栏和页面纸色背景，查看器舞台仍是深色。

### 截图

查看器工具栏的「截图」导出当前视野的 OpenSeadragon 画布，不包含浏览器边框和信息面板。可选择是否叠上比例尺，下载 PNG 或 JPEG。文件名包含切片名和当前倍率。KFB（DeepZoom）和 SVS 共用这一按钮。

### 临床信息

示例切片和课程切片都可以附一份教学用临床说明，存在切片旁边的 `文件名.clinical.json`（例如 `slides/case.svs.clinical.json`）。查看器信息面板里「临床信息」在上，「切片信息」默认收起，点标题再展开。登录用户可以阅读；教师和管理员可以编辑并保存。这份内容和 KFB 标签图无关，标签图仍然不会被读取或展示。

字段：病例/标题、性别、年龄、取材部位、临床诊断/印象、病理所见、备注、补充说明。

### 测试

```bash
npm run test:tiles
node --test server/wsi.clinical.test.js
```

测试会下载 OpenSlide 的公开小图 `CMU-1-Small-Region.svs`（没有公开的 `.kfb` 样本）。KFB 分支用假的 kfbslide 对象检查分派、DeepZoom 瓦片，以及标签图不会被读取。临床信息测试覆盖 sidecar 读写；Express 测试确认学生不能保存、教师的 JSON 会转发到瓦片服务。

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

- **Backend**: Node.js, Express, SQLite, plus a Python tile service (Flask, kfbslide, OpenSlide)
- **Frontend**: React, Tailwind CSS, OpenSeadragon
- **Image Processing**: On-demand DeepZoom for KFB/SVS, Sharp for pre-generated pyramid tiles

## Quick Start

### Prerequisites
- Node.js 18+
- Python 3.10+（直读 KFB / SVS 时需要，见上面的安装）

### Installation

Node 依赖见上一节。只跑原来的课程网站时：

```bash
npm install
cd client && npm install && cd ..
npm run dev
```

这会启动：
- Express API http://localhost:3001
- React http://localhost:3000
- Python 瓦片服务 http://127.0.0.1:5001

### Default Login

- **Teacher**: `teacher` / `teacher123`
- Students can register via the registration page

## Project Structure

```
DigitalSlideSystem/
├── tile_server/          # Python DeepZoom tiles (kfbslide + OpenSlide)
├── slides/               # Drop .kfb / .svs / .tif here for direct viewing
├── server/               # Express backend
│   ├── index.js         # Main server entry
│   ├── database.js      # SQLite database setup
│   ├── middleware/      # Auth middleware
│   └── routes/          # API routes
│       ├── auth.js      # Authentication
│       ├── slides.js    # Slide management
│       ├── courses.js   # Course management
│       ├── upload.js    # File upload & processing
│       ├── tiles.js     # Pre-generated pyramid tiles
│       └── wsi.js       # Auth proxy to the Python tile service
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
| TIFF | .tiff, .tif | Multi-resolution support |
| JPEG | .jpg, .jpeg | Standard format |
| PNG | .png | Lossless format |
| KFBIO | .kfb, .kfbio | Direct view via kfbslide, or the existing JPEG-extract pyramid |
| Aperio SVS 等 | .svs, .ndpi, .scn, .bif, .vms | OpenSlide direct view |

## How It Works

### Slide Processing
1. User uploads a slide file
2. Backend validates and stores the file
3. Sharp library processes the image into a pyramid structure
4. Tiles are generated at multiple zoom levels (256x256px)
5. OpenSeadragon serves tiles on-demand for smooth viewing

### Architecture
- **Deep Zoom**: Uses pyramid tiling for efficient viewing of large images
- **Tile Size**: Default 256x256 pixels
- **Authentication**: JWT-based with role-based access control
- **Storage**: File-based with SQLite for metadata

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
- `GET /api/upload/status/:id` - Check processing status

### Tiles
- `GET /api/tiles/:slideId/:level/:col/:row.jpg` - Pre-generated pyramid tile

### Direct DeepZoom (proxied to the Python service, login required)
- `GET /api/wsi/slides?root=library` - Slides dropped in `slides/`
- `GET /api/wsi/r/:root/:filename/meta` - Dimensions, MPP, objective, levels
- `GET /api/wsi/r/:root/:filename/thumbnail.jpg`
- `GET /api/wsi/r/:root/:filename.dzi`
- `GET /api/wsi/r/:root/:filename_files/:level/:col_:row.jpeg`
- `GET /api/wsi/r/:root/:filename/macro.jpg?explicit=1` - Macro only, and only when asked
- `GET /api/wsi/r/:root/:filename/clinical` - Clinical notes (any logged-in user)
- `PUT /api/wsi/r/:root/:filename/clinical` - Replace clinical notes (teacher/admin)

`:root` is `library` (the `slides/` folder) or `uploads` (files uploaded for direct view). Label images are not served.

## Development Notes

### KFBIO Format Support

Two ways to open a KFBIO slide:

1. **Direct view (recommended).** `kfbslide` reads the pyramid and the tile service streams DeepZoom JPEG. Put the file in `slides/`, or upload it and leave the mode on「直读 Direct」. This is the path that keeps the original resolution, magnification, and microns-per-pixel.
2. **Pyramid conversion (existing).** Upload and choose「转金字塔 Convert」. The server still scans the file for an embedded JPEG, then Sharp builds 256 px tiles. The original file stays in `uploads/slides/`. Use this when `kfbslide` cannot open a newer KFB version, or when you want a static tile set.

Limitations:

- `kfbslide` has been checked against KFB v1.6. Newer or damaged files fail with a clear error; fall back to conversion or to KFBIO's official converter.
- Very large conversions (>2GB) still take a while. Direct view does not pre-build the pyramid.
- Empty high-resolution regions can be pure black. That is empty glass, not a failed tile.
- The label associated image is never exported.

### Performance Considerations
- Large files (>1GB) are processed in the background
- Tile generation is memory-efficient (batch processing)
- React Query caches slide data for smooth navigation

### Security
- JWT authentication required for all API endpoints
- Role-based access control (student/teacher/admin)
- File upload size limit: 5GB
- File type validation on upload

## Production Deployment

1. Set environment variables:
```bash
NODE_ENV=production
JWT_SECRET=your-secret-key
PORT=3001
```

2. Build the client:
```bash
cd client && npm run build
```

3. Start the server:
```bash
npm start
```

## License

MIT License
