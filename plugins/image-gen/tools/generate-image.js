import { getAdapter } from "../adapters/registry.js";
import { saveImage } from "../lib/download.js";

export const name = "generate-image";
export const description = "根据文字描述生成图片。生成后必须调用 stage_files 呈现给用户。";
export const promptGuidelines = [
  "Prompt 编写规范：始终用英文写 prompt。结构：主体 → 动作/状态 → 环境/背景 → 光线/氛围 → 画风。50-150 词，逗号分隔，不写长句。",
  "具体化：将模糊请求转为具体视觉描述。避免抽象词（美丽的），用具体描述替代。不写否定句（图片模型不理解否定）。",
  "默认画风：用户没指定风格时，在 prompt 末尾附加：modern Japanese illustration style, soft cel-shaded, clean linework, muted warm color palette with cream and indigo tones, elegant and serene atmosphere, anime-influenced but mature aesthetic",
  "用户明确指定了风格（如油画、赛博朋克、写实照片）时不附加默认画风。",
  "每次生成必须为 filename 起一个简短有意义的英文名。生成完成后立即调用 stage_files({ filepaths: [返回的路径] }) 呈现给用户。",
];
export const parameters = {
  type: "object",
  properties: {
    prompt:       { type: "string", description: "英文图片描述，按 guidelines 编写" },
    filename:     { type: "string", description: "文件名（不含扩展名），如 sunset-cat" },
    image:        { type: "string", description: "参考图的文件路径或 URL（图生图）" },
    aspect_ratio: { type: "string", description: "长宽比：1:1, 4:3, 3:4, 16:9, 9:16, 3:2, 2:3, 21:9" },
    model:        { type: "string", description: "覆盖默认模型 ID" },
    provider:     { type: "string", description: "与 model 配合指定 provider" },
    size:         { type: "string", description: "分辨率：2K, 4K" },
    format:       { type: "string", description: "输出格式：png, jpeg, webp" },
    quality:      { type: "string", description: "生成质量：low, medium, high" },
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
