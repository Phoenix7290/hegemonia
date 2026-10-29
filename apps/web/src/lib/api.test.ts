import { describe, expect, it } from "vitest";
import { assetUrl } from "./api.js";

describe("assetUrl", () => {
  it("retorna null para valores nulos ou vazios", () => {
    expect(assetUrl(null)).toBeNull();
    expect(assetUrl("")).toBeNull();
  });

  it("retorna URLs absolutas inalteradas (S3, CDN ou HTTP externo)", () => {
    expect(assetUrl("https://s3.amazonaws.com/my-bucket/avatars/abc.webp")).toBe(
      "https://s3.amazonaws.com/my-bucket/avatars/abc.webp"
    );
    expect(assetUrl("https://cdn.hegemonia.gg/avatars/abc.webp")).toBe(
      "https://cdn.hegemonia.gg/avatars/abc.webp"
    );
    expect(assetUrl("http://localhost:9000/avatars/abc.webp")).toBe(
      "http://localhost:9000/avatars/abc.webp"
    );
  });

  it("anexa API_BASE para caminhos relativos locais", () => {
    const result = assetUrl("/avatars/abc.webp");
    expect(result).toMatch(/\/avatars\/abc\.webp$/);
  });
});
