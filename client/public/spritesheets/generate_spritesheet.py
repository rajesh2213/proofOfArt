import os
import math
import re
from PIL import Image

# --- CONFIG ---
frames_folder = r"D:/Davinci proj/paintDrip/Renders/frames-pink"
output_file = "spritesheet.png"
# ----------------

# Step 1: Get all PNG files
frame_files = [f for f in os.listdir(frames_folder) if f.endswith(".png")]

# Step 2: Sort files by original number after 'Render'
def get_original_number(f):
    match = re.search(r'Render0*(\d+)\.png', f)
    return int(match.group(1)) if match else -1

frame_files.sort(key=get_original_number)

# Step 3: Rename files sequentially starting from Render001.png
for i, f in enumerate(frame_files, start=1):
    new_name = f"Render{i:03d}.png"
    os.rename(os.path.join(frames_folder, f), os.path.join(frames_folder, new_name))
    frame_files[i-1] = new_name  # update list with new names

print(f"Renamed {len(frame_files)} frames starting from Render001.png")

# Step 4: Load all images
frames = [Image.open(os.path.join(frames_folder, f)) for f in frame_files]

if not frames:
    raise ValueError("No frames found!")

frame_width, frame_height = frames[0].size

# Step 5: Calculate square-ish grid for spritesheet
num_frames = len(frames)
columns = math.ceil(math.sqrt(num_frames))
rows = math.ceil(num_frames / columns)

# Step 6: Create blank spritesheet
spritesheet = Image.new("RGBA", (columns * frame_width, rows * frame_height))

# Step 7: Paste frames into spritesheet
for index, frame in enumerate(frames):
    x = (index % columns) * frame_width
    y = (index // columns) * frame_height
    spritesheet.paste(frame, (x, y))

# Step 8: Save spritesheet
spritesheet.save(os.path.join(frames_folder, output_file))
print(f"Spritesheet saved as {output_file} ({columns}x{rows} frames)")
