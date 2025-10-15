# YOLO Annotation Tool

A lightweight web app for creating object detection datasets in native YOLO format, built with Flask (backend) and vanilla HTML/CSS/JS (frontend).

## Features
- Upload images (multi-select) or a ZIP archive
- Auto-load and list all images; thumbnails show live annotation previews
- Create/select labels; the selected label is used for new boxes
- Draw, move, and resize boxes with the mouse (hover-based editing, no modifiers)
  - Hover corners to resize; hover edges/body to move
  - Hovering a box hides the crosshair and shows the label name above the box
- Crosshair with coordinates pinned to the bottom-right of the displayed image area
- Autosave annotations per image
- One-click export to a YOLO-ready dataset ZIP
- Images are listed by import time (newest first)

## Quickstart
```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
python app.py  # server runs on http://127.0.0.1:5001
```
Then open your browser at http://127.0.0.1:5001


## Usage
- Top bar: Upload Images or Upload ZIP; Export YOLO Dataset
- Left sidebar: thumbnails; click to select an image
- Center canvas:
  - Draw: click-drag on empty area to create a box
  - Move: hover a box (cursor becomes move) then drag
  - Resize: hover a corner (diagonal-resize cursor) then drag
- Right sidebar: list of boxes; Focus or Delete
- Labels: create new labels and select the active one for new boxes

## Data Model and Storage
- Images: `uploads/`
- Annotations: `annotations/<image_basename>.json`
  - Stored as absolute pixel boxes: `{ classId, x, y, width, height }`
- Labels list: `data/labels.json`
- Exports: `exports/`

## Exported YOLO Dataset
The exported ZIP contains:
- `images/` — copies of your input images
- `labels/` — one `.txt` per image with YOLO normalized lines:
  - `class cx cy w h` (all normalized 0..1)
- `classes.txt` — one class name per line (index order matches `classId`)
- `data.yaml` — minimal Ultralytics-style dataset config

## REST API (for reference)
- `GET /api/images` — list images with metadata and thumbnail boxes
- `POST /api/upload/images` — upload one or more images (form field: `files`)
- `POST /api/upload/zip` — upload a ZIP (form field: `file`)
- `GET /api/labels` — list labels
- `POST /api/labels` — create label `{ name }`
- `GET /api/annotations/<imageId>` — get annotations for an image
- `PUT /api/annotations/<imageId>` — save annotations `{ boxes: [...] }`
- `GET /api/export` — export a YOLO dataset ZIP

## Notes
- Sorting: image list is ordered by the file mtime set at import
- Supported image formats: `.jpg`, `.jpeg`, `.png`, `.bmp`, `.webp`
- Tested on modern Chromium-based and Safari browsers

## Development
- Backend: `Flask`
- Frontend: static files in `static/` (`index.html`, `styles.css`, `app.js`)
- Default dev port: `5001` (set in `app.py`)

## License
MIT
