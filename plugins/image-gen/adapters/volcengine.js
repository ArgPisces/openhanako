// plugins/image-gen/adapters/volcengine.js

const FORMAT_TO_MIME = {
  png: "image/png",
  jpeg: "image/jpeg",
  webp: "image/webp",
};

export const volcengineAdapter = {
  /**
   * @param {{ prompt: string, modelId: string, apiKey: string, baseUrl: string, size?: string, format?: string, quality?: string, providerDefaults?: object }} opts
   */
  async generate({ prompt, modelId, apiKey, baseUrl, size, format, quality, aspectRatio, image, providerDefaults }) {
    const outputFormat = format || providerDefaults?.format || "png";
    const body = {
      model: modelId,
      prompt,
      response_format: "b64_json",
      output_format: outputFormat,
    };

    if (size || providerDefaults?.size) body.size = size || providerDefaults.size;
    if (aspectRatio || providerDefaults?.aspect_ratio) body.aspect_ratio = aspectRatio || providerDefaults.aspect_ratio;
    if (image) body.image = Array.isArray(image) ? image : [image];

    // Apply provider-specific defaults (watermark defaults to false)
    body.watermark = providerDefaults?.watermark ?? false;
    if (providerDefaults) {
      if (providerDefaults.guidance_scale !== undefined) body.guidance_scale = providerDefaults.guidance_scale;
      if (providerDefaults.seed !== undefined) body.seed = providerDefaults.seed;
    }

    const url = `${baseUrl.replace(/\/+$/, "")}/images/generations`;
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${apiKey}`,
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      let msg = `API error ${res.status}`;
      try {
        const err = await res.json();
        if (err.error?.message) msg = `${msg}: ${err.error.message}`;
      } catch {}
      throw new Error(msg);
    }

    const data = await res.json();
    const images = data.data || [];
    if (images.length === 0) {
      throw new Error("API returned no images");
    }

    const mimeType = FORMAT_TO_MIME[outputFormat] || "image/png";

    return {
      images: images.map((img, i) => ({
        buffer: Buffer.from(img.b64_json, "base64"),
        mimeType,
        fileName: `image-${i + 1}.${outputFormat}`,
      })),
    };
  },
};
