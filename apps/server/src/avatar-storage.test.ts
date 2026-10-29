import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  LocalAvatarStorage,
  S3AvatarStorage,
  createAvatarStorage,
} from "./avatar-storage.js";

describe("LocalAvatarStorage", () => {
  let tempDir: string;
  let storage: LocalAvatarStorage;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "avatar-test-"));
    storage = new LocalAvatarStorage({ avatarDir: tempDir });
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it("salva avatar atomicamente no diretório local e retorna URL relativa", async () => {
    const filename = "0123456789abcdef0123456789abcdef0123456789abcdef.webp";
    const content = Buffer.from("fake-webp-binary-content");

    const url = await storage.save(filename, content);
    expect(url).toBe(`/avatars/${filename}`);

    const filePath = join(tempDir, filename);
    expect(existsSync(filePath)).toBe(true);
    const read = await readFile(filePath);
    expect(read.equals(content)).toBe(true);
  });

  it("remove avatar existente no disco", async () => {
    const filename = "0123456789abcdef0123456789abcdef0123456789abcdef.webp";
    await storage.save(filename, Buffer.from("test"));

    const filePath = join(tempDir, filename);
    expect(existsSync(filePath)).toBe(true);

    await storage.delete(`/avatars/${filename}`);
    expect(existsSync(filePath)).toBe(false);
  });

  it("ignora remoção para URLs nulas ou formatos inválidos", async () => {
    await expect(storage.delete(null)).resolves.toBeUndefined();
    await expect(storage.delete("")).resolves.toBeUndefined();
    await expect(storage.delete("/avatars/invalid-name.png")).resolves.toBeUndefined();
    await expect(storage.delete("https://example.com/avatar.webp")).resolves.toBeUndefined();
  });
});

describe("S3AvatarStorage", () => {
  const mockSend = vi.fn();
  const mockClient = { send: mockSend } as unknown as import("@aws-sdk/client-s3").S3Client;

  beforeEach(() => {
    mockSend.mockReset();
    mockSend.mockResolvedValue({});
  });

  it("envia PutObjectCommand com metadados corretos para o bucket S3", async () => {
    const storage = new S3AvatarStorage({
      bucket: "game-avatars",
      region: "us-east-1",
      publicUrl: "https://cdn.hegemonia.gg/avatars",
      client: mockClient,
    });

    const filename = "0123456789abcdef0123456789abcdef0123456789abcdef.webp";
    const buffer = Buffer.from("image-bytes");

    const url = await storage.save(filename, buffer);

    expect(url).toBe(`https://cdn.hegemonia.gg/avatars/${filename}`);
    expect(mockSend).toHaveBeenCalledTimes(1);

    const callArg = mockSend.mock.calls[0][0];
    expect(callArg.input).toMatchObject({
      Bucket: "game-avatars",
      Key: `avatars/${filename}`,
      Body: buffer,
      ContentType: "image/webp",
      CacheControl: "public, max-age=2592000, immutable",
    });
  });

  it("formata URL pública corretamente para diferentes provedores S3", () => {
    const filename = "0123456789abcdef0123456789abcdef0123456789abcdef.webp";

    // 1. CDN com /avatars no sufixo
    const cdnWithSuffix = new S3AvatarStorage({
      bucket: "bucket",
      publicUrl: "https://cdn.example.com/avatars",
      client: mockClient,
    });
    expect(cdnWithSuffix.formatPublicUrl(filename)).toBe(`https://cdn.example.com/avatars/${filename}`);

    // 2. CDN raiz sem sufixo
    const cdnRoot = new S3AvatarStorage({
      bucket: "bucket",
      publicUrl: "https://cdn.example.com",
      client: mockClient,
    });
    expect(cdnRoot.formatPublicUrl(filename)).toBe(`https://cdn.example.com/avatars/${filename}`);

    // 3. MinIO / S3 custom endpoint com forcePathStyle
    const minio = new S3AvatarStorage({
      bucket: "custom-bucket",
      endpoint: "http://minio:9000",
      forcePathStyle: true,
      client: mockClient,
    });
    expect(minio.formatPublicUrl(filename)).toBe(`http://minio:9000/custom-bucket/avatars/${filename}`);

    // 4. AWS S3 us-east-1 padrão
    const awsUsEast = new S3AvatarStorage({
      bucket: "my-aws-bucket",
      region: "us-east-1",
      client: mockClient,
    });
    expect(awsUsEast.formatPublicUrl(filename)).toBe(`https://my-aws-bucket.s3.amazonaws.com/avatars/${filename}`);

    // 5. AWS S3 região específica
    const awsSaoPaulo = new S3AvatarStorage({
      bucket: "my-aws-bucket",
      region: "sa-east-1",
      client: mockClient,
    });
    expect(awsSaoPaulo.formatPublicUrl(filename)).toBe(`https://my-aws-bucket.s3.sa-east-1.amazonaws.com/avatars/${filename}`);
  });

  it("executa DeleteObjectCommand ao remover avatar no S3", async () => {
    const storage = new S3AvatarStorage({
      bucket: "my-bucket",
      publicUrl: "https://cdn.example.com/avatars",
      client: mockClient,
    });

    const filename = "0123456789abcdef0123456789abcdef0123456789abcdef.webp";
    await storage.delete(`https://cdn.example.com/avatars/${filename}`);

    expect(mockSend).toHaveBeenCalledTimes(1);
    const callArg = mockSend.mock.calls[0][0];
    expect(callArg.input).toMatchObject({
      Bucket: "my-bucket",
      Key: `avatars/${filename}`,
    });
  });

  it("ignora remoção de URL inválida ou não pertencente ao storage", async () => {
    const storage = new S3AvatarStorage({
      bucket: "my-bucket",
      publicUrl: "https://cdn.example.com/avatars",
      client: mockClient,
    });

    await storage.delete("https://other-domain.com/unrelated.jpg");
    expect(mockSend).not.toHaveBeenCalled();

    await storage.delete(null);
    expect(mockSend).not.toHaveBeenCalled();
  });
});

describe("createAvatarStorage factory", () => {
  it("cria LocalAvatarStorage por padrão", () => {
    const storage = createAvatarStorage({});
    expect(storage.driver).toBe("local");
    expect(storage).toBeInstanceOf(LocalAvatarStorage);
  });

  it("cria S3AvatarStorage quando AVATAR_STORAGE_DRIVER=s3", () => {
    const storage = createAvatarStorage({
      AVATAR_STORAGE_DRIVER: "s3",
      S3_BUCKET: "my-bucket",
      S3_REGION: "us-east-1",
    });
    expect(storage.driver).toBe("s3");
    expect(storage).toBeInstanceOf(S3AvatarStorage);
  });

  it("lança erro se AVATAR_STORAGE_DRIVER=s3 sem S3_BUCKET", () => {
    expect(() =>
      createAvatarStorage({
        AVATAR_STORAGE_DRIVER: "s3",
      })
    ).toThrow(/S3_BUCKET or AVATAR_S3_BUCKET/);
  });
});
