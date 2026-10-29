import { mkdir, rename, unlink, writeFile } from "node:fs/promises";
import { basename, resolve } from "node:path";
import { DeleteObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";

export interface AvatarStorage {
  readonly driver: "local" | "s3";
  save(filename: string, buffer: Buffer): Promise<string>;
  delete(url: string | null): Promise<void>;
}

export interface LocalStorageOptions {
  avatarDir: string;
  baseUrlPath?: string;
}

export class LocalAvatarStorage implements AvatarStorage {
  readonly driver = "local" as const;
  readonly avatarDir: string;
  readonly baseUrlPath: string;

  constructor(options: LocalStorageOptions) {
    this.avatarDir = resolve(options.avatarDir);
    this.baseUrlPath = (options.baseUrlPath ?? "/avatars").replace(/\/+$/, "");
  }

  async save(filename: string, buffer: Buffer): Promise<string> {
    await mkdir(this.avatarDir, { recursive: true });
    const temporaryPath = resolve(this.avatarDir, `.${filename}.tmp`);
    const finalPath = resolve(this.avatarDir, filename);

    await writeFile(temporaryPath, buffer);
    await rename(temporaryPath, finalPath);

    return `${this.baseUrlPath}/${filename}`;
  }

  async delete(url: string | null): Promise<void> {
    if (!url || !url.startsWith(`${this.baseUrlPath}/`)) {
      return;
    }
    const filename = basename(url);
    if (!/^[a-f0-9]{48}\.webp$/.test(filename)) {
      return;
    }
    await unlink(resolve(this.avatarDir, filename)).catch(() => undefined);
  }
}

export interface S3StorageOptions {
  bucket: string;
  region?: string;
  endpoint?: string;
  accessKeyId?: string;
  secretAccessKey?: string;
  publicUrl?: string;
  forcePathStyle?: boolean;
  prefix?: string;
  client?: S3Client;
}

export class S3AvatarStorage implements AvatarStorage {
  readonly driver = "s3" as const;
  readonly bucket: string;
  readonly region: string;
  readonly endpoint?: string;
  readonly publicUrl?: string;
  readonly forcePathStyle: boolean;
  readonly prefix: string;
  readonly client: S3Client;

  constructor(options: S3StorageOptions) {
    this.bucket = options.bucket;
    this.region = options.region ?? "us-east-1";
    this.endpoint = options.endpoint;
    this.publicUrl = options.publicUrl?.replace(/\/+$/, "");
    this.forcePathStyle = options.forcePathStyle ?? false;
    this.prefix = options.prefix ?? "avatars/";

    if (options.client) {
      this.client = options.client;
    } else {
      const clientConfig: ConstructorParameters<typeof S3Client>[0] = {
        region: this.region,
        forcePathStyle: this.forcePathStyle,
      };
      if (this.endpoint) {
        clientConfig.endpoint = this.endpoint;
      }
      if (options.accessKeyId && options.secretAccessKey) {
        clientConfig.credentials = {
          accessKeyId: options.accessKeyId,
          secretAccessKey: options.secretAccessKey,
        };
      }
      this.client = new S3Client(clientConfig);
    }
  }

  private resolveKey(filename: string): string {
    return `${this.prefix}${filename}`;
  }

  formatPublicUrl(filename: string): string {
    const key = this.resolveKey(filename);
    if (this.publicUrl) {
      const trimmedPrefix = this.prefix.replace(/^\/+|\/+$/g, "");
      if (trimmedPrefix && this.publicUrl.endsWith(`/${trimmedPrefix}`)) {
        return `${this.publicUrl}/${filename}`;
      }
      return `${this.publicUrl}/${key.replace(/^\/+/, "")}`;
    }

    if (this.endpoint) {
      const endpointClean = this.endpoint.replace(/\/+$/, "");
      if (this.forcePathStyle) {
        return `${endpointClean}/${this.bucket}/${key}`;
      }
      try {
        const parsed = new URL(endpointClean);
        return `${parsed.protocol}//${this.bucket}.${parsed.host}${parsed.pathname === "/" ? "" : parsed.pathname}/${key}`;
      } catch {
        return `${endpointClean}/${this.bucket}/${key}`;
      }
    }

    if (this.region === "us-east-1") {
      return `https://${this.bucket}.s3.amazonaws.com/${key}`;
    }
    return `https://${this.bucket}.s3.${this.region}.amazonaws.com/${key}`;
  }

  private extractKey(url: string): string | null {
    if (!url) return null;
    const match = url.match(/([a-f0-9]{48}\.webp)(?:$|[?#])/i);
    if (!match) return null;
    const filename = match[1];

    if (this.publicUrl && url.startsWith(this.publicUrl)) {
      return this.resolveKey(filename);
    }

    if (this.endpoint) {
      const cleanEndpoint = this.endpoint.replace(/^https?:\/\//, "").replace(/\/+$/, "");
      if (url.includes(cleanEndpoint)) {
        return this.resolveKey(filename);
      }
    }

    if (url.includes(`${this.bucket}.s3`) || url.includes(`s3.amazonaws.com/${this.bucket}`)) {
      return this.resolveKey(filename);
    }

    if (url.includes(`/${this.bucket}/`)) {
      return this.resolveKey(filename);
    }

    if (url.includes(this.resolveKey(filename))) {
      return this.resolveKey(filename);
    }

    return null;
  }

  async save(filename: string, buffer: Buffer): Promise<string> {
    const key = this.resolveKey(filename);
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: buffer,
        ContentType: "image/webp",
        CacheControl: "public, max-age=2592000, immutable",
      })
    );
    return this.formatPublicUrl(filename);
  }

  async delete(url: string | null): Promise<void> {
    if (!url) return;

    if (url.startsWith("/avatars/")) {
      const filename = basename(url);
      if (/^[a-f0-9]{48}\.webp$/.test(filename)) {
        const localDir = resolve(process.env.AVATAR_DIR ?? "data/avatars");
        await unlink(resolve(localDir, filename)).catch(() => undefined);
      }
      return;
    }

    const key = this.extractKey(url);
    if (!key) return;

    try {
      await this.client.send(
        new DeleteObjectCommand({
          Bucket: this.bucket,
          Key: key,
        })
      );
    } catch {
      // Gracefully ignore delete errors
    }
  }
}

export function createAvatarStorage(env: NodeJS.ProcessEnv = process.env): AvatarStorage {
  const driver = (env.AVATAR_STORAGE_DRIVER ?? "local").toLowerCase();

  if (driver === "s3") {
    const bucket = env.S3_BUCKET || env.AVATAR_S3_BUCKET;
    if (!bucket) {
      throw new Error("S3 avatar storage requires S3_BUCKET or AVATAR_S3_BUCKET to be configured.");
    }
    const region = env.S3_REGION || env.AWS_REGION || "us-east-1";
    const endpoint = env.S3_ENDPOINT;
    const accessKeyId = env.S3_ACCESS_KEY_ID || env.AWS_ACCESS_KEY_ID;
    const secretAccessKey = env.S3_SECRET_ACCESS_KEY || env.AWS_SECRET_ACCESS_KEY;
    const publicUrl = env.S3_PUBLIC_URL || env.AVATAR_PUBLIC_URL;
    const forcePathStyle = env.S3_FORCE_PATH_STYLE === "true" || env.S3_FORCE_PATH_STYLE === "1";
    const prefix = env.S3_AVATAR_PREFIX ?? "avatars/";

    return new S3AvatarStorage({
      bucket,
      region,
      endpoint,
      accessKeyId,
      secretAccessKey,
      publicUrl,
      forcePathStyle,
      prefix,
    });
  }

  return new LocalAvatarStorage({
    avatarDir: resolve(env.AVATAR_DIR ?? "data/avatars"),
  });
}
