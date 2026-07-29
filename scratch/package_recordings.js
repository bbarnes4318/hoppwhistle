const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const jsonPath = '/tmp/recordings_list.json';
const exportDir = '/tmp/recordings_export';
const zipPath = '/tmp/recordings_export.zip';

// Ensure export dir is empty and exists
if (fs.existsSync(exportDir)) {
  fs.rmSync(exportDir, { recursive: true, force: true });
}
fs.mkdirSync(exportDir);

if (fs.existsSync(zipPath)) {
  fs.unlinkSync(zipPath);
}

// Read recordings JSON
const recordings = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
console.log(`Found ${recordings.length} recordings in JSON data.`);

// Base volume paths on host
const basePaths = [
  '/var/lib/docker/volumes/docker_minio_data/_data/recordings/recordings',
  '/var/lib/docker/volumes/docker_minio_data/_data/hopwhistle-recordings/recordings'
];

let copiedCount = 0;
let missingCount = 0;

for (const rec of recordings) {
  const callId = rec.callId;
  const createdAt = new Date(rec.createdAt);
  
  // Format Date: YYYY-MM-DD_HH-MM-SS (Local/EST approximation)
  // Shift by -4 hours for EST/EDT
  const estTime = new Date(createdAt.getTime() - 4 * 60 * 60 * 1000);
  const dateStr = estTime.toISOString().replace(/T/, '_').replace(/\..+/, '').replace(/:/g, '-');
  
  const fromNum = rec.call?.callerId || 'unknown';
  const toNum = rec.call?.toNumber || 'unknown';
  const shortId = callId.substring(0, 8);
  
  // Clean names
  const cleanFrom = fromNum.replace(/[^\d]/g, '');
  const cleanTo = toNum.replace(/[^\d]/g, '');
  
  const friendlyName = `${dateStr}_From_${cleanFrom}_To_${cleanTo}_${shortId}.wav`;
  
  // Try to find the file in either S3 storage key path or dates folder
  // Path format: YYYY/MM/DD/callId.wav
  const year = createdAt.getUTCFullYear();
  const month = String(createdAt.getUTCMonth() + 1).padStart(2, '0');
  const day = String(createdAt.getUTCDate()).padStart(2, '0');
  const subPath = `${year}/${month}/${day}/${callId}.wav`;
  
  let sourceFile = null;
  for (const basePath of basePaths) {
    const checkPath = path.join(basePath, subPath);
    if (fs.existsSync(checkPath)) {
      sourceFile = checkPath;
      break;
    }
    // Also try direct lookup under base path (if stored differently)
    const directCheck = path.join(basePath, `${callId}.wav`);
    if (fs.existsSync(directCheck)) {
      sourceFile = directCheck;
      break;
    }
  }
  
  if (sourceFile) {
    // If it's a directory (MinIO storage format), look for the part.1 file inside
    if (fs.statSync(sourceFile).isDirectory()) {
      const subdirs = fs.readdirSync(sourceFile);
      let foundPart = false;
      for (const subdir of subdirs) {
        const partCheck = path.join(sourceFile, subdir, 'part.1');
        if (fs.existsSync(partCheck)) {
          sourceFile = partCheck;
          foundPart = true;
          break;
        }
      }
      if (!foundPart) {
        console.warn(`Could not find part.1 inside MinIO directory: ${sourceFile}`);
        missingCount++;
        continue;
      }
    }

    const destFile = path.join(exportDir, friendlyName);
    fs.copyFileSync(sourceFile, destFile);
    copiedCount++;
    console.log(`Copied: ${friendlyName}`);
  } else {
    missingCount++;
    console.warn(`File not found for Call ID: ${callId} (expected subpath: ${subPath})`);
  }
}

console.log(`Copied ${copiedCount} files. ${missingCount} files were missing.`);

if (copiedCount > 0) {
  console.log('Zipping files...');
  try {
    execSync(`zip -j ${zipPath} ${exportDir}/*`);
    console.log(`Zip archive created at: ${zipPath}`);
  } catch (err) {
    console.warn(`Failed to zip using 'zip' command: ${err.message}. Trying 'tar' fallback...`);
    try {
      execSync(`tar -czf /tmp/recordings_export.tar.gz -C ${exportDir} .`);
      console.log('Tarball archive created at: /tmp/recordings_export.tar.gz');
    } catch (tarErr) {
      console.error(`Tar fallback failed: ${tarErr.message}`);
    }
  }
} else {
  console.log('No files copied, skipping zip creation.');
}
