// pure JS test for S3/MinIO connectivity inside the container
import { S3Client, PutObjectCommand, GetObjectCommand, HeadObjectCommand, DeleteObjectCommand, CreateBucketCommand, HeadBucketCommand } from '@aws-sdk/client-s3';
import { Readable } from 'stream';

async function main() {
  console.log('Testing S3 Storage inside container...');
  console.log('Environment variables:');
  console.log(`  S3_ENDPOINT: ${process.env.S3_ENDPOINT}`);
  console.log(`  S3_BUCKET: ${process.env.S3_BUCKET}`);
  console.log(`  S3_ACCESS_KEY: ${process.env.S3_ACCESS_KEY}`);
  console.log(`  S3_SECRET_KEY: ${process.env.S3_SECRET_KEY}`);
  console.log(`  S3_REGION: ${process.env.S3_REGION}`);

  const client = new S3Client({
    endpoint: process.env.S3_ENDPOINT,
    region: process.env.S3_REGION || 'us-east-1',
    credentials: {
      accessKeyId: process.env.S3_ACCESS_KEY || '',
      secretAccessKey: process.env.S3_SECRET_KEY || '',
    },
    forcePathStyle: true, // MinIO compatible
  });

  const bucket = process.env.S3_BUCKET || 'hopwhistle-recordings';
  const key = `test-key-${Date.now()}.txt`;
  const body = 'This is a test message from test-s3.js';

  try {
    console.log('\nChecking if bucket exists...');
    try {
      await client.send(new HeadBucketCommand({ Bucket: bucket }));
      console.log(`Bucket ${bucket} exists.`);
    } catch (headErr) {
      console.log(`Bucket ${bucket} check failed: ${headErr.message}. Attempting to create...`);
      await client.send(new CreateBucketCommand({ Bucket: bucket }));
      console.log(`Bucket ${bucket} created.`);
    }

    console.log(`\nUploading file to S3 with key: ${key}...`);
    await client.send(new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: body,
      ContentType: 'text/plain',
    }));
    console.log('Upload completed!');

    console.log('\nChecking file metadata...');
    const headResult = await client.send(new HeadObjectCommand({
      Bucket: bucket,
      Key: key,
    }));
    console.log(`File size: ${headResult.ContentLength} bytes`);

    console.log('\nDownloading file...');
    const getResult = await client.send(new GetObjectCommand({
      Bucket: bucket,
      Key: key,
    }));
    const chunks = [];
    for await (const chunk of getResult.Body) {
      chunks.push(chunk);
    }
    const content = Buffer.concat(chunks).toString();
    console.log(`Downloaded content: "${content}"`);

    console.log('\nDeleting file...');
    await client.send(new DeleteObjectCommand({
      Bucket: bucket,
      Key: key,
    }));
    console.log('Deleted successfully!');
    console.log('\n✓ ALL TESTS PASSED!');
  } catch (error) {
    console.error('\n❌ TEST FAILED with error:');
    console.error(error);
  }
}

main();
