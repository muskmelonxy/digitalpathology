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
| TIFF | .tiff, .tif | Multi-resolution support |
| JPEG | .jpg, .jpeg | Standard format |
| PNG | .png | Lossless format |
| KFBIO | .kfb, .kfbio | KFBIO scanner format - extracts embedded JPEG |

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
- `GET /api/tiles/:slideId/:level/:col/:row.jpg` - Get tile image

## Development Notes

### KFBIO Format Support
KFBIO files from KFBIO scanners are now supported through automatic JPEG extraction:

1. **How it works:**
   - The system scans KFBIO files for embedded JPEG image data
   - Extracts the largest JPEG found (typically the full-resolution image)
   - Converts it to the standard pyramid tile format
   - Original KFBIO file is preserved in `/uploads/slides/`

2. **Requirements:**
   - KFBIO files must contain valid JPEG data
   - If extraction fails, the slide status will show "error"

3. **Limitations:**
   - Very large KFBIO files (>2GB) may take longer to process
   - Some proprietary KFBIO formats may not be readable
   - If automatic extraction fails, convert to TIFF using KFBIO's official software first

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
