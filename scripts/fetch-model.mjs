// 首次运行（语音功能）模型拉取脚本
// 从 HuggingFace 下载 Xenova/whisper-tiny 量化权重到 public/models/Xenova/whisper-tiny
// 零第三方依赖，仅用 Node 内置 fetch / fs（Node 18+ 已验证）。
//
// 用法： npm run fetch-model
//
// 注意：应用本身通过 transformers.js 从同源 /models/Xenova/whisper-tiny 读取权重，
// 本脚本只是把权重放到那个目录。已存在的文件会跳过（支持断点续传式重跑）。

import { mkdir, writeFile, access } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { constants as fsConst } from 'node:fs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, '..');
const MODEL_ID = 'Xenova/whisper-tiny';
const BASE_URL = `https://huggingface.co/${MODEL_ID}/resolve/main`;
const TARGET_DIR = join(REPO_ROOT, 'public', 'models', MODEL_ID);

// 与 public/scripts/voice.js 中加载的权重文件一一对应
const FILES = [
  'config.json',
  'preprocessor_config.json',
  'tokenizer_config.json',
  'tokenizer.json',
  'special_tokens_map.json',
  'onnx/encoder_model_quantized.onnx',
  'onnx/decoder_model_merged_quantized.onnx',
];

async function exists(p) {
  try {
    await access(p, fsConst.F_OK);
    return true;
  } catch {
    return false;
  }
}

async function download(rel) {
  const url = `${BASE_URL}/${rel}`;
  const dest = join(TARGET_DIR, rel);
  if (await exists(dest)) {
    console.log(`  ✓ 已存在，跳过: ${rel}`);
    return;
  }
  await mkdir(dirname(dest), { recursive: true });
  console.log(`  ↓ 下载: ${rel}`);
  const res = await fetch(url, { redirect: 'follow' });
  if (!res.ok) {
    throw new Error(`下载失败 ${res.status} ${res.statusText} -> ${url}`);
  }
  const buf = Buffer.from(await res.arrayBuffer());
  await writeFile(dest, buf);
  console.log(`  ✓ 完成 (${(buf.length / 1024 / 1024).toFixed(1)} MB): ${rel}`);
}

console.log(`\n拉取语音模型 ${MODEL_ID} -> public/models/${MODEL_ID}\n`);
for (const f of FILES) {
  // 逐个下载，任一个失败即停止并提示
  await download(f);
}
console.log('\n✅ 模型权重就绪。重新启动（npm start）后即可使用语音功能。\n');
