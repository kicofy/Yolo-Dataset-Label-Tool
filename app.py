import os
import io
import json
import uuid
import shutil
import zipfile
import time
from typing import List, Dict, Any

from flask import Flask, request, send_from_directory, jsonify, send_file
from PIL import Image


BASE_DIR = os.path.abspath(os.path.dirname(__file__))
UPLOAD_DIR = os.path.join(BASE_DIR, "uploads")
ANNOTATIONS_DIR = os.path.join(BASE_DIR, "annotations")
DATA_DIR = os.path.join(BASE_DIR, "data")
EXPORTS_DIR = os.path.join(BASE_DIR, "exports")
STATIC_DIR = os.path.join(BASE_DIR, "static")


def ensure_directories_exist() -> None:
    os.makedirs(UPLOAD_DIR, exist_ok=True)
    os.makedirs(ANNOTATIONS_DIR, exist_ok=True)
    os.makedirs(DATA_DIR, exist_ok=True)
    os.makedirs(EXPORTS_DIR, exist_ok=True)
    os.makedirs(STATIC_DIR, exist_ok=True)


ensure_directories_exist()


app = Flask(
    __name__,
    static_folder=STATIC_DIR,
    static_url_path="/static",
)


ALLOWED_IMAGE_EXTENSIONS = {".jpg", ".jpeg", ".png", ".bmp", ".webp"}


def is_image_filename(filename: str) -> bool:
    _, ext = os.path.splitext(filename.lower())
    return ext in ALLOWED_IMAGE_EXTENSIONS


def generate_unique_filename(original_filename: str) -> str:
    name, ext = os.path.splitext(original_filename)
    ext = ext.lower()
    if ext not in ALLOWED_IMAGE_EXTENSIONS:
        ext = ".jpg"
    return f"{uuid.uuid4().hex}{ext}"


def get_image_path(image_id: str) -> str:
    return os.path.join(UPLOAD_DIR, image_id)


def get_annotations_path(image_id: str) -> str:
    safe_name = os.path.splitext(image_id)[0] + ".json"
    return os.path.join(ANNOTATIONS_DIR, safe_name)


def load_labels() -> List[str]:
    labels_path = os.path.join(DATA_DIR, "labels.json")
    if not os.path.exists(labels_path):
        with open(labels_path, "w", encoding="utf-8") as f:
            json.dump([], f)
        return []
    with open(labels_path, "r", encoding="utf-8") as f:
        return json.load(f)


def save_labels(labels: List[str]) -> None:
    labels_path = os.path.join(DATA_DIR, "labels.json")
    with open(labels_path, "w", encoding="utf-8") as f:
        json.dump(labels, f, ensure_ascii=False, indent=2)


def get_image_size(image_path: str) -> Dict[str, int]:
    with Image.open(image_path) as im:
        width, height = im.size
    return {"width": width, "height": height}


def list_all_images() -> List[Dict[str, Any]]:
    items: List[Any] = []
    if not os.path.exists(UPLOAD_DIR):
        return []
    for filename in os.listdir(UPLOAD_DIR):
        if not is_image_filename(filename):
            continue
        image_path = os.path.join(UPLOAD_DIR, filename)
        try:
            size = get_image_size(image_path)
            mtime = os.path.getmtime(image_path)
        except Exception:
            continue
        ann_path = get_annotations_path(filename)
        has_annotations = os.path.exists(ann_path)
        thumb_boxes: List[Dict[str, float]] = []
        if has_annotations:
            try:
                with open(ann_path, "r", encoding="utf-8") as f:
                    ann = json.load(f)
                iw = max(1, ann.get("imageWidth", size["width"]))
                ih = max(1, ann.get("imageHeight", size["height"]))
                for b in ann.get("boxes", [])[:20]:
                    thumb_boxes.append({
                        "classId": b.get("classId", 0),
                        "x": float(b["x"]) / iw,
                        "y": float(b["y"]) / ih,
                        "width": float(b["width"]) / iw,
                        "height": float(b["height"]) / ih,
                    })
            except Exception:
                has_annotations = False
                thumb_boxes = []

        item = {
            "id": filename,
            "filename": filename,
            "url": f"/uploads/{filename}",
            "width": size["width"],
            "height": size["height"],
            "hasAnnotations": has_annotations,
            "thumbBoxes": thumb_boxes,
        }
        items.append((mtime, item))

    # Sort by import time (file mtime), newest first
    items.sort(key=lambda t: t[0], reverse=True)
    return [it for _, it in items]


