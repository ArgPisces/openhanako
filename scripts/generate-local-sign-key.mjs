#!/usr/bin/env node
/**
 * generate-local-sign-key.mjs — 生成本地验证用一次性 ed25519 签名密钥对。
 *
 * 用途：build-executable.bat 在未设置 HANA_SIGN_KEY 时自动调用本脚本，
 *       生成测试密钥对供 build:server 的 seed 签名环节使用。
 *       正式发版应跳过本脚本，手动设置真实 HANA_SIGN_KEY / HANA_SIGN_KEYSET。
 *
 * 输出：
 *   --key <path>   私钥写入路径（PEM，mode 0o600）
 *   --keyset <path> 公钥 keyset 写入路径（JSON 数组，格式同 pinned-keyset.json）
 *
 * 幂等：私钥文件已存在时跳过生成（复用），避免每次构建换密钥致 seed 不一致。
 */
import { generateKeyPairSync, createHash } from "crypto";
import fs from "fs";
import path from "path";

function parseArgs(argv) {
  const args = { key: null, keyset: null };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--key") args.key = argv[++i];
    else if (argv[i] === "--keyset") args.keyset = argv[++i];
    else { console.error(`generate-local-sign-key: unknown argument ${argv[i]}`); process.exit(1); }
  }
  if (!args.key || !args.keyset) {
    console.error("Usage: node scripts/generate-local-sign-key.mjs --key <private-key-path> --keyset <keyset-path>");
    process.exit(1);
  }
  return args;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const keyPath = path.resolve(args.key);
  const keysetPath = path.resolve(args.keyset);

  // 幂等：私钥已存在则跳过（复用，不覆盖）
  if (fs.existsSync(keyPath) && fs.existsSync(keysetPath)) {
    console.error(`[sign-key] 复用已有测试密钥对: ${keyPath}`);
    return;
  }

  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const privatePem = privateKey.export({ type: "pkcs8", format: "pem" });
  const publicPem = publicKey.export({ type: "spki", format: "pem" });
  const publicDer = publicKey.export({ type: "spki", format: "der" });

  fs.mkdirSync(path.dirname(keyPath), { recursive: true });
  fs.writeFileSync(keyPath, privatePem, { mode: 0o600 });

  const keyId = `${new Date().getUTCYear()}${createHash("sha256").update(publicDer).digest("hex").slice(0, 6)}`;
  // keyset 必须是数组格式（与 shared/artifact-core/pinned-keyset.json 同构）
  fs.writeFileSync(keysetPath, JSON.stringify([{ keyId, publicKey: publicPem }], null, 2));

  console.error(`[sign-key] 已生成测试密钥对: ${keyPath} + ${keysetPath} (keyId=${keyId})`);
  console.error("[sign-key] 这是一次性本地测试密钥，请勿用于正式发版，构建后可删。");
}

main();
