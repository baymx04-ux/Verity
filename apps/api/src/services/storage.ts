import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { randomUUID } from 'node:crypto';

import type { AppConfig } from '../config/env';

export class StorageService {
  private client: S3Client;
  private publicClient: S3Client;
  private bucket: string;

  constructor(config: AppConfig) {
    this.bucket = config.MINIO_BUCKET;

    // Internal client (talks to MinIO over internal Docker or local network)
    this.client = new S3Client({
      endpoint: config.minioUrl,
      region: 'us-east-1',
      credentials: {
        accessKeyId: config.MINIO_ACCESS_KEY,
        secretAccessKey: config.MINIO_SECRET_KEY,
      },
      forcePathStyle: true,
    });

    // Public client (for generating presigned URLs accessible by the browser)
    this.publicClient = new S3Client({
      endpoint: config.MINIO_PUBLIC_ENDPOINT,
      region: 'us-east-1',
      credentials: {
        accessKeyId: config.MINIO_ACCESS_KEY,
        secretAccessKey: config.MINIO_SECRET_KEY,
      },
      forcePathStyle: true,
    });
  }

  async upload(key: string, buffer: Buffer, mimeType: string): Promise<void> {
    const command = new PutObjectCommand({
      Bucket: this.bucket,
      Key: key,
      Body: buffer,
      ContentType: mimeType,
    });
    await this.client.send(command);
  }

  async getPresignedDownloadUrl(
    key: string,
    filename?: string,
    expiresInSeconds = 300,
  ): Promise<string> {
    const command = new GetObjectCommand({
      Bucket: this.bucket,
      Key: key,
      ResponseContentDisposition: filename
        ? `attachment; filename="${encodeURIComponent(filename)}"`
        : undefined,
    });
    return getSignedUrl(this.publicClient, command, { expiresIn: expiresInSeconds });
  }

  /** Presigned URL the AI service uses to fetch the original file for parsing. */
  async getPresignedInternalUrl(key: string, expiresInSeconds = 900): Promise<string> {
    const command = new GetObjectCommand({
      Bucket: this.bucket,
      Key: key,
    });
    return getSignedUrl(this.client, command, { expiresIn: expiresInSeconds });
  }

  async delete(key: string): Promise<void> {
    const command = new DeleteObjectCommand({
      Bucket: this.bucket,
      Key: key,
    });
    await this.client.send(command);
  }

  buildStorageKey(filename: string): string {
    const safe = filename.replace(/[^a-zA-Z0-9._-]/g, '_').slice(-120);
    return `documents/${Date.now()}-${randomUUID()}-${safe}`;
  }
}
