// plugins/image-gen/adapters/openai.js

const FORMAT_TO_MIME = {
  png: "image/png",
  jpeg: "image/jpeg",
  webp: "image/webp",
};

export const openaiAdapter = {
  async generate({ prompt, modelId, apiKey, baseUrl, size, format, quality, aspectRatio, image, providerDefaults }) {
    const outputFormat = format || providerDefaults?.format || "png";
    const body = {
      model: modelId,
      prompt,
      n: 1,
      output_format: outputFormat,
    };

    if (size || providerDefaults?.size) body.size = size || providerDefaults.size;
    if (quality || providerDefaults?.quality) body.quality = quality || providerDefaults.quality;

    if (providerDefaults) {
      if (providerDefaults.background) body.background = providerDefaults.background;
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
    const revisedPrompt = images[0]?.revised_prompt;

    return {
      images: images.map((img, i) => ({
        buffer: Buffer.from(img.b64_json, "base64"),
        mimeType,
        fileName: `image-${i + 1}.${outputFormat}`,
      })),
      ...(revisedPrompt ? { revisedPrompt } : {}),
    };
  },
};
