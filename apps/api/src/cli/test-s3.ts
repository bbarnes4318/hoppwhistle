import 'dotenv-flow/config';
import { getStorageService } from '../services/storage.js';
import { Readable } from 'stream';

async function main() {
  console.log('Testing S3 Storage Service...');
  console.log('Environment variables:');
  console.log(`  S3_ENDPOINT: ${process.env.S3_ENDPOINT}`);
  console.log(`  S3_BUCKET: ${process.env.S3_BUCKET}`);
  console.log(`  S3_ACCESS_KEY: ${process.env.S3_ACCESS_KEY ? '***' : 'undefined'}`);
  console.log(`  S3_SECRET_KEY: ${process.env.S3_SECRET_KEY ? '***' : 'undefined'}`);
  console.log(`  S3_REGION: ${process.env.S3_REGION}`);
  console.log(`  S3_FORCE_PATH_STYLE: ${process.env.S3_FORCE_PATH_STYLE}`);

  const storage = getStorageService();
  const dummyData = Buffer.from('Hello, this is a test recording file.');
  const callId = 'test-call-' + Date.now();
  const format = 'wav';
  const expectedKey = `recordings/test/${callId}.${format}`;

  try {
    console.log(`\n1. Attempting to upload dummy file to S3 with key: ${expectedKey}...`);
    const uploadResult = await storage.uploadRecording(
      dummyData,
      callId,
      format,
      { test: 'true' }
    );
    console.log('Upload Result:', uploadResult);

    console.log('\n2. Checking if file exists...');
    const exists = await storage.exists(uploadResult.storageKey);
    console.log(`Exists: ${exists}`);

    console.log('\n3. Attempting to retrieve readable stream...');
    const streamResult = await storage.getRecordingStream(uploadResult.storageKey);
    console.log('Stream retrieved successfully!');
    console.log(`Content-Type: ${streamResult.contentType}`);
    console.log(`Content-Length: ${streamResult.contentLength}`);

    // Read the stream
    const chunks: Buffer[] = [];
    for await (const chunk of streamResult.stream) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }
    const content = Buffer.concat(chunks).toString();
    console.log(`Content read: "${content}"`);

    console.log('\n4. Deleting test file...');
    await storage.deleteRecording(uploadResult.storageKey);
    console.log('Deleted successfully!');
    console.log('\n✓ ALL TESTS PASSED!');
  } catch (error) {
    console.error('\n❌ TEST FAILED with error:');
    console.error(error);
  }
}

main();