@app.route("/")
def index() -> Any:
    return send_from_directory(STATIC_DIR, "index.html")


@app.route("/uploads/<path:filename>")
def serve_uploaded_file(filename: str):
    return send_from_directory(UPLOAD_DIR, filename)


@app.post("/api/upload/images")
def upload_images():
    if "files" not in request.files:
        return jsonify({"error": "no files part named 'files'"}), 400

    files = request.files.getlist("files")
    saved: List[Dict[str, Any]] = []
    for file in files:
        if file.filename == "":
            continue
        if not is_image_filename(file.filename):
            continue
        unique_name = generate_unique_filename(file.filename)
        save_path = os.path.join(UPLOAD_DIR, unique_name)
        file.save(save_path)
        # ensure import time reflects now
        try:
            now = time.time()
            os.utime(save_path, (now, now))
        except Exception:
            pass
        try:
            size = get_image_size(save_path)
        except Exception:
            try:
                os.remove(save_path)
            except Exception:
                pass
            continue
        saved.append({
            "id": unique_name,
            "url": f"/uploads/{unique_name}",
            "width": size["width"],
            "height": size["height"],
        })

    return jsonify({"saved": saved, "total": len(saved)})


@app.post("/api/upload/zip")
def upload_zip():
    file = request.files.get("file")
    if file is None or file.filename == "":
        return jsonify({"error": "no zip file provided"}), 400

    data = io.BytesIO(file.read())
    try:
        with zipfile.ZipFile(data) as zf:
            saved = []
            for zi in zf.infolist():
                if zi.is_dir():
                    continue
                name = os.path.basename(zi.filename)
                if not is_image_filename(name):
                    continue
                unique_name = generate_unique_filename(name)
                target_path = os.path.join(UPLOAD_DIR, unique_name)
                with zf.open(zi) as src, open(target_path, "wb") as dst:
                    shutil.copyfileobj(src, dst)
                # ensure import time reflects now
                try:
                    now = time.time()
                    os.utime(target_path, (now, now))
                except Exception:
                    pass
                try:
                    size = get_image_size(target_path)
                except Exception:
                    try:
                        os.remove(target_path)
                    except Exception:
                        pass
                    continue
                saved.append({
                    "id": unique_name,
                    "url": f"/uploads/{unique_name}",
                    "width": size["width"],
                    "height": size["height"],
                })
        return jsonify({"saved": saved, "total": len(saved)})
    except zipfile.BadZipFile:
        return jsonify({"error": "invalid zip file"}), 400


@app.get("/api/images")
def api_list_images():
    return jsonify({"images": list_all_images()})


@app.get("/api/labels")
def api_get_labels():
    labels = load_labels()
    return jsonify({
        "labels": [{"id": idx, "name": name} for idx, name in enumerate(labels)]
    })


@app.post("/api/labels")
def api_add_label():
    data = request.get_json(silent=True) or {}
    name = (data.get("name") or "").strip()
    if not name:
        return jsonify({"error": "label name is required"}), 400
    labels = load_labels()
    if name in labels:
        label_id = labels.index(name)
        return jsonify({"id": label_id, "name": name, "exists": True})
    labels.append(name)
    save_labels(labels)
    return jsonify({"id": len(labels) - 1, "name": name, "exists": False})


def read_image_annotations(image_id: str, ensure_dims_from_file: bool = True) -> Dict[str, Any]:
    image_path = get_image_path(image_id)
    ann_path = get_annotations_path(image_id)
    if os.path.exists(ann_path):
        with open(ann_path, "r", encoding="utf-8") as f:
            data = json.load(f)
        if ensure_dims_from_file:
            try:
                size = get_image_size(image_path)
                data["imageWidth"] = size["width"]
                data["imageHeight"] = size["height"]
            except Exception:
                pass
        return data
    try:
        size = get_image_size(image_path)
    except Exception:
        size = {"width": 0, "height": 0}
    return {
        "imageId": image_id,
        "imageWidth": size["width"],
        "imageHeight": size["height"],
        "boxes": [],
    }


@app.get("/api/annotations/<image_id>")
def api_get_annotations(image_id: str):
    image_path = get_image_path(image_id)
    if not os.path.exists(image_path):
        return jsonify({"error": "image not found"}), 404
    data = read_image_annotations(image_id)
    return jsonify(data)


