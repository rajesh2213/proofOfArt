import fs from "fs";
import sharp from "sharp";

const INPUT_SHEETS = [
  "./sheet_1.webp",
  "./sheet_2.webp",
  "./sheet_3.webp"
];

const FRAMES_PER_SHEET = 60;
const FRAMES_PER_ROW = 10;
const TOTAL_FRAMES = 180;
const OUTPUT_PATH = "./paint_drip_merged.webp";

async function merge() {
  console.log("🔄 Decoding all sheets into raw pixel buffers...");

  // Decode sheets to raw RGB(A) once
  const decodedSheets = await Promise.all(
    INPUT_SHEETS.map(async (src) => {
      const img = sharp(src).ensureAlpha();
      const meta = await img.metadata();
      const raw = await img.raw().toBuffer();
      return { meta, raw };
    })
  );

  const frameWidth = decodedSheets[0].meta.width / FRAMES_PER_ROW;
  const frameHeight = decodedSheets[0].meta.height / (FRAMES_PER_SHEET / FRAMES_PER_ROW);

  const frameW = Math.floor(frameWidth);
  const frameH = Math.floor(frameHeight);

  const totalRows = Math.ceil(TOTAL_FRAMES / FRAMES_PER_ROW);
  const outWidth = frameW * FRAMES_PER_ROW;
  const outHeight = frameH * totalRows;

  console.log(`📐 Frame size: ${frameW}×${frameH}`);
  console.log(`🖼 Output sheet: ${outWidth}×${outHeight}`);

  const outputRaw = Buffer.alloc(outWidth * outHeight * 4); // RGBA

  let frameIndex = 0;

  for (let s = 0; s < decodedSheets.length; s++) {
    const { meta, raw } = decodedSheets[s];
    const sheetW = meta.width;
    const sheetH = meta.height;

    for (let f = 0; f < FRAMES_PER_SHEET; f++) {
      const global = frameIndex;

      const srcCol = f % FRAMES_PER_ROW;
      const srcRow = Math.floor(f / FRAMES_PER_ROW);

      const sx = srcCol * frameW;
      const sy = srcRow * frameH;

      const dstCol = global % FRAMES_PER_ROW;
      const dstRow = Math.floor(global / FRAMES_PER_ROW);

      const dx = dstCol * frameW;
      const dy = dstRow * frameH;

      // Copy frame manually (fast raw copy)
      for (let y = 0; y < frameH; y++) {
        const srcY = sy + y;
        const dstY = dy + y;

        const srcStart = (srcY * sheetW + sx) * 4;
        const srcEnd = srcStart + frameW * 4;

        const dstStart = (dstY * outWidth + dx) * 4;

        raw.copy(outputRaw, dstStart, srcStart, srcEnd);
      }

      frameIndex++;
    }
  }

  console.log("💾 Encoding merged WebP...");

  await sharp(outputRaw, {
    raw: {
      width: outWidth,
      height: outHeight,
      channels: 4
    }
  })
    .webp({ quality: 100 })
    .toFile(OUTPUT_PATH);

  fs.writeFileSync(
    "./paint_drip_merged.json",
    JSON.stringify(
      {
        frameWidth: frameW,
        frameHeight: frameH,
        totalFrames: TOTAL_FRAMES,
        framesPerRow: FRAMES_PER_ROW,
        rows: totalRows,
        output: OUTPUT_PATH
      },
      null,
      2
    )
  );

  console.log("✨ Done!");
}

merge();
