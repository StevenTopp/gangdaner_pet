import os
import sys
import subprocess
import math
from PIL import Image

VIDEO_PATH = r"C:\Users\Steven\OneDrive\图片\cat\看.webm"
OUTPUT_DIR = os.path.join(os.path.dirname(__file__), "..", "app", "08_可替换素材", "跟随鼠标")
TEMP_DIR = os.path.join(os.path.dirname(__file__), "..", "temp_look_frames")

def main():
    if not os.path.exists(VIDEO_PATH):
        print(f"Error: Video file not found at {VIDEO_PATH}")
        sys.exit(1)

    os.makedirs(OUTPUT_DIR, exist_ok=True)
    os.makedirs(TEMP_DIR, exist_ok=True)

    print("Step 1: Extracting transparent PNG frames from video via ffmpeg...")
    # Extract 5 frames per second to temp folder
    cmd = [
        "ffmpeg", "-y",
        "-i", VIDEO_PATH,
        "-vf", "fps=5",
        os.path.join(TEMP_DIR, "frame_%04d.png")
    ]
    subprocess.run(cmd, check=True)

    frames = sorted([f for f in os.listdir(TEMP_DIR) if f.endswith(".png")])
    print(f"Extracted {len(frames)} frames.")

    if not frames:
        print("Error: No frames extracted.")
        sys.exit(1)

    # Convert sampled frames to WebP format in OUTPUT_DIR
    # We will pick 16 evenly spaced directional frames and 1 center frame
    num_directions = 16
    total_frames = len(frames)

    # First frame as center
    center_src = os.path.join(TEMP_DIR, frames[0])
    center_dst = os.path.join(OUTPUT_DIR, "center.webp")
    with Image.open(center_src) as img:
        img.save(center_dst, "WEBP", quality=95)
    print(f"Saved {center_dst}")

    # Map 16 directions around 360 degrees
    step = total_frames / num_directions
    for i in range(num_directions):
        frame_idx = int(i * step) % total_frames
        src_path = os.path.join(TEMP_DIR, frames[frame_idx])
        dst_name = f"look_{i:02d}.webp"
        dst_path = os.path.join(OUTPUT_DIR, dst_name)
        with Image.open(src_path) as img:
            img.save(dst_path, "WEBP", quality=95)
        print(f"Saved {dst_path} (from {frames[frame_idx]})")

    print("Extraction & conversion complete!")

if __name__ == "__main__":
    main()