@app.put("/api/annotations/<image_id>")
def api_put_annotations(image_id: str):
    image_path = get_image_path(image_id)
    if not os.path.exists(image_path):
        return jsonify({"error": "image not found"}), 404
    body = request.get_json(silent=True) or {}
    boxes = body.get("boxes")
    if not isinstance(boxes, list):
        return jsonify({"error": "boxes must be a list"}), 400
    try:
        size = get_image_size(image_path)
    except Exception:
        size = {"width": 1, "height": 1}
    iw = max(1, int(size["width"]))
    ih = max(1, int(size["height"]))

    cleaned: List[Dict[str, Any]] = []
    for b in boxes:
        try:
            class_id = int(b.get("classId", 0))
            x = float(b.get("x", 0.0))
            y = float(b.get("y", 0.0))
            w = float(b.get("width", 0.0))
            h = float(b.get("height", 0.0))
        except Exception:
            continue
        if w < 0:
            x = x + w
            w = -w
        if h < 0:
            y = y + h
            h = -h
        x = max(0.0, min(float(iw), x))
        y = max(0.0, min(float(ih), y))
        w = max(0.0, min(float(iw) - x, w))
        h = max(0.0, min(float(ih) - y, h))
        cleaned.append({
            "classId": class_id,
            "x": x,
            "y": y,
            "width": w,
            "height": h,
        })

    ann_path = get_annotations_path(image_id)
    with open(ann_path, "w", encoding="utf-8") as f:
        json.dump({
            "imageId": image_id,
            "imageWidth": iw,
            "imageHeight": ih,
            "boxes": cleaned,
        }, f, ensure_ascii=False, indent=2)
    return jsonify({"ok": True, "count": len(cleaned)})


def yolo_line(class_id: int, x: float, y: float, w: float, h: float, iw: int, ih: int) -> str:
    cx = (x + w / 2.0) / float(max(1, iw))
    cy = (y + h / 2.0) / float(max(1, ih))
    wn = w / float(max(1, iw))
    hn = h / float(max(1, ih))
    return f"{class_id} {cx:.6f} {cy:.6f} {wn:.6f} {hn:.6f}"


@app.get("/api/export")
def api_export_dataset():
    labels = load_labels()
    export_root = os.path.join(EXPORTS_DIR, f"export_{uuid.uuid4().hex}")
    images_dir = os.path.join(export_root, "images")
    labels_dir = os.path.join(export_root, "labels")
    os.makedirs(images_dir, exist_ok=True)
    os.makedirs(labels_dir, exist_ok=True)

    images = list_all_images()

    for img in images:
        image_id = img["id"]
        src_path = get_image_path(image_id)
        base_no_ext = os.path.splitext(image_id)[0]
        dst_img_path = os.path.join(images_dir, image_id)
        shutil.copy2(src_path, dst_img_path)

        ann = read_image_annotations(image_id)
        iw = max(1, int(ann.get("imageWidth", img["width"])) )
        ih = max(1, int(ann.get("imageHeight", img["height"])) )
        boxes = ann.get("boxes", [])
        if not boxes:
            continue
        label_file_path = os.path.join(labels_dir, base_no_ext + ".txt")
        with open(label_file_path, "w", encoding="utf-8") as lf:
            for b in boxes:
                try:
                    class_id = int(b.get("classId", 0))
                    x = float(b.get("x", 0.0))
                    y = float(b.get("y", 0.0))
                    w = float(b.get("width", 0.0))
                    h = float(b.get("height", 0.0))
                except Exception:
                    continue
                lf.write(yolo_line(class_id, x, y, w, h, iw, ih) + "\n")

    with open(os.path.join(export_root, "classes.txt"), "w", encoding="utf-8") as cf:
        for name in labels:
            cf.write(f"{name}\n")

    data_yaml = (
        "# Auto-generated YOLO dataset config\n"
        f"nc: {len(labels)}\n"
        f"names: {labels}\n"
        f"train: {os.path.abspath(images_dir)}\n"
        f"val: {os.path.abspath(images_dir)}\n"
    )
    with open(os.path.join(export_root, "data.yaml"), "w", encoding="utf-8") as yf:
        yf.write(data_yaml)

    zip_path = os.path.join(EXPORTS_DIR, f"dataset_{uuid.uuid4().hex}.zip")
    shutil.make_archive(zip_path[:-4], 'zip', export_root)

    try:
        shutil.rmtree(export_root)
    except Exception:
        pass

    return send_file(zip_path, as_attachment=True, download_name="yolo_dataset.zip")


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=5001, debug=True)


