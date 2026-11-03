// 测试助手（不是测试文件：不以 .test.mjs 结尾）。D84：网页引擎退役后只剩仓库根路径。
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
