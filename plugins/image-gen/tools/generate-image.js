import { getAdapter } from "../adapters/registry.js";
import { saveImage } from "../lib/download.js";

export const name = "generate-image";
export const description = "根据文字描述生成图片";
export const parameters = {
  type: "object",
  properties: {
    prompt:       { type: "string", description: "图片描述" },
    filename:     { type: "string", description: "可选，保存的文件名（不含扩展名），如 sunset-cat" },
    image:        { type: "string", description: "可选，参考图的文件路径或 URL（用于图生图）" },
    aspect_ratio: { type: "string", description: "可选，长宽比如 1:1、16:9、9:16、4:3、3:4" },
    model:        { type: "string", description: "可选，覆盖默认模型 ID" },
    provider:     { type: "string", description: "可选，与 model 配合指定 provider" },
    size:         { type: "string", description: "可选，如 1024x1024、2K" },
    format:       { type: "string", description: "可选，png / jpeg / webp" },
    quality:      { type: "string", description: "可选，low / medium / high" },
  },
  required: ["prompt"],
};

export async function execute(input, ctx) {
  try {
    // 1. Resolve model (priority: input → agent config → global default)
    const model = await resolveModel(input, ctx);
    if (!model) {
      return "图片生成功能未配置。请在设置 → Media 中添加图片模型。";
    }

    const { id: modelId, provider: providerId } = model;

    // 2. Get credentials
    const creds = await ctx.bus.request("provider:credentials", { providerId });
    if (creds.error) {
      return `Provider "${providerId}" 未配置 API Key。请在设置 → Providers 中配置。`;
    }

    // 3. Get adapter
    const adapter = getAdapter(providerId);
    if (!adapter) {
      return `不支持的图片生成 provider：${providerId}`;
    }

    // 4. Get provider defaults
    const allDefaults = ctx.config.get("providerDefaults") || {};
    const providerDefaults = allDefaults[providerId] || {};

    // 5. Call adapter
    const result = await adapter.generate({
      prompt: input.prompt,
      modelId,
      apiKey: creds.apiKey,
      baseUrl: creds.baseUrl,
      size: input.size,
      format: input.format,
      quality: input.quality,
      aspectRatio: input.aspect_ratio,
      image: input.image,
      providerDefaults,
    });

    // 6. Save first image
    const img = result.images[0];
    const { filePath } = await saveImage(img.buffer, img.mimeType, ctx.dataDir, input.filename);
    let response = `图片已生成并保存到 ${filePath}\n请立即调用 stage_files 工具将此文件呈现给用户：stage_files({ filepaths: ["${filePath}"] })`;
    if (result.revisedPrompt) {
      response += `\n修正后的描述：${result.revisedPrompt}`;
    }
    return response;

  } catch (err) {
    const msg = err.message || String(err);
    if (msg.includes("401") || msg.includes("403")) {
      return `API Key 无效或已过期，请检查 Provider 设置。(${msg})`;
    }
    if (msg.includes("429")) {
      return `图片生成请求过于频繁，请稍后再试。(${msg})`;
    }
    if (msg.includes("400")) {
      return `请求参数错误：${msg}`;
    }
    return `图片生成失败：${msg}`;
  }
}

async function resolveModel(input, ctx) {
  // Priority 1: explicit input override
  if (input.model) {
    return { id: input.model, provider: input.provider || "" };
  }

  // Priority 2: agent config
  if (ctx.agentId) {
    try {
      const { config } = await ctx.bus.request("agent:config", { agentId: ctx.agentId });
      if (config?.imageModel?.id) {
        return config.imageModel;
      }
    } catch {
      // agent config unavailable, fall through to global default
    }
  }

  // Priority 3: global default
  const defaultModel = ctx.config.get("defaultImageModel");
  if (defaultModel?.id) {
    return defaultModel;
  }

  return null;
}
